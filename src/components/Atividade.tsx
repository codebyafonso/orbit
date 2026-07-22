"use client";

import type { Tendencias } from "@/lib/vercel/insights";
import type { Deployment } from "@/lib/vercel/client";
import type { Snapshot } from "@/lib/db/snapshots";

type ItemTimeline = Pick<Deployment, "id" | "projectName" | "state" | "target" | "createdAt" | "buildMs">;


const COR_ESTADO: Record<string, string> = {
  READY: "#3ddc84",
  ERROR: "#ff4a35",
  CANCELED: "#7c848d",
  BUILDING: "#ffb020",
  QUEUED: "#ffb020",
};

const seg = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 60_000).toFixed(1)}min`);

export default function Atividade({
  tendencias,
  timeline,
  historico,
}: {
  tendencias: Tendencias;
  timeline: ItemTimeline[];
  historico: Snapshot[];
}) {
  const pico = Math.max(1, ...tendencias.porSemana.map((s) => s.total));

  return (
    <div className="mt-6 space-y-6">
      {/* numeros das ultimas 8 semanas */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Numero rotulo="deploys / 8 semanas" valor={String(tendencias.totalDeploys)} />
        <Numero
          rotulo="taxa de falha"
          valor={`${Math.round(tendencias.taxaFalha * 100)}%`}
          cor={tendencias.taxaFalha > 0.2 ? "#ff4a35" : "#3ddc84"}
        />
        <Numero
          rotulo="build medio"
          valor={tendencias.buildMedioMs ? seg(tendencias.buildMedioMs) : "—"}
        />
        <Numero
          rotulo="tendencia do build"
          valor={
            tendencias.buildTendencia
              ? `${tendencias.buildTendencia.variacao > 0 ? "+" : ""}${Math.round(
                  tendencias.buildTendencia.variacao * 100,
                )}%`
              : "—"
          }
          cor={
            tendencias.buildTendencia && tendencias.buildTendencia.variacao > 0.2
              ? "#ff4a35"
              : "#3ddc84"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* deploys por semana */}
        <section className="instrument bg-panel p-5">
          <h3 className="tick mb-4">deploys por semana</h3>
          <div className="flex h-32 items-stretch gap-1.5">
            {tendencias.porSemana.map((s) => (
              <div key={s.inicio} className="group flex flex-1 flex-col justify-end gap-1">
                <div
                  className="w-full transition-all"
                  style={{
                    height: `${(s.total / pico) * 100}%`,
                    minHeight: s.total ? "3px" : "1px",
                    background: s.falhas ? "#ff4a35" : "#ffb020",
                    opacity: s.total ? 1 : 0.2,
                  }}
                  title={`${s.total} deploys, ${s.falhas} falhas`}
                />
              </div>
            ))}
          </div>
          <p className="mt-3 flex justify-between text-[10px] tracking-widest text-ash uppercase">
            <span>8 semanas atras</span>
            <span>agora</span>
          </p>
        </section>

        {/* quem mais quebra */}
        <section className="instrument bg-panel p-5">
          <h3 className="tick mb-4">quem mais quebra</h3>
          {tendencias.ranking.length === 0 ? (
            <p className="text-sm text-ash">Nenhuma falha nas ultimas 8 semanas.</p>
          ) : (
            <ul className="space-y-2.5">
              {tendencias.ranking.slice(0, 5).map((r) => (
                <li key={r.projectId} className="flex items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{r.nome}</span>
                  <span className="h-1.5 w-24 shrink-0 bg-line">
                    <span
                      className="block h-full"
                      style={{ width: `${r.taxa * 100}%`, background: "#ff4a35" }}
                    />
                  </span>
                  <span className="w-24 shrink-0 text-right text-xs text-ash">
                    {r.falhas}/{r.total} · {Math.round(r.taxa * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* memoria propria */}
      <section className="instrument bg-panel p-5">
        <h3 className="tick mb-3">memoria do painel</h3>
        {historico.length < 2 ? (
          <p className="text-sm text-ash">
            O painel guarda um resumo por dia para comparar semanas no futuro. Hoje ha{" "}
            {historico.length === 0 ? "nenhum registro" : "1 registro"} — volte amanha para ver a
            primeira comparacao.
          </p>
        ) : (
          <div className="flex items-end gap-1.5">
            {historico.map((h) => (
              <div
                key={h.dia}
                className="flex-1"
                title={`${h.dia}: ${h.deploys7d} deploys, ${h.falhas7d} falhas`}
                style={{
                  height: `${Math.max(4, (h.deploys7d / Math.max(1, ...historico.map((x) => x.deploys7d))) * 60)}px`,
                  background: h.falhas7d ? "#ff4a35" : "#3ddc84",
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* linha do tempo unificada */}
      <section>
        <h3 className="tick mb-3">linha do tempo · todos os projetos</h3>
        <ul className="instrument divide-y divide-line-soft bg-panel">
          {timeline.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: COR_ESTADO[d.state ?? ""] ?? "#3a4047" }}
                title={d.state ?? "sem estado"}
              />
              <span className="min-w-[7rem] flex-1 truncate">{d.projectName}</span>
              {d.target === "production" && (
                <span className="tick" style={{ color: "#ffb020" }}>
                  producao
                </span>
              )}
              <span className="tick w-16 text-right">{d.buildMs ? seg(d.buildMs) : "—"}</span>
              <time
                className="tick w-32 text-right"
                dateTime={new Date(d.createdAt).toISOString()}
                title={new Date(d.createdAt).toLocaleString("pt-BR")}
              >
                {new Date(d.createdAt).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Numero({ rotulo, valor, cor = "#e8e6e1" }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <div className="instrument bg-panel px-4 py-3.5">
      <div className="h-display text-2xl leading-none font-bold" style={{ color: cor }}>
        {valor}
      </div>
      <div className="tick mt-1.5">{rotulo}</div>
    </div>
  );
}
