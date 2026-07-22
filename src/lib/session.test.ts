import { describe, it, expect, beforeEach } from "vitest";
import { EncryptJWT, jwtDecrypt } from "jose";
import { sealSession, openSession, type Session } from "./session";

const base: Session = {
  userId: "665f1f77bcf86cd799439011",
  email: "afonso@exemplo.com",
  sid: "sid-aleatorio",
  expiresAt: Date.now() + 3_600_000,
};

const chave = () => Uint8Array.from(Buffer.from("0".repeat(64), "hex"));

beforeEach(() => {
  process.env.SESSION_SECRET = "0".repeat(64);
});

describe("sessao", () => {
  it("abre o que selou", async () => {
    const opened = await openSession(await sealSession(base));
    expect(opened).toEqual(base);
  });

  it("nao carrega o token da vercel dentro do valor selado", async () => {
    // Verificar o retorno de openSession nao bastaria: ele monta o objeto por
    // whitelist e passaria mesmo se o token estivesse dentro do JWE.
    const { payload } = await jwtDecrypt(await sealSession(base), chave());
    expect(Object.keys(payload).sort()).toEqual(
      ["email", "exp", "expiresAt", "iat", "sid", "userId"].sort(),
    );
  });

  it("devolve null para valor adulterado", async () => {
    // Mexer no ultimo caractere nao serve: os bits finais do base64url sao de
    // padding e podem decodificar para os mesmos bytes. Alteramos o primeiro
    // caractere do ciphertext, que sempre muda o conteudo.
    const partes = (await sealSession(base)).split(".");
    const ct = partes[3];
    partes[3] = (ct[0] === "A" ? "B" : "A") + ct.slice(1);

    expect(await openSession(partes.join("."))).toBeNull();
  });

  it("devolve null para sessao expirada", async () => {
    expect(await openSession(await sealSession({ ...base, expiresAt: Date.now() - 1000 }))).toBeNull();
  });

  it("rejeita payload sem sid, que impediria a revogacao", async () => {
    const semSid = await new EncryptJWT({
      userId: base.userId,
      email: base.email,
      expiresAt: Date.now() + 10_000,
    })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setExpirationTime("1h")
      .encrypt(chave());

    expect(await openSession(semSid)).toBeNull();
  });

  it("rejeita expiresAt vencido mesmo com exp do jwt valido", async () => {
    // Exercita a checagem explicita: sem ela, o jose aceitaria este token.
    const forjado = await new EncryptJWT({ ...base, expiresAt: Date.now() - 60_000 })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setExpirationTime("1h")
      .encrypt(chave());

    expect(await openSession(forjado)).toBeNull();
  });

  it("rejeita payload sem userId", async () => {
    const semUserId = await new EncryptJWT({ email: "a@b.c", sid: "s", expiresAt: Date.now() + 10_000 })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setExpirationTime("1h")
      .encrypt(chave());

    expect(await openSession(semUserId)).toBeNull();
  });

  it("recusa SESSION_SECRET malformado em vez de tratar como sessao invalida", async () => {
    const sealed = await sealSession(base);
    process.env.SESSION_SECRET = "curto";
    await expect(openSession(sealed)).rejects.toThrow(/SESSION_SECRET/);
  });
});
