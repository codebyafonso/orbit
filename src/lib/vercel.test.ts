import { describe, it, expect, afterEach, vi } from "vitest";
import { normalize, repoFrom, listProjects, whoami, VercelError } from "./vercel";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(pages: unknown[]) {
  const fn = vi.fn();
  pages.forEach((body) =>
    fn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("repoFrom", () => {
  it("monta a url do github a partir de org e repo", () => {
    expect(repoFrom({ type: "github", org: "codebyafonso", repo: "support-hub" })).toEqual({
      provider: "github",
      label: "codebyafonso/support-hub",
      url: "https://github.com/codebyafonso/support-hub",
    });
  });

  it("devolve null quando nao ha vinculo", () => {
    expect(repoFrom(undefined)).toBeNull();
    expect(repoFrom({ type: "github" })).toBeNull();
  });

  it("ignora url de esquema perigoso e usa a construida", () => {
    const r = repoFrom({
      type: "gitlab",
      projectNamespace: "grupo",
      projectName: "app",
      projectUrl: "javascript:alert(1)",
    });
    expect(r?.url).toBe("https://gitlab.com/grupo/app");
  });
});

describe("normalize", () => {
  it("prefere o alias de producao e prefixa https", () => {
    const p = normalize({
      id: "prj_1",
      name: "app",
      framework: "nextjs",
      createdAt: 1,
      alias: [
        { domain: "preview.exemplo.com" },
        { domain: "app.exemplo.com", target: "PRODUCTION" },
      ],
    });
    expect(p.productionUrl).toBe("https://app.exemplo.com");
  });

  it("sobrevive a projeto sem deployment", () => {
    const p = normalize({ id: "prj_2", name: "vazio", framework: null, createdAt: 1 });
    expect(p.latestDeployment).toBeNull();
    expect(p.productionUrl).toBeNull();
  });
});

describe("listProjects", () => {
  it("usa o token recebido e agrega as paginas", async () => {
    const fn = mockFetch([
      {
        projects: [{ id: "a", name: "a", framework: null, createdAt: 1 }],
        pagination: { next: 99 },
      },
      {
        projects: [{ id: "b", name: "b", framework: null, createdAt: 2 }],
        pagination: { next: null },
      },
    ]);
    const r = await listProjects({ token: "tok_123" });
    expect(r.projects.map((p) => p.id)).toEqual(["a", "b"]);
    expect(r.truncated).toBe(false);
    expect(fn.mock.calls[0][1].headers.Authorization).toBe("Bearer tok_123");
    // a segunda pagina precisa usar o cursor devolvido pela primeira
    expect(String(fn.mock.calls[1][0])).toContain("until=99");
  });

  it("marca truncated quando atinge o teto sem esgotar as paginas", async () => {
    mockFetch([
      {
        projects: [{ id: "a", name: "a", framework: null, createdAt: 1 }],
        pagination: { next: 99 },
      },
    ]);
    const r = await listProjects({ token: "tok" }, { max: 1 });
    expect(r.truncated).toBe(true);
    expect(r.projects).toHaveLength(1);
  });

  it("inclui teamId na query quando informado", async () => {
    const fn = mockFetch([{ projects: [], pagination: { next: null } }]);
    await listProjects({ token: "tok", teamId: "team_9" });
    expect(String(fn.mock.calls[0][0])).toContain("teamId=team_9");
  });
});

describe("whoami", () => {
  it("propaga erro da api como VercelError com status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: "Not authorized" } }),
      }),
    );
    await expect(whoami({ token: "x" })).rejects.toMatchObject({
      message: "Not authorized",
      status: 403,
    });
    await expect(whoami({ token: "x" })).rejects.toBeInstanceOf(VercelError);
  });
});
