import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./mongo", () => ({ getDb: vi.fn() }));

import { getDb } from "./mongo";
import { encryptToken } from "../auth/crypto";
import { saveToken, loadToken, tokenStatus, forgetToken, TOKEN_TTL_DAYS } from "./tokens";

const USER_ID = "665f1f77bcf86cd799439011";
const OUTRO_ID = "665f1f77bcf86cd799439022";
const TOKEN = "vcp_abcdefghijklmnop1234";

beforeEach(() => {
  process.env.TOKEN_SECRET = "1".repeat(64);
  process.env.SESSION_SECRET = "0".repeat(64);
  vi.mocked(getDb).mockReset();
});

/** Fake mínimo do driver, registrando qual coleção foi usada. */
function fakeDb(handlers: Record<string, unknown>) {
  const collection = vi.fn(() => handlers);
  vi.mocked(getDb).mockResolvedValue({ collection } as never);
  return collection;
}

const daqui = (ms: number) => new Date(Date.now() + ms);

describe("saveToken", () => {
  it("grava cifrado na colecao certa, com upsert e expiracao de 7 dias", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const collection = fakeDb({ updateOne });

    const expiresAt = await saveToken({
      userId: USER_ID,
      token: TOKEN,
      vercelUsername: "afonso",
    });

    expect(collection).toHaveBeenCalledWith("vercel_tokens");

    const [filtro, update, opcoes] = updateOne.mock.calls[0];
    expect(String(filtro.userId)).toBe(USER_ID);
    expect(opcoes).toEqual({ upsert: true });
    expect(update.$set.ciphertext).not.toContain(TOKEN);
    // nenhum pedaco do token e guardado em claro, nem para exibicao
    expect(JSON.stringify(update.$set)).not.toContain(TOKEN.slice(-4));
    // createdAt so na criacao: trocar o token nao pode reescrever a origem
    expect(update.$setOnInsert.createdAt).toBeInstanceOf(Date);
    expect(update.$set.createdAt).toBeUndefined();
    expect(Math.round((expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(TOKEN_TTL_DAYS);
  });

  it("recusa userId invalido sem tocar no banco", async () => {
    await expect(
      saveToken({ userId: "nao-e-objectid", token: TOKEN, vercelUsername: null }),
    ).rejects.toThrow(/Usuario invalido/);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("recusa token curto demais", async () => {
    await expect(
      saveToken({ userId: USER_ID, token: "vcp_x", vercelUsername: null }),
    ).rejects.toThrow(/Token/);
  });

  it("lanca quando o banco esta fora", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    await expect(
      saveToken({ userId: USER_ID, token: TOKEN, vercelUsername: null }),
    ).rejects.toThrow(/Banco indisponivel/);
  });
});

describe("loadToken", () => {
  it("decifra o token do proprio dono", async () => {
    fakeDb({
      findOne: async () => ({
        ciphertext: encryptToken(TOKEN, USER_ID),
        expiresAt: daqui(86_400_000),
        teamId: null,
      }),
    });
    expect((await loadToken(USER_ID))?.token).toBe(TOKEN);
  });

  it("devolve null quando nao ha documento", async () => {
    fakeDb({ findOne: async () => null });
    expect(await loadToken(USER_ID)).toBeNull();
  });

  it("devolve null para userId invalido", async () => {
    expect(await loadToken("nao-e-objectid")).toBeNull();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("trata documento vencido como ausente, sem esperar o ttl do mongo", async () => {
    fakeDb({
      findOne: async () => ({ ciphertext: encryptToken(TOKEN, USER_ID), expiresAt: daqui(-1000) }),
    });
    expect(await loadToken(USER_ID)).toBeNull();
  });

  it("trata documento sem expiresAt como invalido, e nao como eterno", async () => {
    fakeDb({ findOne: async () => ({ ciphertext: encryptToken(TOKEN, USER_ID) }) });
    expect(await loadToken(USER_ID)).toBeNull();
  });

  it("recusa e apaga ciphertext copiado de outro usuario", async () => {
    const deleteOne = vi.fn().mockResolvedValue({});
    fakeDb({
      // documento do OUTRO_ID colado no registro deste usuario
      findOne: async () => ({
        ciphertext: encryptToken(TOKEN, OUTRO_ID),
        expiresAt: daqui(86_400_000),
      }),
      deleteOne,
    });

    expect(await loadToken(USER_ID)).toBeNull();
    expect(deleteOne).toHaveBeenCalledTimes(1); // registro inutil nao fica no banco
  });

  it("apaga o registro quando a chave nao decifra mais", async () => {
    const cifradoComOutraChave = encryptToken(TOKEN, USER_ID);
    process.env.TOKEN_SECRET = "3".repeat(64);

    const deleteOne = vi.fn().mockResolvedValue({});
    fakeDb({
      findOne: async () => ({ ciphertext: cifradoComOutraChave, expiresAt: daqui(86_400_000) }),
      deleteOne,
    });

    expect(await loadToken(USER_ID)).toBeNull();
    expect(deleteOne).toHaveBeenCalledTimes(1);
  });
});

describe("tokenStatus", () => {
  it("expoe apenas metadados, nunca o token", async () => {
    const expiresAt = daqui(86_400_000);
    fakeDb({
      findOne: async () => ({
        ciphertext: encryptToken(TOKEN, USER_ID),
        expiresAt,
        vercelUsername: "afonso",
      }),
    });

    const status = await tokenStatus(USER_ID);
    expect(status).toEqual({ expiresAt, vercelUsername: "afonso" });
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });

  it("devolve null quando o documento venceu", async () => {
    fakeDb({ findOne: async () => ({ expiresAt: daqui(-1) }) });
    expect(await tokenStatus(USER_ID)).toBeNull();
  });
});

describe("forgetToken", () => {
  it("apaga o registro do usuario", async () => {
    const deleteOne = vi.fn().mockResolvedValue({});
    fakeDb({ deleteOne });

    await forgetToken(USER_ID);

    expect(String(deleteOne.mock.calls[0][0].userId)).toBe(USER_ID);
  });

  it("ignora userId invalido", async () => {
    await forgetToken("nao-e-objectid");
    expect(getDb).not.toHaveBeenCalled();
  });
});
