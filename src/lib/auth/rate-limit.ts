import { getDb } from "../db/mongo";

/**
 * Limitador por janela fixa, apoiado no MongoDB.
 *
 * Sem isto, /login aceita forca bruta ilimitada e /register vira proxy gratuito
 * para testar se tokens da Vercel ainda sao validos. O contador tem indice TTL,
 * entao o proprio banco limpa as janelas vencidas.
 */
export type RateVerdict =
  | { ok: true }
  | { ok: false; motivo: "limite"; retryAfterSeconds: number }
  | { ok: false; motivo: "indisponivel" };

import { NextResponse } from "next/server";

/** Traduz o veredito em resposta HTTP. Banco fora nao e "muitas tentativas". */
export function respostaDoLimite(v: Exclude<RateVerdict, { ok: true }>) {
  if (v.motivo === "indisponivel") {
    return NextResponse.json(
      { error: "Servico indisponivel. Tente em instantes." },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { error: "Muitas tentativas. Tente mais tarde." },
    { status: 429, headers: { "Retry-After": String(v.retryAfterSeconds) } },
  );
}

export async function rateLimit(
  chave: string,
  { max, janelaSegundos }: { max: number; janelaSegundos: number },
): Promise<RateVerdict> {
  const db = await getDb();
  // Falha fechada: o caminho de autenticacao nao pode ficar sem freio. Mas o
  // motivo e distinto de "estourou o limite" — a rota responde 503, nao 429.
  if (!db) return { ok: false, motivo: "indisponivel" };

  const agora = Date.now();
  const inicioJanela = new Date(Math.floor(agora / (janelaSegundos * 1000)) * janelaSegundos * 1000);
  const expiresAt = new Date(inicioJanela.getTime() + janelaSegundos * 1000);

  const incrementar = () =>
    db.collection("rate_limits").findOneAndUpdate(
      { chave, inicioJanela },
      { $inc: { hits: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: "after" as const },
    );

  let doc;
  try {
    doc = await incrementar();
  } catch (err) {
    // Dois upserts simultaneos na mesma chave inexistente: um perde a corrida e
    // o indice unico devolve E11000. Na segunda tentativa o documento ja existe.
    if ((err as { code?: number }).code !== 11000) throw err;
    doc = await incrementar();
  }

  // Caminho anomalo no limitador nega, nao libera.
  const hits = typeof doc?.hits === "number" ? doc.hits : Number.POSITIVE_INFINITY;
  if (hits > max) {
    return {
      ok: false,
      motivo: "limite",
      retryAfterSeconds: Math.ceil((expiresAt.getTime() - agora) / 1000),
    };
  }
  return { ok: true };
}

/** Zera o contador apos sucesso, para que tentativas validas nao acumulem. */
export async function resetLimit(chave: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection("rate_limits").deleteMany({ chave });
}

/**
 * IP do cliente.
 *
 * `x-forwarded-for` e escrito pelo proprio cliente e so recebe o IP real
 * anexado pelo proxy: confiar no primeiro elemento permitiria variar o header a
 * cada requisicao e furar qualquer limite. Por isso so aceitamos cabecalhos que
 * a plataforma sobrescreve, ou o ultimo salto quando ha proxy declarado.
 */
export function clientIp(req: Request): string {
  const daPlataforma = req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-real-ip");
  if (daPlataforma) return daPlataforma.trim();

  if (process.env.TRUST_PROXY === "1") {
    const cadeia = req.headers.get("x-forwarded-for");
    if (cadeia) {
      const saltos = cadeia.split(",");
      return saltos[saltos.length - 1].trim(); // o ultimo foi anexado pelo proxy
    }
  }

  // Sem proxy confiavel nao ha IP confiavel: todos caem no mesmo balde, o que e
  // restritivo de proposito. O limite por conta continua valendo em separado.
  return "sem-proxy-confiavel";
}
