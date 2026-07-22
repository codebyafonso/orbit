import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, openSession, destroySession } from "@/lib/auth/session";
import { requireSameOrigin } from "@/lib/auth/same-origin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cross = requireSameOrigin(req);
  if (cross) return cross;

  // openSession em vez de readSession: aquele ja filtra sessao revogada, e aqui
  // precisamos do sid mesmo quando o banco esta instavel.
  const valor = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = valor ? await openSession(valor) : null;

  if (session) {
    try {
      // Apagar o cookie so instrui aquele navegador. Remover o sid invalida a
      // sessao para qualquer copia do cookie que ja tenha vazado.
      await destroySession(session.sid);
    } catch (err) {
      console.error("logout nao revogou a sessao:", err instanceof Error ? err.name : "erro");
      const falha = NextResponse.json(
        { error: "Saimos deste navegador, mas a sessao nao pode ser revogada. Tente de novo." },
        { status: 503 },
      );
      falha.cookies.delete(SESSION_COOKIE);
      return falha;
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
