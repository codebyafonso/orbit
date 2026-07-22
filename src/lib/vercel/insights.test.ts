import { describe, it, expect } from "vitest";
import { avaliarProjeto, calcularTendencias, formatarPeriodo, DIAS_PARADO } from "./insights";
import type { Project, Deployment } from "./client";

const DIA = 86_400_000;
const AGORA = new Date("2026-07-22T12:00:00Z").getTime();

function projeto(over: Partial<Project> = {}): Project {
  return {
    id: "prj_1",
    name: "app",
    framework: "nextjs",
    createdAt: AGORA - 400 * DIA,
    updatedAt: AGORA,
    productionUrl: "https://app.exemplo.com",
    repo: { provider: "github", label: "eu/app", url: "https://github.com/eu/app" },
    latestDeployment: {
      id: "dpl_1",
      url: "https://app.vercel.app",
      state: "READY",
      createdAt: AGORA - DIA,
      target: "production",
    },
    ...over,
  };
}

function deploy(over: Partial<Deployment> = {}): Deployment {
  return {
    id: "dpl",
    projectId: "prj_1",
    projectName: "app",
    state: "READY",
    target: "production",
    source: "git",
    createdAt: AGORA - DIA,
    buildMs: 30_000,
    inspectorUrl: null,
    ...over,
  };
}

describe("avaliarProjeto", () => {
  it("nao acusa nada em projeto saudavel", () => {
    const r = avaliarProjeto(projeto(), AGORA);
    expect(r.alertas).toEqual([]);
    expect(r.risco).toBe(0);
  });

  it("acusa projeto parado ha mais de 90 dias, com o periodo no texto", () => {
    const r = avaliarProjeto(
      projeto({
        latestDeployment: {
          id: "d",
          url: null,
          state: "READY",
          createdAt: AGORA - 200 * DIA,
          target: "production",
        },
      }),
      AGORA,
    );
    const parado = r.alertas.find((a) => a.codigo === "parado");
    expect(parado?.texto).toBe("Sem deploy ha 6 meses");
  });

  it("nao acusa parado no limite do prazo", () => {
    const r = avaliarProjeto(
      projeto({
        latestDeployment: {
          id: "d",
          url: null,
          state: "READY",
          createdAt: AGORA - (DIAS_PARADO - 1) * DIA,
          target: "production",
        },
      }),
      AGORA,
    );
    expect(r.alertas.some((a) => a.codigo === "parado")).toBe(false);
  });

  it("distingue nunca publicado de parado", () => {
    const r = avaliarProjeto(projeto({ latestDeployment: null, productionUrl: null }), AGORA);
    const codigos = r.alertas.map((a) => a.codigo);
    expect(codigos).toContain("nunca-publicado");
    expect(codigos).not.toContain("parado");
  });

  it("soma o risco de varios problemas", () => {
    const r = avaliarProjeto(
      projeto({
        productionUrl: null,
        repo: null,
        latestDeployment: {
          id: "d",
          url: null,
          state: "ERROR",
          createdAt: AGORA - 200 * DIA,
          target: "production",
        },
      }),
      AGORA,
    );
    // parado(2) + build quebrado(3) + sem dominio(2) + sem repo(1)
    expect(r.risco).toBe(8);
    expect(r.alertas).toHaveLength(4);
  });
});

describe("formatarPeriodo", () => {
  it("usa dias, meses e anos", () => {
    expect(formatarPeriodo(1)).toBe("1 dia");
    expect(formatarPeriodo(12)).toBe("12 dias");
    expect(formatarPeriodo(45)).toBe("1 mes");
    expect(formatarPeriodo(200)).toBe("6 meses");
    expect(formatarPeriodo(400)).toBe("1 ano");
  });
});

describe("calcularTendencias", () => {
  it("ignora deploys fora da janela", () => {
    const t = calcularTendencias(
      [deploy({ createdAt: AGORA - 2 * DIA }), deploy({ createdAt: AGORA - 300 * DIA })],
      { semanas: 8, agora: AGORA },
    );
    expect(t.totalDeploys).toBe(1);
  });

  it("conta apenas ERROR como falha; cancelado nao e quebra", () => {
    const t = calcularTendencias(
      [
        deploy({ state: "READY" }),
        deploy({ state: "ERROR" }),
        deploy({ state: "CANCELED" }),
        deploy({ state: "READY" }),
      ],
      { agora: AGORA },
    );
    expect(t.falhas).toBe(1);
    expect(t.taxaFalha).toBe(0.25);
  });

  it("agrupa por semana em ordem cronologica", () => {
    const t = calcularTendencias(
      [deploy({ createdAt: AGORA - DIA }), deploy({ createdAt: AGORA - 9 * DIA })],
      { semanas: 4, agora: AGORA },
    );
    expect(t.porSemana).toHaveLength(4);
    expect(t.porSemana.at(-1)?.total).toBe(1); // semana atual
    expect(t.porSemana.reduce((s, w) => s + w.total, 0)).toBe(2);

    // a ordem precisa ser crescente: sem isto o grafico sairia espelhado
    const inicios = t.porSemana.map((w) => w.inicio);
    expect(inicios).toEqual([...inicios].sort((a, b) => a - b));
  });

  it("nao perde deploy com data no futuro (relogio adiantado)", () => {
    const t = calcularTendencias([deploy({ createdAt: AGORA + 60_000 })], { agora: AGORA });
    expect(t.totalDeploys).toBe(1);
    expect(t.porSemana.reduce((s, w) => s + w.total, 0)).toBe(1); // invariante
  });

  it("ranqueia quem mais quebra", () => {
    const t = calcularTendencias(
      [
        deploy({ projectId: "a", projectName: "alfa", state: "ERROR" }),
        deploy({ projectId: "a", projectName: "alfa", state: "ERROR" }),
        deploy({ projectId: "b", projectName: "beta", state: "ERROR" }),
        deploy({ projectId: "c", projectName: "gama", state: "READY" }),
      ],
      { agora: AGORA },
    );
    expect(t.ranking.map((r) => r.nome)).toEqual(["alfa", "beta"]); // gama nao entra
    expect(t.ranking[0].taxa).toBe(1);
  });

  it("detecta build ficando mais lento comparando 14 dias contra os 14 anteriores", () => {
    const antigos = Array.from({ length: 3 }, (_, i) =>
      deploy({ createdAt: AGORA - (25 - i) * DIA, buildMs: 20_000 }),
    );
    const novos = Array.from({ length: 3 }, (_, i) =>
      deploy({ createdAt: AGORA - (10 - i) * DIA, buildMs: 40_000 }),
    );
    const t = calcularTendencias([...antigos, ...novos], { agora: AGORA });

    expect(t.buildTendencia?.variacao).toBeCloseTo(1); // dobrou
  });

  it("compara janelas fixas de tempo, ignorando builds antigos", () => {
    // O corte por contagem cairia nesta armadilha: uma rajada recente viraria a
    // "metade recente" e semanas inteiras, a "metade antiga". Aqui os builds de
    // 40 dias atras nao podem influenciar nada.
    // 45 a 31 dias atras: fora das duas janelas de comparacao
    const antiquissimos = Array.from({ length: 15 }, (_, i) =>
      deploy({ createdAt: AGORA - (45 - i) * DIA, buildMs: 5_000 }),
    );
    const anteriores = Array.from({ length: 3 }, (_, i) =>
      deploy({ createdAt: AGORA - (20 + i) * DIA, buildMs: 20_000 }),
    );
    const rajadaRecente = Array.from({ length: 40 }, () =>
      deploy({ createdAt: AGORA - 2 * DIA, buildMs: 20_000 }),
    );
    const t = calcularTendencias([...antiquissimos, ...anteriores, ...rajadaRecente], {
      agora: AGORA,
    });

    expect(t.buildTendencia?.variacao).toBe(0); // mesmo tempo dos dois lados
  });

  it("exige pelo menos tres builds de cada lado", () => {
    const doisLados = [
      ...Array.from({ length: 2 }, (_, i) => deploy({ createdAt: AGORA - (20 + i) * DIA })),
      ...Array.from({ length: 3 }, (_, i) => deploy({ createdAt: AGORA - (5 + i) * DIA })),
    ];
    expect(calcularTendencias(doisLados, { agora: AGORA }).buildTendencia).toBeNull();
  });

  it("sobrevive a lista vazia", () => {
    const t = calcularTendencias([], { agora: AGORA });
    expect(t).toMatchObject({ totalDeploys: 0, falhas: 0, taxaFalha: 0, buildMedioMs: null });
  });
});
