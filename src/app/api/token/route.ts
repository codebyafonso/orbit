import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/session";
import { tokenStatus, saveToken, forgetToken, TOKEN_TTL_DAYS } from "@/lib/db/tokens";
import { whoami, VercelError } from "@/lib/vercel/client";
import { requireSameOrigin } from "@/lib/auth/same-origin";
import { asString, LIMITES } from "@/lib/auth/input";

export const dynamic = "force-dynamic";

const semSessao = () => NextResponse.json({ error: "Faca login novamente." }, { status: 401 });

/** Validade do token atual. Nunca devolve o token em si. */
export async function GET() {
  const session = await readSession();
  if (!session) return semSessao();

  const status = await tokenStatus(session.userId);
  if (!status) return NextResponse.json({ status: null, ttlDias: TOKEN_TTL_DAYS });

  return NextResponse.json({ status, ttlDias: TOKEN_TTL_DAYS });
}

/** Informa ou substitui o token, reiniciando o prazo de 7 dias. */
export async function PUT(req: Request) {
  const cross = requireSameOrigin(req);
  if (cross) return cross;

  const session = await readSession();
  if (!session) return semSessao();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const token = asString(body.token, LIMITES.token);
  const teamId = body.teamId === undefined ? undefined : asString(body.teamId, LIMITES.teamId);

  if (!token || teamId === null) {
    return NextResponse.json({ error: "Informe um token valido." }, { status: 400 });
  }

  try {
    const { username } = await whoami({ token, teamId });
    const expiresAt = await saveToken({
      userId: session.userId,
      token,
      teamId,
      vercelUsername: username,
    });
    return NextResponse.json({ ok: true, expiresAt, vercelUsername: username });
  } catch (err) {
    if (err instanceof VercelError) {
      return NextResponse.json(
        { error: "Token recusado pela Vercel. Confira se ele e valido e nao expirou." },
        { status: 400 },
      );
    }
    console.error("PUT /api/token falhou:", err instanceof Error ? err.name : "erro");
    return NextResponse.json({ error: "Nao foi possivel guardar o token." }, { status: 503 });
  }
}

/** Esquece o token antes do prazo. */
export async function DELETE(req: Request) {
  const cross = requireSameOrigin(req);
  if (cross) return cross;

  const session = await readSession();
  if (!session) return semSessao();

  await forgetToken(session.userId);
  return NextResponse.json({ ok: true });
}
