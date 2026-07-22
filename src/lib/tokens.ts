import { ObjectId } from "mongodb";
import { getDb } from "./mongo";
import { encryptToken, decryptToken } from "./crypto";

export const TOKEN_TTL_DAYS = 7;
const TTL_MS = TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
const COLLECTION = "vercel_tokens";

export async function saveToken(p: {
  userId: string;
  token: string;
  teamId?: string | null;
  vercelUsername: string | null;
}): Promise<Date> {
  const db = await getDb();
  if (!db) throw new Error("Banco indisponivel: nao foi possivel guardar o token.");

  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.collection(COLLECTION).updateOne(
    { userId: new ObjectId(p.userId) },
    {
      $set: {
        ciphertext: encryptToken(p.token),
        last4: p.token.slice(-4),
        teamId: p.teamId ?? null,
        vercelUsername: p.vercelUsername,
        createdAt: new Date(),
        expiresAt,
      },
    },
    { upsert: true },
  );
  return expiresAt;
}

export async function loadToken(
  userId: string,
): Promise<{ token: string; teamId?: string; expiresAt: Date } | null> {
  const db = await getDb();
  if (!db) return null;

  const doc = await db.collection(COLLECTION).findOne({ userId: new ObjectId(userId) });
  if (!doc) return null;

  // O coletor de TTL do Mongo roda a cada ~60s: nao confiar apenas nele.
  const expiresAt = new Date(doc.expiresAt);
  if (expiresAt.getTime() <= Date.now()) return null;

  const token = decryptToken(String(doc.ciphertext));
  if (!token) return null; // chave trocada ou documento corrompido

  return { token, teamId: doc.teamId ? String(doc.teamId) : undefined, expiresAt };
}

/** Metadados para a interface. Nunca inclui o token. */
export async function tokenStatus(
  userId: string,
): Promise<{ last4: string; expiresAt: Date; vercelUsername: string | null } | null> {
  const db = await getDb();
  if (!db) return null;

  const doc = await db.collection(COLLECTION).findOne({ userId: new ObjectId(userId) });
  if (!doc || new Date(doc.expiresAt).getTime() <= Date.now()) return null;

  return {
    last4: String(doc.last4),
    expiresAt: new Date(doc.expiresAt),
    vercelUsername: doc.vercelUsername ? String(doc.vercelUsername) : null,
  };
}

export async function forgetToken(userId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection(COLLECTION).deleteOne({ userId: new ObjectId(userId) });
}
