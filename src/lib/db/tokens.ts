import { ObjectId } from "mongodb";
import { getDb } from "./mongo";
import { encryptToken, decryptToken } from "../auth/crypto";

export const TOKEN_TTL_DAYS = 7;
const TTL_MS = TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
const COLLECTION = "vercel_tokens";
const MIN_TOKEN_LEN = 20;

type TokenDoc = {
  ciphertext?: unknown;
  teamId?: unknown;
  vercelUsername?: unknown;
  expiresAt?: unknown;
};

/** `new ObjectId(lixo)` lanca: aqui a entrada invalida vira ausencia. */
function oid(userId: string): ObjectId | null {
  return ObjectId.isValid(userId) ? new ObjectId(userId) : null;
}

/**
 * Documento ainda valido, ou null. A data e validada como Date de verdade:
 * `new Date(undefined).getTime()` e NaN, e toda comparacao com NaN e falsa —
 * um documento sem `expiresAt` passaria como eternamente valido, e o coletor
 * TTL do Mongo tambem o ignoraria.
 */
async function liveDoc(userId: string): Promise<TokenDoc | null> {
  const id = oid(userId);
  if (!id) return null;

  const db = await getDb();
  if (!db) return null;

  const doc = (await db.collection(COLLECTION).findOne({ userId: id })) as TokenDoc | null;
  if (!doc) return null;

  const exp = doc.expiresAt instanceof Date ? doc.expiresAt.getTime() : NaN;
  if (!Number.isFinite(exp) || exp <= Date.now()) return null;

  return doc;
}

export async function saveToken(p: {
  userId: string;
  token: string;
  teamId?: string | null;
  vercelUsername: string | null;
}): Promise<Date> {
  const id = oid(p.userId);
  if (!id) throw new Error("Usuario invalido.");
  if (p.token.trim().length < MIN_TOKEN_LEN) throw new Error("Token da Vercel invalido.");

  const db = await getDb();
  if (!db) throw new Error("Banco indisponivel: nao foi possivel guardar o token.");

  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.collection(COLLECTION).updateOne(
    { userId: id },
    {
      $set: {
        // AAD = userId: o ciphertext so decifra no documento do proprio dono.
        ciphertext: encryptToken(p.token, p.userId),
        teamId: p.teamId ?? null,
        vercelUsername: p.vercelUsername,
        updatedAt: new Date(),
        expiresAt,
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  return expiresAt;
}

export async function loadToken(
  userId: string,
): Promise<{ token: string; teamId?: string; expiresAt: Date } | null> {
  const doc = await liveDoc(userId);
  if (!doc || typeof doc.ciphertext !== "string") return null;

  const token = decryptToken(doc.ciphertext, userId);
  if (!token) {
    // Chave rotacionada ou documento adulterado: o registro nao serve mais para
    // nada e so amplia a janela de exposicao. Some com ele agora.
    await forgetToken(userId);
    return null;
  }

  return {
    token,
    teamId: typeof doc.teamId === "string" ? doc.teamId : undefined,
    expiresAt: doc.expiresAt as Date,
  };
}

/**
 * Metadados para a interface. Nao expoe nem um pedaco do token: os quatro
 * ultimos caracteres nao ajudariam um ataque, mas tambem nao sao necessarios
 * para nada — a validade e a conta ja identificam a conexao.
 */
export async function tokenStatus(
  userId: string,
): Promise<{ expiresAt: Date; vercelUsername: string | null } | null> {
  const doc = await liveDoc(userId);
  if (!doc) return null;

  return {
    expiresAt: doc.expiresAt as Date,
    vercelUsername: typeof doc.vercelUsername === "string" ? doc.vercelUsername : null,
  };
}

export async function forgetToken(userId: string): Promise<void> {
  const id = oid(userId);
  if (!id) return;

  const db = await getDb();
  if (!db) return;
  await db.collection(COLLECTION).deleteOne({ userId: id });
}
