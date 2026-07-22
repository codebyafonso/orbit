"use client";

import { useState } from "react";

/**
 * Aparece quando a API responde 428: a conta existe, mas o token expirou (ou
 * nunca foi informado). Substitui a grade de projetos, nao um erro generico.
 */
export default function TokenGate({ onPronto }: { onPronto: () => void }) {
  const [token, setToken] = useState("");
  const [teamId, setTeamId] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/token", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, teamId: teamId || undefined }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Nao foi possivel guardar o token.");
      onPronto();
    } catch (err) {
      setErro((err as Error).message);
      setEnviando(false);
    }
  }

  return (
    <div className="instrument rise mt-6 bg-panel p-6" style={{ borderColor: "#ffb020" }}>
      <div className="tick mb-2 flex items-center gap-2">
        <span className="pulse-dot block size-1.5 rounded-full bg-signal" />
        token necessario
      </div>
      <h2 className="h-display text-2xl font-semibold">Informe seu token da Vercel</h2>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-ash">
        Tokens sao apagados automaticamente a cada 7 dias — e hora de informar de novo. Gere um em{" "}
        <a
          className="text-signal underline underline-offset-2"
          href="https://vercel.com/account/tokens"
          target="_blank"
          rel="noreferrer"
        >
          vercel.com/account/tokens
        </a>
        .
      </p>

      <form onSubmit={enviar} className="mt-5 flex max-w-lg flex-col gap-3">
        <input
          autoFocus
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="vcp_..."
          aria-label="Token da Vercel"
          required
          className="w-full border border-line bg-panel-2 px-3.5 py-3 text-sm outline-none transition-colors placeholder:text-ash/40 focus:border-signal/60"
        />
        <input
          type="text"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          placeholder="team id (opcional)"
          aria-label="Team ID"
          className="w-full border border-line bg-panel-2 px-3.5 py-3 text-sm outline-none transition-colors placeholder:text-ash/40 focus:border-signal/60"
        />

        {erro && (
          <p
            className="shake border px-3 py-2.5 text-xs"
            style={{ borderColor: "#ff4a35", color: "#ff8a78" }}
          >
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="w-fit border px-5 py-3 text-xs tracking-[0.15em] uppercase transition-all disabled:opacity-40"
          style={{ borderColor: "#ffb020", color: "#ffb020" }}
        >
          {enviando ? "validando..." : "conectar"}
        </button>
      </form>
    </div>
  );
}
