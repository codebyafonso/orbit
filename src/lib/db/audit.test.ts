import { describe, it, expect, vi, beforeEach } from "vitest";

// getDb e mockado: o teste precisa provar os dois caminhos, e nao depender de
// um Mongo real nem do cache interno da conexao.
vi.mock("./mongo", () => ({ getDb: vi.fn() }));

import { getDb } from "./mongo";
import { recordDeletion, listDeletions } from "./audit";

const entrada = {
  userId: "usr_1",
  projectId: "prj_1",
  projectName: "app",
  result: "ok" as const,
};

beforeEach(() => vi.mocked(getDb).mockReset());

describe("sem banco", () => {
  beforeEach(() => vi.mocked(getDb).mockResolvedValue(null));

  it("registra sem lancar e sem gravar nada", async () => {
    await expect(recordDeletion(entrada)).resolves.toBeUndefined();
  });

  it("devolve lista vazia", async () => {
    await expect(listDeletions("usr_1")).resolves.toEqual([]);
  });
});

describe("com banco", () => {
  it("grava o documento de auditoria", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({ insertOne }),
    } as never);

    await recordDeletion(entrada);

    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(insertOne.mock.calls[0][0]).toMatchObject({
      userId: "usr_1",
      action: "project.delete",
      projectId: "prj_1",
      projectName: "app",
      result: "ok",
      error: null,
    });
    expect(insertOne.mock.calls[0][0].at).toBeInstanceOf(Date);
  });

  it("le o historico do usuario mais recente primeiro", async () => {
    const at = new Date("2026-07-01T10:00:00Z");
    const find = vi.fn().mockReturnValue({
      sort: () => ({
        limit: () => ({
          toArray: async () => [
            { projectId: "prj_9", projectName: "velho", result: "error", error: "falhou", at },
          ],
        }),
      }),
    });
    vi.mocked(getDb).mockResolvedValue({ collection: () => ({ find }) } as never);

    await expect(listDeletions("usr_1")).resolves.toEqual([
      { projectId: "prj_9", projectName: "velho", result: "error", error: "falhou", at },
    ]);
    expect(find).toHaveBeenCalledWith({ userId: "usr_1" });
  });
});
