import { NextResponse } from "next/server";
import { listProjects, listDeployments, VercelError } from "@/lib/vercel/client";
import { requireAuth } from "@/lib/auth/api-session";
import { avaliarProjeto, calcularTendencias } from "@/lib/vercel/insights";
import { registrarSnapshot, historico } from "@/lib/db/snapshots";
import { rateLimit } from "@/lib/auth/rate-limit";

export const dynamic = "force-dynamic";

const DIA = 86_400_000;

export async function GET() {
  const { session, auth, response } = await requireAuth();
  if (response) return response;

  // Cada chamada aqui vira 3-4 requisicoes a api.vercel.com com o token do
  // usuario. Sem freio, um laco no navegador esgotaria o rate limit da conta
  // Vercel dele — o botao so carregar sob demanda e um freio de cliente, e
  // cliente nao e barreira.
  const limite = await rateLimit(`insights:${session.userId}`, { max: 30, janelaSegundos: 300 });
  if (!limite.ok) {
    return NextResponse.json(
      { error: "Muitas consultas seguidas. Aguarde um instante." },
      { status: limite.motivo === "indisponivel" ? 503 : 429 },
    );
  }

  try {
    // A janela e definida por TEMPO, nao por quantidade: pedir "os ultimos 200"
    // daria 3 dias numa conta movimentada, enquanto a tela promete 8 semanas.
    const SEMANAS = 8;
    const [lista, historicoDeploys] = await Promise.all([
      listProjects(auth),
      listDeployments(auth, { desde: Date.now() - SEMANAS * 7 * DIA, max: 2000 }),
    ]);
    const deployments = historicoDeploys.deployments;

    const avaliados = lista.projects
      .map((p) => avaliarProjeto(p))
      .filter((a) => a.alertas.length > 0)
      .sort((a, b) => b.risco - a.risco || (b.diasSemDeploy ?? 0) - (a.diasSemDeploy ?? 0));

    const tendencias = calcularTendencias(deployments, { semanas: SEMANAS });

    const ultimos7 = deployments.filter((d) => d.createdAt >= Date.now() - 7 * DIA);
    const buildsCom = ultimos7.filter((d) => d.buildMs);
    await registrarSnapshot(session.userId, {
      projetos: lista.projects.length,
      deploys7d: ultimos7.length,
      falhas7d: ultimos7.filter((d) => d.state === "ERROR").length,
      buildMedioMs: buildsCom.length
        ? Math.round(buildsCom.reduce((s, d) => s + (d.buildMs ?? 0), 0) / buildsCom.length)
        : null,
    });

    return NextResponse.json({
      radar: avaliados,
      tendencias,
      historico: await historico(session.userId),
      // Projecao explicita: inspectorUrl e source nao sao usados na tela e
      // revelariam caminhos internos da conta a qualquer coisa que leia a resposta.
      timeline: deployments.slice(0, 60).map((d) => ({
        id: d.id,
        projectName: d.projectName,
        state: d.state,
        target: d.target,
        createdAt: d.createdAt,
        buildMs: d.buildMs,
      })),
      totalProjetos: lista.projects.length,
      truncado: historicoDeploys.truncated,
    });
  } catch (err) {
    if (err instanceof VercelError) {
      // Mensagens da Vercel podem citar time e escopo: normalizamos.
      const publica =
        err.status === 401 || err.status === 403
          ? "Seu token foi recusado pela Vercel. Informe um novo."
          : "Nao foi possivel consultar a Vercel agora.";
      return NextResponse.json({ error: publica }, { status: err.status });
    }
    console.error("GET /api/insights falhou:", err instanceof Error ? err.name : "erro");
    return NextResponse.json({ error: "Erro interno ao calcular os insights." }, { status: 500 });
  }
}
