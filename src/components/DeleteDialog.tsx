"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@/lib/vercel/client";

const HOLD_MS = 1800;

export type DeleteResult = { deleted: string[]; failed: { name: string; error: string }[] };

export default function DeleteDialog({
  projects,
  onClose,
  onFinished,
}: {
  projects: Project[];
  onClose: () => void;
  onFinished: (result: DeleteResult) => void;
}) {
  const bulk = projects.length > 1;
  const phrase = bulk ? `apagar ${projects.length} projetos` : projects[0].name;

  const [step, setStep] = useState<1 | 2>(1);
  const [understood, setUnderstood] = useState(false);
  const [typed, setTyped] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const raf = useRef<number | null>(null);
  const holding = useRef(false);
  const matches = typed.trim() === phrase;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [busy, onClose]);

  const destroy = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result: DeleteResult = { deleted: [], failed: [] };

    // uma requisicao por projeto: o servidor revalida o nome de cada um
    for (const p of projects) {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(p.id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: p.name }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "falha desconhecida");
        result.deleted.push(p.name);
      } catch (e) {
        result.failed.push({ name: p.name, error: (e as Error).message });
      }
      setDone((d) => d + 1);
    }

    if (result.deleted.length === 0) {
      setError(result.failed[0]?.error ?? "Nada foi apagado.");
      setProgress(0);
      setDone(0);
      setBusy(false);
      return;
    }
    onFinished(result);
  }, [projects, onFinished]);

  const stopHold = useCallback(() => {
    holding.current = false;
    if (raf.current) cancelAnimationFrame(raf.current);
    setProgress((p) => (p >= 1 ? p : 0));
  }, []);

  const startHold = useCallback(() => {
    if (!matches || busy || holding.current) return;
    holding.current = true;
    const start = performance.now();
    const tick = (now: number) => {
      if (!holding.current) return;
      const p = Math.min(1, (now - start) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        holding.current = false;
        void destroy();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [matches, busy, destroy]);

  useEffect(() => () => stopHold(), [stopHold]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: "rgba(4,5,6,0.82)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="del-title"
        className="instrument rise flex max-h-[90vh] w-full max-w-lg flex-col bg-panel"
        style={{ borderColor: "rgba(255,74,53,0.45)" }}
      >
        <div
          className="flex items-center justify-between border-b px-5 py-3"
          style={{ borderColor: "rgba(255,74,53,0.3)", background: "rgba(255,74,53,0.07)" }}
        >
          <div className="flex items-center gap-2.5">
            <span className="pulse-dot block size-2 rounded-full bg-alert" />
            <span className="tick" style={{ color: "#ff8a78" }}>
              Zona de exclusao // etapa {step} de 2
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="tick transition-colors hover:text-bone disabled:opacity-30"
          >
            Esc
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-6">
          <h2 id="del-title" className="h-display text-2xl font-semibold">
            {bulk ? (
              <>
                Apagar <span className="text-alert">{projects.length} projetos</span>?
              </>
            ) : (
              <>
                Apagar <span className="text-alert">{projects[0].name}</span>?
              </>
            )}
          </h2>

          {step === 1 ? (
            <div className="mt-5 space-y-5">
              {bulk && (
                <div className="max-h-44 overflow-y-auto border border-line bg-void">
                  {projects.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between border-b border-line-soft px-3.5 py-2 text-sm last:border-b-0"
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="tick shrink-0 pl-3">{p.framework ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-sm leading-relaxed text-ash">
                Esta acao e permanente e nao pode ser desfeita.{" "}
                {bulk ? "De cada projeto acima serao removidos:" : "Voce tambem remove:"}
              </p>
              <ul className="space-y-2 border-l-2 pl-4 text-sm" style={{ borderColor: "#2c3036" }}>
                {[
                  "Todos os deployments (producao e preview)",
                  "Variaveis de ambiente e segredos do projeto",
                  "Dominios apontados diretamente para ele",
                  "Logs, analytics e historico de builds",
                ].map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <span className="text-alert">—</span>
                    <span className="text-ash">{item}</span>
                  </li>
                ))}
              </ul>

              <label className="flex cursor-pointer items-start gap-3 border border-line bg-panel-2 p-3.5 text-sm transition-colors select-none hover:border-ash/40">
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={(e) => setUnderstood(e.target.checked)}
                  className="mt-0.5 size-4 accent-[#ff4a35]"
                />
                <span>
                  Entendo que a exclusao e <strong className="text-bone">irreversivel</strong> e que
                  a Vercel nao mantem backup {bulk ? "destes projetos" : "deste projeto"}.
                </span>
              </label>

              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 border border-line px-4 py-3 text-sm tracking-wide transition-colors hover:bg-panel-2"
                >
                  Cancelar
                </button>
                <button
                  disabled={!understood}
                  onClick={() => setStep(2)}
                  className="flex-1 border px-4 py-3 text-sm tracking-wide transition-all disabled:cursor-not-allowed disabled:opacity-30"
                  style={{ borderColor: "#ff4a35", color: "#ff8a78" }}
                >
                  Continuar →
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              <p className="text-sm leading-relaxed text-ash">
                Confirmacao final. Digite exatamente o texto abaixo:
              </p>

              <div className="border border-line bg-void px-4 py-2.5 text-center text-sm tracking-[0.15em] text-signal select-all">
                {phrase}
              </div>

              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={busy}
                placeholder="digite aqui"
                aria-label="Texto de confirmacao"
                className="w-full border bg-panel-2 px-4 py-3 text-sm outline-none transition-colors placeholder:text-ash/50"
                style={{ borderColor: matches ? "#3ddc84" : "#24282d" }}
              />

              <button
                onPointerDown={startHold}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") startHold();
                }}
                onKeyUp={stopHold}
                onBlur={stopHold}
                disabled={!matches || busy}
                className="relative w-full overflow-hidden border px-4 py-4 text-sm tracking-[0.12em] uppercase transition-all disabled:cursor-not-allowed disabled:opacity-30"
                style={{ borderColor: "#ff4a35", color: progress > 0.5 ? "#08090b" : "#ff8a78" }}
              >
                <span
                  className="absolute inset-y-0 left-0 bg-alert transition-[width] duration-75"
                  style={{ width: `${(busy ? done / projects.length : progress) * 100}%` }}
                  aria-hidden
                />
                <span className="relative">
                  {busy
                    ? bulk
                      ? `Apagando ${done}/${projects.length}…`
                      : "Apagando…"
                    : progress > 0
                      ? "Segure…"
                      : `Mantenha pressionado para apagar${bulk ? ` (${projects.length})` : ""}`}
                </span>
              </button>

              {error && (
                <p
                  className="shake border px-3 py-2 text-xs"
                  style={{ borderColor: "#ff4a35", color: "#ff8a78" }}
                >
                  {error}
                </p>
              )}

              <button
                onClick={() => {
                  setStep(1);
                  setTyped("");
                  setProgress(0);
                }}
                disabled={busy}
                className="tick w-full py-1 transition-colors hover:text-bone disabled:opacity-30"
              >
                ← Voltar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
