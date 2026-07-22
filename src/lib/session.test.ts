import { describe, it, expect, beforeAll } from "vitest";
import { EncryptJWT } from "jose";
import { sealSession, openSession, type Session } from "./session";

const base: Session = {
  token: "tok_secreto",
  vercelUserId: "usr_1",
  username: "afonso",
  expiresAt: Date.now() + 3_600_000,
};

beforeAll(() => {
  process.env.SESSION_SECRET = "0".repeat(64);
});

describe("sessao", () => {
  it("abre o que selou", async () => {
    const opened = await openSession(await sealSession(base));
    expect(opened).toMatchObject({ token: "tok_secreto", vercelUserId: "usr_1" });
  });

  it("nao deixa o token legivel no valor selado", async () => {
    expect(await sealSession(base)).not.toContain("tok_secreto");
  });

  it("devolve null para valor adulterado", async () => {
    const sealed = await sealSession(base);
    const corrompido = sealed.slice(0, -1) + (sealed.at(-1) === "a" ? "b" : "a");
    expect(await openSession(corrompido)).toBeNull();
  });

  it("devolve null para sessao expirada", async () => {
    const sealed = await sealSession({ ...base, expiresAt: Date.now() - 1000 });
    expect(await openSession(sealed)).toBeNull();
  });

  it("rejeita expiresAt vencido mesmo com exp do jwt valido", async () => {
    // Exercita a checagem explicita: sem ela, o jose aceitaria este token.
    const chave = Uint8Array.from(Buffer.from("0".repeat(64), "hex"));
    const forjado = await new EncryptJWT({ ...base, expiresAt: Date.now() - 60_000 })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setExpirationTime("1h")
      .encrypt(chave);

    expect(await openSession(forjado)).toBeNull();
  });

  it("rejeita payload com formato inesperado", async () => {
    const chave = Uint8Array.from(Buffer.from("0".repeat(64), "hex"));
    const semToken = await new EncryptJWT({ vercelUserId: "usr_1", expiresAt: Date.now() + 10_000 })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setExpirationTime("1h")
      .encrypt(chave);

    expect(await openSession(semToken)).toBeNull();
  });
});
