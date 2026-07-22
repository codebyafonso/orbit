import { NextResponse } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import { purgeUser, checkPassword } from "@/lib/auth/users";
import { requireSameOrigin } from "@/lib/auth/same-origin";
import { asString, asSecret, LIMITES } from "@/lib/auth/input";
import { rateLimit, respostaDoLimite } from "@/lib/auth/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // @node-rs/argon2 e modulo nativo

/** Dados da conta logada. */
export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Faca login novamente." }, { status: 401 });
  return NextResponse.json({ email: session.email });
}

/**
 * Apaga a conta e tudo que pertence a ela.
 *
 * Exige a senha de novo: um cookie roubado nao pode destruir a conta da vitima.
 */
export async function DELETE(req: Request) {
  const cross = requireSameOrigin(req);
  if (cross) return cross;

  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Faca login novamente." }, { status: 401 });

  const limite = await rateLimit(`conta-apagar:${session.userId}`, { max: 5, janelaSegundos: 900 });
  if (!limite.ok) return respostaDoLimite(limite);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const senha = asSecret(body.senha, { min: 1, max: LIMITES.senha });
  const confirmacao = asString(body.confirmacao, LIMITES.email);

  if (!senha || confirmacao?.toLowerCase() !== session.email) {
    return NextResponse.json(
      { error: "Confirme com sua senha e digite seu email exatamente." },
      { status: 400 },
    );
  }

  // Por id, nao por email: quem manda numa operacao destrutiva e a sessao.
  if (!(await checkPassword(session.userId, senha))) {
    return NextResponse.json({ error: "Senha incorreta." }, { status: 401 });
  }

  try {
    const { removidos } = await purgeUser(session.userId, session.email);
    const res = NextResponse.json({ ok: true, removidos });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (err) {
    console.error("purge de conta falhou:", err instanceof Error ? err.name : "erro");
    return NextResponse.json({ error: "Nao foi possivel apagar a conta agora." }, { status: 503 });
  }
}
