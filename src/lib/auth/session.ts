import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";
import { hexKey } from "./secret";
import { getDb } from "../db/mongo";

export const SESSION_COOKIE = "orbit_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * A sessao identifica a conta local e nada mais. O token da Vercel fica cifrado
 * no banco, com prazo proprio: se ele tambem vivesse aqui, revogar no banco nao
 * revogaria a copia no cookie.
 *
 * O `sid` torna a sessao revogavel: sem ele, sair so limparia o cookie daquele
 * navegador, e uma copia do valor continuaria valida ate o prazo acabar.
 */
export type Session = {
  userId: string;
  email: string;
  sid: string;
  expiresAt: number;
};

export async function sealSession(session: Session): Promise<string> {
  return new EncryptJWT({ ...session })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(new Date(session.expiresAt))
    .encrypt(hexKey("SESSION_SECRET"));
}

/** Abre e valida o formato. Nao consulta o banco — use `readSession` nas rotas. */
export async function openSession(value: string): Promise<Session | null> {
  // Fora do try: segredo mal configurado e erro de operacao, nao sessao invalida.
  const k = hexKey("SESSION_SECRET");

  try {
    const { payload } = await jwtDecrypt(value, k, {
      // Sem allowlist, um JWE com PBES2 forcaria PBKDF2 caro a cada requisicao.
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });

    const s = payload as unknown as Partial<Session>;
    // Fronteira de desserializacao: o que sai daqui alimenta consultas ao banco.
    if (
      typeof s.userId !== "string" ||
      typeof s.email !== "string" ||
      typeof s.sid !== "string" ||
      typeof s.expiresAt !== "number" ||
      s.expiresAt <= Date.now()
    ) {
      return null;
    }
    return { userId: s.userId, email: s.email, sid: s.sid, expiresAt: s.expiresAt };
  } catch {
    return null; // adulterado, expirado ou selado com outra chave
  }
}

/** Cria a sessao no banco e devolve o cookie ja selado. */
export async function startSession(
  res: NextResponse,
  user: { id: string; email: string },
): Promise<void> {
  const sid = randomBytes(18).toString("base64url");
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;

  const db = await getDb();
  if (!db) throw new Error("Banco indisponivel: nao foi possivel iniciar a sessao.");
  await db
    .collection("sessions")
    .insertOne({ sid, userId: user.id, createdAt: new Date(), expiresAt: new Date(expiresAt) });

  const sealed = await sealSession({ userId: user.id, email: user.email, sid, expiresAt });
  res.cookies.set(SESSION_COOKIE, sealed, sessionCookieOptions(SESSION_MAX_AGE_SECONDS));
}

/** Lanca se nao conseguiu revogar: quem chama precisa saber que a sessao vive. */
export async function destroySession(sid: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Banco indisponivel: sessao nao foi revogada.");
  await db.collection("sessions").deleteOne({ sid });
}

/** Sessao valida e ainda nao revogada. */
export async function readSession(): Promise<Session | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;

  const session = await openSession(value);
  if (!session) return null;

  const db = await getDb();
  if (!db) return null; // falha fechada: sem banco nao da para saber se foi revogada

  const viva = await db.collection("sessions").findOne({ sid: session.sid });
  if (!viva) return null;

  // O banco e a autoridade: se o dono divergir do que veio no cookie, recusa.
  if (String(viva.userId) !== session.userId) return null;

  return session;
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
