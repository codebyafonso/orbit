import { describe, it, expect, beforeEach } from "vitest";
import { encryptToken, decryptToken } from "./crypto";

const DONO = "665f1f77bcf86cd799439011";
const OUTRO = "665f1f77bcf86cd799439022";

beforeEach(() => {
  process.env.TOKEN_SECRET = "1".repeat(64);
  process.env.SESSION_SECRET = "0".repeat(64);
});

describe("cifra do token", () => {
  it("decifra o que cifrou", () => {
    expect(decryptToken(encryptToken("vcp_segredo", DONO), DONO)).toBe("vcp_segredo");
  });

  it("cifra de verdade: os bytes do token nao aparecem no resultado", () => {
    // Sem esta assercao, uma implementacao que so fizesse base64 passaria.
    const c = encryptToken("vcp_segredo", DONO);
    expect(Buffer.from(c, "base64").includes(Buffer.from("vcp_segredo"))).toBe(false);
  });

  it("gera saidas diferentes para a mesma entrada", () => {
    expect(encryptToken("vcp_segredo", DONO)).not.toBe(encryptToken("vcp_segredo", DONO));
  });

  it("recusa ciphertext copiado para outro dono", () => {
    const c = encryptToken("vcp_segredo", DONO);
    expect(decryptToken(c, OUTRO)).toBeNull();
  });

  it("devolve null para texto adulterado", () => {
    const bytes = Buffer.from(encryptToken("vcp_segredo", DONO), "base64");
    bytes[bytes.length - 1] ^= 0xff;
    expect(decryptToken(bytes.toString("base64"), DONO)).toBeNull();
  });

  it("devolve null quando a chave mudou", () => {
    const c = encryptToken("vcp_segredo", DONO);
    process.env.TOKEN_SECRET = "2".repeat(64);
    expect(decryptToken(c, DONO)).toBeNull();
  });

  it("devolve null para entrada curta demais", () => {
    expect(decryptToken("YWJj", DONO)).toBeNull();
  });

  it("recusa TOKEN_SECRET igual a SESSION_SECRET", () => {
    process.env.SESSION_SECRET = process.env.TOKEN_SECRET;
    expect(() => encryptToken("vcp_x", DONO)).toThrow(/igual a SESSION_SECRET/);
  });

  it("recusa TOKEN_SECRET malformado", () => {
    process.env.TOKEN_SECRET = "nao-e-hex";
    expect(() => encryptToken("vcp_x", DONO)).toThrow(/TOKEN_SECRET/);
  });
});
