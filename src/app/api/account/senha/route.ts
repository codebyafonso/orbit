import { NextResponse } from "next/server";
import { readSession, startSession } from "@/lib/auth/session";
import { changePassword } from "@/lib/auth/users";
import { requireSameOrigin } from "@/lib/auth/same-origin";
import { asSecret, LIMITES } from "@/lib/auth/input";
import { rateLimit, resetLimit, respostaDoLimite } from "@/lib/auth/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // @node-rs/argon2 e modulo nativo

export async function PUT(req: Request) {
  const cross = requireSameOrigin(req);
  if (cross) return cross;

  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Faca login novamente." }, { status: 401 });

  const limite = await rateLimit(`senha:${session.userId}`, { max: 5, janelaSegundos: 900 });
  if (!limite.ok) return respostaDoLimite(limite);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const atual = asSecret(body.atual, { min: 1, max: LIMITES.senha });
  const nova = asSecret(body.nova, { min: 1, max: LIMITES.senha });

  if (!atual || !nova) {
    return NextResponse.json({ error: "Informe a senha atual e a nova." }, { status: 400 });
  }

  const r = await changePassword(session.userId, atual, nova);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });

  // Quem trocou a senha nao pode ficar travado pelo limitador de login logo
  // depois — e justamente quando precisa reautenticar nos outros aparelhos.
  await resetLimit(`login-conta:${session.email.toLowerCase()}`).catch(() => {});

  // changePassword derruba todas as sessoes; este navegador ganha uma nova para
  // nao ser deslogado no meio da propria operacao.
  const res = NextResponse.json({ ok: true });
  try {
    await startSession(res, { id: session.userId, email: session.email });
  } catch {
    // A senha ja foi trocada: avisar para relogar e melhor que estourar 500.
    return NextResponse.json({ ok: true, precisaRelogar: true });
  }
  return res;
}
