import { NextResponse } from "next/server";
import { verifyUser } from "@/lib/users";
import { startSession } from "@/lib/session";
import { requireSameOrigin } from "@/lib/same-origin";
import { rateLimit, resetLimit, clientIp, type RateVerdict } from "@/lib/rate-limit";
import { asString, asSecret, LIMITES } from "@/lib/input";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // @node-rs/argon2 e modulo nativo

function respostaDoLimite(v: Exclude<RateVerdict, { ok: true }>) {
  if (v.motivo === "indisponivel") {
    return NextResponse.json({ error: "Servico indisponivel. Tente em instantes." }, { status: 503 });
  }
  return NextResponse.json(
    { error: "Muitas tentativas. Tente mais tarde." },
    { status: 429, headers: { "Retry-After": String(v.retryAfterSeconds) } },
  );
}

export async function POST(req: Request) {
  const cross = requireSameOrigin(req);
  if (cross) return cross;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = asString(body.email, LIMITES.email);
  const senha = asSecret(body.senha, { min: 1, max: LIMITES.senha });

  if (!email || !senha) {
    return NextResponse.json({ error: "Informe email e senha." }, { status: 400 });
  }

  // Por origem e por conta. O limite de conta e mais folgado de proposito: se
  // fosse igual ao de IP, qualquer um travaria a conta alheia por 15 minutos so
  // errando a senha de proposito.
  const chaveConta = `login-conta:${email.toLowerCase()}`;
  for (const [chave, max] of [
    [`login-ip:${clientIp(req)}`, 8],
    [chaveConta, 20],
  ] as const) {
    const limite = await rateLimit(chave, { max, janelaSegundos: 900 });
    if (!limite.ok) return respostaDoLimite(limite);
  }

  const user = await verifyUser(email, senha);
  // Mesma mensagem para email inexistente e senha errada — e verifyUser gasta o
  // mesmo tempo nos dois casos, senao o relogio entregaria quem tem conta.
  if (!user) {
    return NextResponse.json({ error: "Email ou senha invalidos." }, { status: 401 });
  }

  // Acerto zera o contador da conta: tentativas legitimas nao acumulam rumo ao
  // bloqueio, e quem sabe a senha nao fica refem de tentativas de terceiros.
  await resetLimit(chaveConta).catch(() => {});

  const res = NextResponse.json({ ok: true });
  await startSession(res, user);
  return res;
}
