import { NextResponse } from "next/server";
import { createUser, activateUser, deleteUser } from "@/lib/auth/users";
import { saveToken } from "@/lib/db/tokens";
import { whoami, VercelError } from "@/lib/vercel/client";
import { startSession } from "@/lib/auth/session";
import { requireSameOrigin } from "@/lib/auth/same-origin";
import { rateLimit, clientIp, type RateVerdict } from "@/lib/auth/rate-limit";
import { asString, asSecret, LIMITES } from "@/lib/auth/input";

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
  const token = asString(body.token, LIMITES.token);
  const teamId = body.teamId === undefined ? undefined : asString(body.teamId, LIMITES.teamId);

  if (!email || !senha || !token || teamId === null) {
    return NextResponse.json({ error: "Email, senha e token sao obrigatorios." }, { status: 400 });
  }

  // Cada cadastro chama a API da Vercel: sem freio, a rota vira um proxy
  // gratuito para descobrir se tokens vazados ainda sao validos. Limitamos por
  // origem e por email, ja que o IP sozinho nao e confiavel em toda hospedagem.
  for (const chave of [`register-ip:${clientIp(req)}`, `register-email:${email.toLowerCase()}`]) {
    const limite = await rateLimit(chave, { max: 5, janelaSegundos: 3600 });
    if (!limite.ok) return respostaDoLimite(limite);
  }

  const criado = await createUser(email, senha);
  if ("erro" in criado) return NextResponse.json({ error: criado.erro }, { status: 400 });

  try {
    const { username } = await whoami({ token, teamId });
    await saveToken({ userId: criado.user.id, token, teamId, vercelUsername: username });
    await activateUser(criado.user.id);
  } catch (err) {
    // A conta nasce pendente, entao mesmo se esta limpeza falhar ela nao loga —
    // e o TTL em pendingUntil a remove sozinho em 15 minutos.
    await deleteUser(criado.user.id).catch(() => {});

    if (err instanceof VercelError) {
      return NextResponse.json(
        { error: "Token recusado pela Vercel. Confira se ele e valido e nao expirou." },
        { status: 400 },
      );
    }
    console.error("cadastro falhou:", err instanceof Error ? err.name : "erro");
    return NextResponse.json(
      { error: "Nao foi possivel concluir o cadastro. Tente de novo." },
      { status: 503 },
    );
  }

  const res = NextResponse.json({ ok: true });
  await startSession(res, criado.user);
  return res;
}
