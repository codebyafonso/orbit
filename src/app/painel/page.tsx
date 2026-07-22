"use client";

import { useEffect, useMemo, useState } from "react";
import type { Project } from "@/lib/vercel/client";
import DeleteDialog, { type DeleteResult } from "@/components/DeleteDialog";
import TokenGate from "@/components/TokenGate";
import Radar from "@/components/Radar";
import Atividade from "@/components/Atividade";
import Conta from "@/components/Conta";
import type { ProjetoAvaliado, Tendencias } from "@/lib/vercel/insights";
import type { Deployment } from "@/lib/vercel/client";
import type { Snapshot } from "@/lib/db/snapshots";

type ApiResponse = {
  projects?: Project[];
  truncated?: boolean;
  account?: { name: string | null; username: string | null } | null;
  error?: string;
  needsToken?: boolean;
};

type TokenStatus = { diasRestantes: number; vercelUsername: string | null } | null;

type Insights = {
  radar: ProjetoAvaliado[];
  tendencias: Tendencias;
  historico: Snapshot[];
  timeline: Pick<Deployment, "id" | "projectName" | "state" | "target" | "createdAt" | "buildMs">[];
  totalProjetos: number;
  truncado: boolean;
};

type Aba = "projetos" | "radar" | "atividade" | "conta";

/** 428 = a conta existe, mas o token expirou ou nunca foi informado. */
class PrecisaToken extends Error {}

function ago(ts: number | null) {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s atras`;
  if (s < 3600) return `${Math.floor(s / 60)}min atras`;
  if (s < 86400) return `${Math.floor(s / 3600)}h atras`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d}d atras`;
  return new Date(ts).toLocaleDateString("pt-BR");
}

const STATE_COLOR: Record<string, string> = {
  READY: "#3ddc84",
  BUILDING: "#ffb020",
  QUEUED: "#ffb020",
  INITIALIZING: "#ffb020",
  ERROR: "#ff4a35",
  CANCELED: "#7c848d",
};

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [account, setAccount] = useState<ApiResponse["account"]>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name" | "created">("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targets, setTargets] = useState<Project[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [precisaToken, setPrecisaToken] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>(null);
  const [aba, setAba] = useState<Aba>("projetos");
  const [insights, setInsights] = useState<Insights | null>(null);
  const [carregandoInsights, setCarregandoInsights] = useState(false);
  const [erroInsights, setErroInsights] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);

  async function fetchProjects(): Promise<ApiResponse> {
    const res = await fetch("/api/projects");
    if (res.status === 401) {
      window.location.assign("/?erro=sessao-expirada");
      throw new Error("Sessao expirada.");
    }
    const data = (await res.json()) as ApiResponse;
    if (res.status === 428 || data.needsToken) throw new PrecisaToken();
    if (!res.ok) throw new Error(data.error ?? "Falha ao carregar projetos.");
    return data;
  }

  async function carregarStatusDoToken() {
    const res = await fetch("/api/token");
    if (!res.ok) return;
    const data = (await res.json()) as {
      status: { expiresAt: string; vercelUsername: string | null } | null;
    };
    // Os dias sao calculados aqui, e nao durante o render: o componente precisa
    // ser puro, e Date.now() no corpo dele produz resultado instavel.
    setTokenStatus(
      data.status
        ? {
            vercelUsername: data.status.vercelUsername,
            diasRestantes: Math.ceil(
              (new Date(data.status.expiresAt).getTime() - Date.now()) / 86_400_000,
            ),
          }
        : null,
    );
  }

  // usado pelos botoes (fora de effect, pode setar estado direto)
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProjects();
      setProjects(data.projects ?? []);
      setAccount(data.account ?? null);
      setTruncated(data.truncated ?? false);
      setPrecisaToken(false);
      setSelected(new Set());
      setInsights(null); // dados velhos nao podem sobreviver a um recarregar
      void carregarStatusDoToken();
    } catch (e) {
      if (e instanceof PrecisaToken) setPrecisaToken(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function carregarInsights() {
    setCarregandoInsights(true);
    setErroInsights(null);
    try {
      const res = await fetch("/api/insights");
      if (res.status === 401) {
        window.location.assign("/?erro=sessao-expirada");
        return;
      }
      const data = (await res.json()) as Insights & { error?: string; needsToken?: boolean };
      if (res.status === 428 || data.needsToken) {
        setPrecisaToken(true);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Nao foi possivel calcular os insights.");
      setInsights(data);
    } catch (e) {
      // Sem isto o usuario ficaria olhando um esqueleto cinza para sempre.
      setInsights(null);
      setErroInsights((e as Error).message);
    } finally {
      setCarregandoInsights(false);
    }
  }

  async function sair() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/");
  }

  // carga inicial: nenhum setState sincrono dentro do effect
  useEffect(() => {
    let alive = true;
    fetchProjects()
      .then((data) => {
        if (!alive) return;
        setProjects(data.projects ?? []);
        setAccount(data.account ?? null);
        setTruncated(data.truncated ?? false);
        void carregarStatusDoToken();
      })
      .catch((e: Error) => {
        if (!alive) return;
        if (e instanceof PrecisaToken) setPrecisaToken(true);
        else setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? projects.filter(
          (p) => p.name.toLowerCase().includes(q) || (p.framework ?? "").toLowerCase().includes(q),
        )
      : projects;
    return [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "created") return b.createdAt - a.createdAt;
      return (
        (b.latestDeployment?.createdAt ?? b.updatedAt ?? 0) -
        (a.latestDeployment?.createdAt ?? a.updatedAt ?? 0)
      );
    });
  }, [projects, query, sort]);

  function irPara(destino: Aba) {
    setAba(destino);
    // Os insights custam varias chamadas a API: so buscamos quando alguem olha.
    const precisaDeInsights = destino === "radar" || destino === "atividade";
    if (precisaDeInsights && !insights && !carregandoInsights) void carregarInsights();
  }

  const live = projects.filter((p) => p.latestDeployment?.state === "READY").length;
  /**
   * Ids que a aba corrente realmente exibe. A selecao e um conjunto so, entao
   * sem este recorte daria para marcar 5 projetos na grade, trocar de aba e
   * apagar itens que nao estao na tela.
   */
  const idsVisiveisNaAba = useMemo(() => {
    if (aba === "projetos") return new Set(visible.map((p) => p.id));
    if (aba === "radar") return new Set((insights?.radar ?? []).map((r) => r.id));
    return new Set<string>(); // atividade e conta nao selecionam nada
  }, [aba, visible, insights]);

  const selectedProjects = useMemo(
    () => projects.filter((p) => selected.has(p.id) && idsVisiveisNaAba.has(p.id)),
    [projects, selected, idsVisiveisNaAba],
  );

  const ocultosSelecionados = useMemo(
    () => [...selected].filter((id) => !idsVisiveisNaAba.has(id)).length,
    [selected, idsVisiveisNaAba],
  );
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((p) => next.delete(p.id));
      else visible.forEach((p) => next.add(p.id));
      return next;
    });
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 pt-10 pb-24 sm:px-8">
      {/* ── cabecalho ───────────────────────────────────────────── */}
      <header className="rise flex flex-wrap items-end justify-between gap-6 border-b border-line pb-7">
        <div>
          <div className="tick mb-2 flex items-center gap-2">
            <span className="pulse-dot block size-1.5 rounded-full bg-signal" />
            painel de controle // vercel
          </div>
          <h1 className="h-display text-5xl leading-[0.95] font-bold sm:text-6xl">
            ORBIT<span className="text-signal">.</span>
          </h1>
          <p className="mt-2 max-w-md text-sm text-ash">
            Seus projetos hospedados, em um so lugar.
            {account?.username && (
              <>
                {" "}
                Conectado como <span className="text-bone">@{account.username}</span>.
              </>
            )}
          </p>
          {tokenStatus && <TokenBadge status={tokenStatus} onTrocar={() => setPrecisaToken(true)} />}
        </div>

        <div className="flex items-stretch gap-3">
          <Stat label="projetos" value={loading ? "··" : String(projects.length)} />
          <Stat label="no ar" value={loading ? "··" : String(live)} accent="#3ddc84" />
          <button
            onClick={() => void load()}
            disabled={loading}
            className="instrument bg-panel px-4 text-xs tracking-[0.15em] uppercase transition-colors hover:bg-panel-2 disabled:opacity-40"
          >
            {loading ? "···" : "recarregar"}
          </button>
          <button
            onClick={() => void sair()}
            className="instrument bg-panel px-4 text-xs tracking-[0.15em] uppercase transition-colors hover:border-alert hover:text-alert"
          >
            sair
          </button>
        </div>
      </header>

      {/* ── abas ────────────────────────────────────────────────── */}
      {!precisaToken && !error && (
        <nav
          role="tablist"
          aria-label="Secoes do painel"
          className="rise mt-6 flex border-b border-line"
          style={{ animationDelay: "40ms" }}
        >
          {(
            [
              ["projetos", "projetos"],
              ["radar", "radar de higiene"],
              ["atividade", "atividade"],
              ["conta", "conta"],
            ] as const
          ).map(([chave, rotulo]) => (
            <button
              key={chave}
              role="tab"
              aria-selected={aba === chave}
              onClick={() => irPara(chave)}
              className="relative px-5 py-3 text-xs tracking-[0.15em] uppercase transition-colors"
              style={{ color: aba === chave ? "#ffb020" : "#7c848d" }}
            >
              {rotulo}
              {chave === "radar" && insights && insights.radar.length > 0 && (
                <span
                  className="ml-2 border px-1.5 py-0.5 text-[10px]"
                  style={{ borderColor: "#ff4a35", color: "#ff8a78" }}
                >
                  {insights.radar.length}
                </span>
              )}
              {aba === chave && (
                <span className="absolute right-0 -bottom-px left-0 h-px bg-signal" />
              )}
            </button>
          ))}
        </nav>
      )}

      {/* ── filtros ─────────────────────────────────────────────── */}
      <div
        className="rise mt-6 flex flex-wrap items-center gap-3"
        style={{ animationDelay: "80ms", display: aba === "projetos" ? undefined : "none" }}
      >
        <div className="relative min-w-[220px] flex-1">
          <span className="tick pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2">
            /
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="buscar por nome ou framework"
            aria-label="Buscar projetos"
            className="w-full border border-line bg-panel py-3 pr-4 pl-8 text-sm outline-none transition-colors placeholder:text-ash/50 focus:border-signal/60"
          />
        </div>
        <div className="flex border border-line bg-panel">
          {(
            [
              ["recent", "deploy"],
              ["created", "criacao"],
              ["name", "a—z"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className="px-4 py-3 text-xs tracking-[0.12em] uppercase transition-colors"
              style={{
                color: sort === key ? "#08090b" : "#7c848d",
                background: sort === key ? "#ffb020" : "transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={toggleAllVisible}
          disabled={visible.length === 0}
          className="border border-line bg-panel px-4 py-3 text-xs tracking-[0.12em] uppercase transition-colors hover:border-ash hover:text-bone disabled:opacity-30"
        >
          {allVisibleSelected ? "limpar selecao" : `selecionar ${visible.length}`}
        </button>
      </div>

      {/* ── conteudo ────────────────────────────────────────────── */}
      {precisaToken ? (
        <TokenGate
          onPronto={() => {
            setPrecisaToken(false);
            void load();
          }}
        />
      ) : error ? (
        <TokenHelp message={error} onRetry={() => void load()} />
      ) : loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="sweep instrument h-44 bg-panel" />
          ))}
        </div>
      ) : aba !== "projetos" && aba !== "conta" && erroInsights ? (
        <div className="instrument mt-6 bg-panel p-6" style={{ borderColor: "rgba(255,74,53,0.4)" }}>
          <p className="tick" style={{ color: "#ff8a78" }}>
            falha ao calcular
          </p>
          <p className="h-display mt-2 text-xl">{erroInsights}</p>
          <button
            onClick={() => void carregarInsights()}
            className="mt-5 border border-line px-4 py-2.5 text-xs tracking-[0.15em] uppercase transition-colors hover:bg-panel-2"
          >
            tentar de novo
          </button>
        </div>
      ) : aba === "radar" ? (
        carregandoInsights || !insights ? (
          <div className="sweep instrument mt-6 h-40 bg-panel" />
        ) : (
          <Radar
            itens={insights.radar}
            total={insights.totalProjetos}
            selecionados={selected}
            onAlternar={toggle}
            onSelecionarTodos={(ids) => {
              setSelected((prev) => {
                const todos = ids.every((id) => prev.has(id));
                const next = new Set(prev);
                ids.forEach((id) => (todos ? next.delete(id) : next.add(id)));
                return next;
              });
            }}
          />
        )
      ) : aba === "conta" ? (
        <Conta tokenAtivo={tokenStatus !== null} />
      ) : aba === "atividade" ? (
        carregandoInsights || !insights ? (
          <div className="sweep instrument mt-6 h-40 bg-panel" />
        ) : (
          <>
          {insights.truncado && (
            <p
              className="mt-4 border px-4 py-2.5 text-xs"
              style={{ borderColor: "#ffb020", color: "#ffb020" }}
            >
              A conta tem mais deploys do que cabe nesta janela: os numeros abaixo cobrem apenas os
              mais recentes.
            </p>
          )}
          <Atividade
            tendencias={insights.tendencias}
            timeline={insights.timeline}
            historico={insights.historico}
          />
          </>
        )
      ) : visible.length === 0 ? (
        <div className="instrument mt-6 bg-panel px-6 py-16 text-center">
          <p className="h-display text-xl">Nenhum projeto encontrado</p>
          <p className="mt-2 text-sm text-ash">
            {query ? `Nada bate com "${query}".` : "Sua conta ainda nao tem projetos na Vercel."}
          </p>
        </div>
      ) : (
        <>
          {truncated && (
            <p
              className="mt-4 border px-4 py-2.5 text-xs"
              style={{ borderColor: "#ffb020", color: "#ffb020" }}
            >
              Mostrando os primeiros 1000 projetos da conta. A busca e a selecao valem apenas para
              esta lista.
            </p>
          )}
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p, i) => (
            <li
              key={p.id}
              className="rise instrument flex flex-col bg-panel transition-colors hover:border-ash/50"
              style={{
                animationDelay: `${Math.min(i, 12) * 35}ms`,
                borderColor: selected.has(p.id) ? "#ffb020" : undefined,
                background: selected.has(p.id) ? "rgba(255,176,32,0.04)" : undefined,
              }}
            >
              <div className="flex items-start justify-between gap-3 border-b border-line-soft px-4 py-3.5">
                <div className="flex min-w-0 gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    aria-label={`Selecionar ${p.name}`}
                    className="mt-1.5 size-4 shrink-0 accent-[#ffb020]"
                  />
                  <div className="min-w-0">
                    <h2 className="h-display truncate text-lg font-semibold">{p.name}</h2>
                    <p className="tick mt-1">{p.framework ?? "sem framework"}</p>
                  </div>
                </div>
                <span
                  className="mt-1 block size-2 shrink-0 rounded-full"
                  style={{ background: STATE_COLOR[p.latestDeployment?.state ?? ""] ?? "#3a4047" }}
                  title={p.latestDeployment?.state ?? "sem deploy"}
                />
              </div>

              <dl className="grid grid-cols-2 gap-px bg-line-soft text-xs">
                <Cell label="ultimo deploy" value={ago(p.latestDeployment?.createdAt ?? null)} />
                <Cell label="criado" value={ago(p.createdAt)} />
              </dl>

              {p.repo ? (
                <a
                  href={p.repo.url}
                  target="_blank"
                  rel="noreferrer"
                  title={`Abrir repositorio ${p.repo.label}`}
                  className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5 text-xs transition-colors hover:bg-panel-2 hover:text-signal"
                >
                  <RepoIcon provider={p.repo.provider} />
                  <span className="truncate">{p.repo.label}</span>
                  <span className="tick ml-auto shrink-0">↗</span>
                </a>
              ) : (
                <div className="border-b border-line-soft px-4 py-2.5 text-xs text-ash/50">
                  sem repositorio vinculado
                </div>
              )}

              <div className="mt-auto flex items-center gap-2 px-4 py-3">
                {p.productionUrl ? (
                  <a
                    href={p.productionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 border border-line px-3 py-2 text-center text-xs tracking-wider uppercase transition-colors hover:border-signal hover:text-signal"
                  >
                    Abrir site ↗
                  </a>
                ) : (
                  <span className="flex-1 border border-line-soft px-3 py-2 text-center text-xs tracking-wider text-ash/50 uppercase">
                    sem url
                  </span>
                )}
                <a
                  href={`https://vercel.com/${account?.username ?? "dashboard"}/${p.name}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Abrir no painel da Vercel"
                  className="border border-line px-3 py-2 text-xs tracking-wider uppercase transition-colors hover:border-ash hover:text-bone"
                >
                  Painel
                </a>
                <button
                  onClick={() => setTargets([p])}
                  aria-label={`Apagar ${p.name}`}
                  className="border px-3 py-2 text-xs tracking-wider uppercase transition-all"
                  style={{ borderColor: "#3a2320", color: "#ff8a78" }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#ff4a35")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#3a2320")}
                >
                  Apagar
                </button>
              </div>
            </li>
            ))}
          </ul>
        </>
      )}

      {/* ── barra de selecao ────────────────────────────────────── */}
      {selectedProjects.length > 0 && !targets && (
        <div
          role="toolbar"
          aria-label="Acoes em lote"
          className="rise instrument fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-4 bg-panel px-4 py-3"
          style={{ borderColor: "#ffb020" }}
        >
          <span className="text-sm">
            <span className="h-display text-lg font-bold text-signal">
              {selectedProjects.length}
            </span>{" "}
            <span className="text-ash">
              {selectedProjects.length === 1 ? "selecionado" : "selecionados"}
              {ocultosSelecionados > 0 && ` (${ocultosSelecionados} fora desta aba)`}
            </span>
          </span>
          <button
            onClick={() => setSelected(new Set())}
            className="border border-line px-3 py-2 text-xs tracking-wider uppercase transition-colors hover:border-ash hover:text-bone"
          >
            Limpar
          </button>
          <button
            onClick={() => setTargets(selectedProjects)}
            className="border px-4 py-2 text-xs tracking-wider uppercase transition-all"
            style={{ borderColor: "#ff4a35", color: "#ff8a78" }}
          >
            Apagar selecionados
          </button>
        </div>
      )}

      {targets && (
        <DeleteDialog
          projects={targets}
          onClose={() => setTargets(null)}
          onFinished={(r: DeleteResult) => {
            setProjects((prev) => prev.filter((p) => !r.deleted.includes(p.name)));
            setSelected((prev) => {
              const next = new Set(prev);
              targets.forEach((t) => {
                if (r.deleted.includes(t.name)) next.delete(t.id);
              });
              return next;
            });
            setTargets(null);
            setInsights(null);
            if (aba !== "projetos" && !carregandoInsights) void carregarInsights();
            setToast(
              r.failed.length
                ? {
                    tone: "warn",
                    text: `${r.deleted.length} apagado(s), ${r.failed.length} falhou(ram): ${r.failed
                      .map((f) => f.name)
                      .join(", ")}`,
                  }
                : {
                    tone: "ok",
                    text:
                      r.deleted.length === 1
                        ? `Projeto "${r.deleted[0]}" apagado.`
                        : `${r.deleted.length} projetos apagados.`,
                  },
            );
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className="rise instrument fixed bottom-6 left-1/2 z-40 max-w-[90vw] -translate-x-1/2 bg-panel px-5 py-3 text-sm"
          style={{ borderColor: toast.tone === "ok" ? "#3ddc84" : "#ffb020" }}
        >
          <span style={{ color: toast.tone === "ok" ? "#3ddc84" : "#ffb020" }}>
            {toast.tone === "ok" ? "✓" : "!"}
          </span>{" "}
          {toast.text}
        </div>
      )}
    </main>
  );
}

function TokenBadge({
  status,
  onTrocar,
}: {
  status: NonNullable<TokenStatus>;
  onTrocar: () => void;
}) {
  const dias = status.diasRestantes;
  const urgente = dias <= 2;

  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="tick">token</span>
      <span className="border border-line px-2 py-1 text-bone">conectado</span>
      <span style={{ color: urgente ? "#ff8a78" : "#7c848d" }}>
        expira em {dias} {dias === 1 ? "dia" : "dias"}
      </span>
      <button
        onClick={onTrocar}
        className="tick underline underline-offset-4 transition-colors hover:text-bone"
      >
        substituir
      </button>
    </p>
  );
}

function Stat({
  label,
  value,
  accent = "#ffb020",
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="instrument bg-panel px-4 py-2.5">
      <div className="h-display text-2xl leading-none font-bold" style={{ color: accent }}>
        {value}
      </div>
      <div className="tick mt-1">{label}</div>
    </div>
  );
}

function RepoIcon({ provider }: { provider: "github" | "gitlab" | "bitbucket" }) {
  if (provider === "github") {
    return (
      <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="currentColor" aria-hidden>
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="currentColor" aria-hidden>
      <path d="M8 1 10 6h4l-6 9-6-9h4L8 1Z" />
    </svg>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel px-4 py-3">
      <dt className="tick">{label}</dt>
      <dd className="mt-1 text-bone">{value}</dd>
    </div>
  );
}

function TokenHelp({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="instrument mt-6 bg-panel p-6" style={{ borderColor: "rgba(255,74,53,0.4)" }}>
      <p className="tick" style={{ color: "#ff8a78" }}>
        falha na conexao
      </p>
      <p className="h-display mt-2 text-xl">{message}</p>
      <ol
        className="mt-5 space-y-2 border-l-2 pl-4 text-sm text-ash"
        style={{ borderColor: "#2c3036" }}
      >
        <li>
          1. Gere um token em{" "}
          <a
            className="text-signal underline underline-offset-4"
            href="https://vercel.com/account/tokens"
            target="_blank"
            rel="noreferrer"
          >
            vercel.com/account/tokens
          </a>
        </li>
        <li>
          2. Crie o arquivo <code className="text-bone">.env.local</code> com{" "}
          <code className="text-bone">VERCEL_TOKEN=seu_token</code>
        </li>
        <li>
          3. Se for conta de time, adicione tambem{" "}
          <code className="text-bone">VERCEL_TEAM_ID=team_xxx</code>
        </li>
        <li>4. Reinicie o servidor de desenvolvimento</li>
      </ol>
      <button
        onClick={onRetry}
        className="mt-5 border border-line px-4 py-2.5 text-xs tracking-[0.15em] uppercase transition-colors hover:bg-panel-2"
      >
        tentar de novo
      </button>
    </div>
  );
}
