import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { hexKey } from "./secret";

const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  const k = hexKey("TOKEN_SECRET");
  // Mesma chave cifrando cookie de sessao e token em repouso significa que um
  // vazamento comprometeria os dois dominios de uma vez.
  if (process.env.TOKEN_SECRET === process.env.SESSION_SECRET) {
    throw new Error("TOKEN_SECRET nao pode ser igual a SESSION_SECRET");
  }
  return k;
}

/**
 * Formato: base64(iv || tag || ciphertext).
 *
 * `aad` amarra o texto cifrado ao dono: sem isso, copiar o ciphertext de um
 * usuario para o documento de outro no banco entregaria o token da vitima em
 * claro. Com AAD, a verificacao da tag falha.
 */
export function encryptToken(plain: string, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decryptToken(payload: string, aad: string): string | null {
  const k = key(); // fora do try: segredo mal configurado e erro de operacao

  try {
    const raw = Buffer.from(payload, "base64");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", k, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null; // adulterado, dono diferente, chave errada ou formato invalido
  }
}
