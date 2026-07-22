import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "orbit_session";

export type Session = {
  token: string;
  teamId?: string;
  vercelUserId: string;
  username: string | null;
  expiresAt: number;
};

function key(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  // Buffer.from(x, "hex") nao lanca com lixo: para no primeiro par invalido e
  // devolve uma chave curta em silencio. Validar o formato inteiro antes.
  if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) {
    throw new Error("SESSION_SECRET deve ter 32 bytes em hex (64 caracteres)");
  }
  return Uint8Array.from(Buffer.from(secret, "hex"));
}

export async function sealSession(session: Session): Promise<string> {
  return new EncryptJWT({ ...session })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(new Date(session.expiresAt))
    .encrypt(key());
}

export async function openSession(value: string): Promise<Session | null> {
  // Fora do try: segredo mal configurado e erro de operacao, nao sessao invalida.
  const k = key();

  try {
    const { payload } = await jwtDecrypt(value, k, {
      // Sem allowlist, um JWE com PBES2 forcaria PBKDF2 caro a cada requisicao.
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });

    const s = payload as unknown as Partial<Session>;
    // Fronteira de desserializacao: o que sai daqui alimenta consultas ao banco.
    if (
      typeof s.token !== "string" ||
      typeof s.vercelUserId !== "string" ||
      typeof s.expiresAt !== "number" ||
      s.expiresAt <= Date.now()
    ) {
      return null;
    }
    return {
      token: s.token,
      teamId: typeof s.teamId === "string" ? s.teamId : undefined,
      vercelUserId: s.vercelUserId,
      username: typeof s.username === "string" ? s.username : null,
      expiresAt: s.expiresAt,
    };
  } catch {
    return null; // adulterado, expirado ou selado com outra chave
  }
}

export async function readSession(): Promise<Session | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value ? openSession(value) : null;
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
