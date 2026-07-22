import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./mongo", () => ({ getDb: vi.fn() }));

import { getDb } from "./mongo";
import { encryptToken } from "./crypto";
import { saveToken, loadToken, tokenStatus, TOKEN_TTL_DAYS } from "./tokens";

const USER_ID = "665f1f77bcf86cd799439011";

beforeEach(() => {
  process.env.TOKEN_SECRET = "1".repeat(64);
  vi.mocked(getDb).mockReset();
});

describe("saveToken", () => {
  it("grava cifrado, com last4 e expiracao de 7 dias", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    vi.mocked(getDb).mockResolvedValue({ collection: () => ({ updateOne }) } as never);

    const expiresAt = await saveToken({
      userId: USER_ID,
      token: "vcp_abcdefgh1234",
      vercelUsername: "afonso",
    });

    const doc = updateOne.mock.calls[0][1].$set;
    expect(doc.ciphertext).not.toContain("vcp_abcdefgh1234");
    expect(doc.last4).toBe("1234");
    expect(Math.round((expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(TOKEN_TTL_DAYS);
  });

  it("lanca quando o banco esta fora", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    await expect(
      saveToken({ userId: USER_ID, token: "vcp_x", vercelUsername: null }),
    ).rejects.toThrow();
  });
});

describe("loadToken", () => {
  it("devolve null quando nao ha documento", async () => {
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({ findOne: async () => null }),
    } as never);
    expect(await loadToken(USER_ID)).toBeNull();
  });

  it("decifra o token guardado", async () => {
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: async () => ({
          ciphertext: encryptToken("vcp_guardado"),
          expiresAt: new Date(Date.now() + 86_400_000),
          teamId: null,
        }),
      }),
    } as never);
    expect((await loadToken(USER_ID))?.token).toBe("vcp_guardado");
  });

  it("trata documento vencido como ausente, sem esperar o ttl do mongo", async () => {
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: async () => ({
          ciphertext: encryptToken("vcp_x"),
          expiresAt: new Date(Date.now() - 1000),
        }),
      }),
    } as never);
    expect(await loadToken(USER_ID)).toBeNull();
  });

  it("devolve null quando a chave nao decifra o documento", async () => {
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: async () => ({
          ciphertext: "Y29udGV1ZG8gcXVlIG5hbyBkZWNpZnJh",
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      }),
    } as never);
    expect(await loadToken(USER_ID)).toBeNull();
  });
});

describe("tokenStatus", () => {
  it("expoe apenas metadados, nunca o token", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: async () => ({
          ciphertext: encryptToken("vcp_secreto"),
          last4: "1234",
          expiresAt,
          vercelUsername: "afonso",
        }),
      }),
    } as never);

    const status = await tokenStatus(USER_ID);
    expect(status).toEqual({ last4: "1234", expiresAt, vercelUsername: "afonso" });
    expect(JSON.stringify(status)).not.toContain("vcp_secreto");
  });
});
