import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("./mongo", () => ({ getDb: vi.fn() }));

import { getDb } from "./mongo";
import { registrarSnapshot, historico } from "./snapshots";

const USER_ID = "665f1f77bcf86cd799439011";
const DADOS = { projetos: 3, deploys7d: 10, falhas7d: 1, buildMedioMs: 20_000 };

beforeEach(() => vi.mocked(getDb).mockReset());

function fakeDb(handlers: Record<string, unknown>) {
  const collection = vi.fn(() => handlers);
  vi.mocked(getDb).mockResolvedValue({ collection } as never);
  return collection;
}

describe("registrarSnapshot", () => {
  it("grava um documento por usuario e por dia", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const collection = fakeDb({ updateOne });

    await registrarSnapshot(USER_ID, DADOS);

    expect(collection).toHaveBeenCalledWith("snapshots");
    const [filtro, update, opcoes] = updateOne.mock.calls[0];
    expect(String(filtro.userId)).toBe(USER_ID);
    expect(filtro.dia).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(update.$set).toMatchObject(DADOS);
    expect(update.$set.at).toBeInstanceOf(Date); // campo do indice TTL
    expect(opcoes).toEqual({ upsert: true });
  });

  it("repete a gravacao quando duas visitas colidem no mesmo dia", async () => {
    // Upsert concorrente sob indice unico devolve E11000; a segunda tentativa
    // encontra o documento e so atualiza.
    const updateOne = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: 11000 }))
      .mockResolvedValueOnce({});
    fakeDb({ updateOne });

    await registrarSnapshot(USER_ID, DADOS);

    expect(updateOne).toHaveBeenCalledTimes(2);
  });

  it("nao repete quando o erro nao e colisao de chave", async () => {
    const updateOne = vi.fn().mockRejectedValue(Object.assign(new Error("outro"), { code: 121 }));
    fakeDb({ updateOne });

    await registrarSnapshot(USER_ID, DADOS);

    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it("ignora userId invalido sem tocar no banco", async () => {
    await registrarSnapshot("nao-e-objectid", DADOS);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("nao lanca quando o banco esta fora", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    await expect(registrarSnapshot(USER_ID, DADOS)).resolves.toBeUndefined();
  });
});

describe("historico", () => {
  it("devolve do mais antigo para o mais recente", async () => {
    // O banco entrega em ordem decrescente; o grafico precisa do contrario.
    const toArray = async () => [
      { dia: "2026-07-22", projetos: 3, deploys7d: 5, falhas7d: 0, buildMedioMs: 1000 },
      { dia: "2026-07-21", projetos: 3, deploys7d: 2, falhas7d: 1, buildMedioMs: 900 },
    ];
    const find = vi.fn().mockReturnValue({ sort: () => ({ limit: () => ({ toArray }) }) });
    fakeDb({ find });

    const r = await historico(USER_ID);

    expect(r.map((x) => x.dia)).toEqual(["2026-07-21", "2026-07-22"]);
    expect(String(find.mock.calls[0][0].userId)).toBe(USER_ID);
  });

  it("normaliza documento incompleto em vez de quebrar", async () => {
    const toArray = async () => [{ dia: "2026-07-22" }];
    fakeDb({ find: () => ({ sort: () => ({ limit: () => ({ toArray }) }) }) });

    expect(await historico(USER_ID)).toEqual([
      { dia: "2026-07-22", projetos: 0, deploys7d: 0, falhas7d: 0, buildMedioMs: null },
    ]);
  });

  it("devolve vazio quando o banco esta fora", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    expect(await historico(USER_ID)).toEqual([]);
  });

  it("recusa userId invalido antes de tocar no banco", async () => {
    // Com o banco mockado como null, o teste passaria mesmo sem a guarda.
    fakeDb({ find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }) });
    vi.mocked(getDb).mockClear();

    expect(await historico("invalido")).toEqual([]);
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("isolamento", () => {
  it("nunca consulta sem o userId no filtro", async () => {
    const find = vi.fn().mockReturnValue({
      sort: () => ({ limit: () => ({ toArray: async () => [] }) }),
    });
    fakeDb({ find });

    await historico(USER_ID);

    expect(find.mock.calls[0][0]).toEqual({ userId: new ObjectId(USER_ID) });
  });
});
