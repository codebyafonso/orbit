import type { Project, Deployment } from "./vercel";

const DIA = 86_400_000;
export const DIAS_PARADO = 90;

export type Alerta = {
  codigo: "parado" | "build-quebrado" | "sem-dominio" | "sem-repo" | "nunca-publicado";
  texto: string;
  peso: number;
};

export type ProjetoAvaliado = {
  id: string;
  nome: string;
  alertas: Alerta[];
  /** Soma dos pesos: quanto maior, mais forte o caso para revisar o projeto. */
  risco: number;
  diasSemDeploy: number | null;
};

function diasDesde(ts: number | null | undefined, agora: number): number | null {
  if (!ts) return null;
  return Math.floor((agora - ts) / DIA);
}

/**
 * Motivos concretos para olhar (ou apagar) um projeto.
 *
 * Cada alerta carrega o texto que aparece na tela: a ideia e nunca mostrar um
 * rotulo generico como "risco alto" sem dizer por que.
 */
export function avaliarProjeto(p: Project, agora = Date.now()): ProjetoAvaliado {
  const alertas: Alerta[] = [];
  const ultimo = p.latestDeployment?.createdAt ?? null;
  const diasSemDeploy = diasDesde(ultimo, agora);

  if (!p.latestDeployment) {
    alertas.push({
      codigo: "nunca-publicado",
      texto: "Nunca teve um deploy",
      peso: 3,
    });
  } else if (diasSemDeploy !== null && diasSemDeploy >= DIAS_PARADO) {
    alertas.push({
      codigo: "parado",
      texto: `Sem deploy ha ${formatarPeriodo(diasSemDeploy)}`,
      peso: 2,
    });
  }

  if (p.latestDeployment?.state === "ERROR") {
    alertas.push({
      codigo: "build-quebrado",
      texto: "O ultimo deploy falhou",
      peso: 3,
    });
  }

  if (!p.productionUrl) {
    alertas.push({
      codigo: "sem-dominio",
      texto: "Nenhum endereco de producao apontando",
      peso: 2,
    });
  }

  if (!p.repo) {
    alertas.push({
      codigo: "sem-repo",
      texto: "Sem repositorio vinculado",
      peso: 1,
    });
  }

  return {
    id: p.id,
    nome: p.name,
    alertas,
    risco: alertas.reduce((soma, a) => soma + a.peso, 0),
    diasSemDeploy,
  };
}

export function formatarPeriodo(dias: number): string {
  if (dias === 1) return "1 dia";
  if (dias < 30) return `${dias} dias`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `${meses} ${meses === 1 ? "mes" : "meses"}`;
  const anos = Math.floor(meses / 12);
  return `${anos} ${anos === 1 ? "ano" : "anos"}`;
}

export type Tendencias = {
  totalDeploys: number;
  falhas: number;
  taxaFalha: number;
  buildMedioMs: number | null;
  /** Deploys por semana, da mais antiga para a mais recente. */
  porSemana: { inicio: number; total: number; falhas: number }[];
  /** Projetos que mais falharam, do pior para o melhor. */
  ranking: { projectId: string; nome: string; total: number; falhas: number; taxa: number }[];
  /** Variacao do tempo de build: metade recente vs metade anterior. */
  buildTendencia: { anterior: number; recente: number; variacao: number } | null;
};

/**
 * Cancelado nao e falha: quase sempre e substituicao automatica por um commit
 * novo. Contar como quebra acusaria justamente os projetos mais ativos — e
 * seria incoerente com o alerta "build quebrado", que so olha ERROR.
 */
const FALHOU = (estado: string | null) => estado === "ERROR";

export function calcularTendencias(
  deployments: Deployment[],
  { semanas = 8, agora = Date.now() }: { semanas?: number; agora?: number } = {},
): Tendencias {
  const janela = agora - semanas * 7 * DIA;
  const recentes = deployments.filter((d) => d.createdAt >= janela);

  const falhas = recentes.filter((d) => FALHOU(d.state)).length;
  const comBuild = recentes.filter((d) => typeof d.buildMs === "number" && d.buildMs > 0);
  const media = (lista: Deployment[]) =>
    lista.length ? Math.round(lista.reduce((s, d) => s + (d.buildMs ?? 0), 0) / lista.length) : null;

  // Semanas alinhadas ao momento atual, da mais antiga para a mais recente.
  const porSemana = Array.from({ length: semanas }, (_, i) => {
    const limite = agora - i * 7 * DIA;
    const inicio = limite - 7 * DIA;
    // O topo da semana corrente e aberto: um deploy com data no futuro (relogio
    // adiantado no servidor da Vercel) entraria na janela mas em balde nenhum.
    const fim = i === 0 ? Number.POSITIVE_INFINITY : limite;
    const daSemana = recentes.filter((d) => d.createdAt >= inicio && d.createdAt < fim);
    return {
      inicio,
      total: daSemana.length,
      falhas: daSemana.filter((d) => FALHOU(d.state)).length,
    };
  }).reverse();

  const porProjeto = new Map<string, { nome: string; total: number; falhas: number }>();
  for (const d of recentes) {
    const atual = porProjeto.get(d.projectId) ?? { nome: d.projectName, total: 0, falhas: 0 };
    atual.total += 1;
    if (FALHOU(d.state)) atual.falhas += 1;
    porProjeto.set(d.projectId, atual);
  }

  const ranking = [...porProjeto.entries()]
    .map(([projectId, v]) => ({ projectId, ...v, taxa: v.total ? v.falhas / v.total : 0 }))
    .filter((r) => r.falhas > 0)
    .sort((a, b) => b.falhas - a.falhas || b.taxa - a.taxa);

  // Corte por TEMPO, nao por contagem: dividir a lista ao meio compararia uma
  // rajada de uma tarde contra semanas inteiras e acusaria regressao falsa.
  const corte = agora - 14 * DIA;
  const anteriores = comBuild.filter((d) => d.createdAt >= corte - 14 * DIA && d.createdAt < corte);
  const recentesBuild = comBuild.filter((d) => d.createdAt >= corte);
  const anterior = media(anteriores);
  const recente = media(recentesBuild);
  const amostraSuficiente = anteriores.length >= 3 && recentesBuild.length >= 3;

  return {
    totalDeploys: recentes.length,
    falhas,
    taxaFalha: recentes.length ? falhas / recentes.length : 0,
    buildMedioMs: media(comBuild),
    porSemana,
    ranking,
    buildTendencia:
      anterior && recente && amostraSuficiente
        ? { anterior, recente, variacao: (recente - anterior) / anterior }
        : null,
  };
}
