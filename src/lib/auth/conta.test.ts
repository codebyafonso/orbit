import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("../db/mongo", () => ({ getDb: vi.fn() }));

import { getDb } from "../db/mongo";
import { purgeUser, changePassword, checkPassword } from "./users";

const ID = "665f1f77bcf86cd799439011";
const EMAIL = "afonso@exemplo.com";

beforeEach(() => vi.mocked(getDb).mockReset());

/** Registra o que foi apagado de cada colecao. */
function bancoFalso(extra: Record<string, unknown> = {}) {
  const chamadas: { colecao: string; filtro: Record<string, unknown> }[] = [];
  const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 1 });
  const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
  const updateOne = vi.fn().mockResolvedValue({});

  vi.mocked(getDb).mockResolvedValue({
    collection: (nome: string) => ({
      deleteMany: (filtro: Record<string, unknown>) => {
        chamadas.push({ colecao: nome, filtro });
        return deleteMany(filtro);
      },
      deleteOne: (filtro: Record<string, unknown>) => {
        chamadas.push({ colecao: nome, filtro });
        return deleteOne(filtro);
      },
      updateOne,
      ...extra,
    }),
  } as never);

  return { chamadas, updateOne };
}

describe("purgeUser", () => {
  it("apaga todas as colecoes com o tipo de chave que cada uma usa", async () => {
    // Congela a correspondencia: uniformizar os filtros quebraria o purge em
    // silencio, deixando dados de quem pediu para sumir.
    const { chamadas } = bancoFalso();

    const r = await purgeUser(ID, EMAIL);

    const porColecao = Object.fromEntries(chamadas.map((c) => [c.colecao, c.filtro]));
    expect(porColecao.vercel_tokens).toEqual({ userId: new ObjectId(ID) });
    expect(porColecao.sessions).toEqual({ userId: ID }); // string, como startSession grava
    expect(porColecao.snapshots).toEqual({ userId: new ObjectId(ID) });
    expect(porColecao.audit_logs).toEqual({ userId: ID }); // string, como recordDeletion grava
    expect(porColecao.users).toEqual({ _id: new ObjectId(ID) });
    expect(r.removidos.users).toBe(1);
  });

  it("limpa os contadores do limitador que guardam email e id", async () => {
    const { chamadas } = bancoFalso();
    await purgeUser(ID, "Afonso@Exemplo.COM");

    const filtro = chamadas.find((c) => c.colecao === "rate_limits")?.filtro as {
      chave: { $in: string[] };
    };
    expect(filtro.chave.$in).toContain(`login-conta:${EMAIL}`); // normalizado
    expect(filtro.chave.$in).toContain(`senha:${ID}`);
  });

  it("marca a conta como pendente antes de apagar", async () => {
    // Se algo falhar no meio, a conta ja nao loga — e uma nova tentativa e segura.
    const { chamadas, updateOne } = bancoFalso();
    await purgeUser(ID, EMAIL);

    expect(updateOne).toHaveBeenCalledWith({ _id: new ObjectId(ID) }, { $set: { pending: true } });
    expect(chamadas[0].colecao).toBe("vercel_tokens"); // o item sensivel sai primeiro
  });

  it("apaga o usuario mesmo se uma colecao falhar", async () => {
    const { chamadas } = bancoFalso();
    vi.mocked(getDb).mockResolvedValue({
      collection: (nome: string) => ({
        updateOne: vi.fn().mockResolvedValue({}),
        deleteMany: async (filtro: Record<string, unknown>) => {
          chamadas.push({ colecao: nome, filtro });
          if (nome === "snapshots") throw new Error("indisponivel");
          return { deletedCount: 2 };
        },
        deleteOne: async () => ({ deletedCount: 1 }),
      }),
    } as never);

    const r = await purgeUser(ID, EMAIL);

    expect(r.removidos.users).toBe(1); // orfao sem dono e melhor que conta viva
    expect(r.removidos.snapshots).toBeUndefined();
  });

  it("lanca para id invalido em vez de responder sucesso vazio", async () => {
    await expect(purgeUser("nao-e-objectid", EMAIL)).rejects.toThrow();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("lanca quando o banco esta fora", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    await expect(purgeUser(ID, EMAIL)).rejects.toThrow(/Banco indisponivel/);
  });
});

describe("changePassword", () => {
  async function comSenha(atual: string) {
    const { hash } = await import("@node-rs/argon2");
    const passwordHash = await hash(atual);
    const updateOne = vi.fn().mockResolvedValue({});
    const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 3 });

    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: async () => ({ _id: new ObjectId(ID), email: EMAIL, passwordHash }),
        updateOne,
        deleteMany,
      }),
    } as never);

    return { updateOne, deleteMany };
  }

  it("recusa a senha atual errada sem tocar no hash", async () => {
    const { updateOne } = await comSenha("senha-correta-1");
    expect(await changePassword(ID, "errada", "outra-senha-longa")).toEqual({
      erro: expect.any(String),
    });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("recusa nova senha igual a atual", async () => {
    // Trocar pela mesma senha daria falsa sensacao de ter rotacionado o segredo.
    const { updateOne } = await comSenha("senha-correta-1");
    expect(await changePassword(ID, "senha-correta-1", "senha-correta-1")).toEqual({
      erro: expect.any(String),
    });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("recusa nova senha curta", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    expect(await changePassword(ID, "qualquer", "curta")).toEqual({ erro: expect.any(String) });
  });

  it("troca o hash e encerra todas as sessoes", async () => {
    const { updateOne, deleteMany } = await comSenha("senha-correta-1");

    expect(await changePassword(ID, "senha-correta-1", "nova-senha-longa-9")).toEqual({ ok: true });

    const novoHash = updateOne.mock.calls[0][1].$set.passwordHash;
    expect(novoHash.startsWith("$argon2id$")).toBe(true);
    expect(novoHash).not.toContain("nova-senha-longa-9");
    expect(deleteMany).toHaveBeenCalledWith({ userId: ID });
  });
});

describe("checkPassword", () => {
  it("recusa id invalido e banco fora", async () => {
    expect(await checkPassword("nao-e-objectid", "x")).toBe(false);
    vi.mocked(getDb).mockResolvedValue(null);
    expect(await checkPassword(ID, "x")).toBe(false);
  });

  it("recusa quando o usuario nao existe, sem atalho de tempo", async () => {
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({ findOne: async () => null }),
    } as never);
    expect(await checkPassword(ID, "qualquer")).toBe(false);
  });

  it("aceita a senha correta", async () => {
    const { hash } = await import("@node-rs/argon2");
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: async () => ({ _id: new ObjectId(ID), passwordHash: await hash("senha-certa-1") }),
      }),
    } as never);
    expect(await checkPassword(ID, "senha-certa-1")).toBe(true);
  });
});
