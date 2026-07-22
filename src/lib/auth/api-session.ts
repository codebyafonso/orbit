import { NextResponse } from "next/server";
import { readSession, type Session } from "./session";
import { loadToken } from "../db/tokens";
import type { VercelAuth } from "../vercel/client";

/**
 * Sessao valida + token da Vercel do proprio usuario, decifrado em memoria.
 *
 * Sem sessao: 401. Com sessao mas sem token valido (expirou ou nunca foi
 * informado): 428, que a interface traduz na tela de "informe seu token" em vez
 * de um erro generico.
 */
export async function requireAuth(): Promise<
  | { session: Session; auth: VercelAuth; response?: undefined }
  | { session?: undefined; auth?: undefined; response: NextResponse }
> {
  const session = await readSession();
  if (!session) {
    return { response: NextResponse.json({ error: "Faca login novamente." }, { status: 401 }) };
  }

  const stored = await loadToken(session.userId);
  if (!stored) {
    return {
      response: NextResponse.json(
        { error: "Seu token expirou ou nao foi informado.", needsToken: true },
        { status: 428 },
      ),
    };
  }

  return { session, auth: { token: stored.token, teamId: stored.teamId } };
}
