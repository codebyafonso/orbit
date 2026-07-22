import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("./mongo", () => ({ getDb: vi.fn() }));

import { getDb } from "./mongo";
import { createUser, verifyUser } from "./users";

const ID = new ObjectId("665f1f77bcf86cd799439011");

beforeEach(() => vi.mocked(getDb).mockReset());

describe("createUser", () => {
  it("recusa senha curta antes de tocar no banco", async () => {
    expect(await createUser("a@b.com", "123")).toEqual({ erro: expect.any(String) });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("recusa email invalido antes de tocar no banco", async () => {
    expect(await createUser("nao-e-email", "senha-bem-longa")).toEqual({ erro: expect.any(String) });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("degrada com mensagem quando o banco esta fora", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    expect(await createUser("a@b.com", "senha-bem-longa")).toEqual({ erro: expect.any(String) });
  });

  it("nunca grava a senha em claro, normaliza o email e devolve id em hex", async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: ID });
    vi.mocked(getDb).mockResolvedValue({ collection: () => ({ insertOne }) } as never);

    const r = await createUser("  Afonso@Exemplo.COM ", "senha-bem-longa");

    const doc = insertOne.mock.calls[0][0];
    expect(doc.email).toBe("afonso@exemplo.com");
    expect(doc.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(JSON.stringify(doc)).not.toContain("senha-bem-longa");
    expect(r).toEqual({ user: { id: "665f1f77bcf86cd799439011", email: "afonso@exemplo.com" } });
    expect(doc.pending).toBe(true); // so vira conta utilizavel apos guardar o token
    expect(doc.pendingUntil).toBeInstanceOf(Date);
  });

  it("traduz colisao do indice unico em erro de dominio", async () => {
    // Sem findOne previo: quem garante unicidade e o indice, nao a leitura.
    const insertOne = vi.fn().mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    vi.mocked(getDb).mockResolvedValue({ collection: () => ({ insertOne }) } as never);

    expect(await createUser("a@b.com", "senha-bem-longa")).toEqual({ erro: expect.any(String) });
  });

  it("propaga erro inesperado do banco em vez de mascarar", async () => {
    const insertOne = vi.fn().mockRejectedValue(new Error("disco cheio"));
    vi.mocked(getDb).mockResolvedValue({ collection: () => ({ insertOne }) } as never);

    await expect(createUser("a@b.com", "senha-bem-longa")).rejects.toThrow("disco cheio");
  });
});

describe("verifyUser", () => {
  async function comUsuario(senhaCorreta: string) {
    const { hash } = await import("@node-rs/argon2");
    const updateOne = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue({
      _id: ID,
      email: "a@b.com",
      passwordHash: await hash(senhaCorreta),
    });
    vi.mocked(getDb).mockResolvedValue({ collection: () => ({ findOne, updateOne }) } as never);
    return { updateOne, findOne };
  }

  it("devolve null para email inexistente", async () => {
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({ findOne: async () => null }),
    } as never);
    expect(await verifyUser("a@b.com", "qualquer")).toBeNull();
  });

  it("gasta tempo comparavel com e sem usuario (sem oraculo de timing)", async () => {
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({ findOne: async () => null }),
    } as never);
    const t0 = performance.now();
    await verifyUser("naoexiste@b.com", "senha-bem-longa");
    const semUsuario = performance.now() - t0;

    await comUsuario("senha-correta");
    const t1 = performance.now();
    await verifyUser("a@b.com", "senha-errada");
    const comUsuarioMs = performance.now() - t1;

    // Sem o hash dummy a diferenca seria de ordens de grandeza (~1ms vs ~50ms).
    expect(semUsuario).toBeGreaterThan(comUsuarioMs / 5);
  });

  it("devolve null para senha errada e nao atualiza lastLoginAt", async () => {
    const { updateOne } = await comUsuario("senha-correta");
    expect(await verifyUser("a@b.com", "senha-errada")).toBeNull();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("aceita a senha correta e registra o acesso", async () => {
    const { updateOne } = await comUsuario("senha-correta");

    expect(await verifyUser("a@b.com", "senha-correta")).toEqual({
      id: "665f1f77bcf86cd799439011",
      email: "a@b.com",
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: ID },
      { $set: { lastLoginAt: expect.any(Date) } },
    );
  });

  it("recusa conta pendente, mesmo com a senha certa", async () => {
    const { hash } = await import("@node-rs/argon2");
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: async () => ({
          _id: ID,
          email: "a@b.com",
          passwordHash: await hash("senha-correta"),
          pending: true,
        }),
        updateOne: vi.fn(),
      }),
    } as never);
    expect(await verifyUser("a@b.com", "senha-correta")).toBeNull();
  });

  it("devolve null quando o documento nao tem hash utilizavel", async () => {
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({ findOne: async () => ({ _id: ID, email: "a@b.com" }) }),
    } as never);
    expect(await verifyUser("a@b.com", "qualquer")).toBeNull();
  });
});
