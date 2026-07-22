"use client";

import { useEffect, useState } from "react";
import type { AuditEntry } from "@/lib/db/audit";

type Entrada = Omit<AuditEntry, "at"> & { at: string };

type EstadoHistorico = { tipo: "carregando" } | { tipo: "ok"; itens: Entrada[] } | { tipo: "erro" };

export default function Conta({ tokenAtivo }: { tokenAtivo: boolean }) {
  const [historico, setHistorico] = useState<EstadoHistorico>({ tipo: "carregando" });
  const [email, setEmail] = useState<string | null>(null);
  const [erroConta, setErroConta] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function carregar() {
      const [conta, auditoria] = await Promise.allSettled([
        fetch("/api/account", { signal: controller.signal }),
        fetch("/api/audit", { signal: controller.signal }),
      ]);

      if (conta.status === "fulfilled" && conta.value.status === 401) {
        window.location.assign("/?erro=sessao-expirada");
        return;
      }

      if (conta.status === "fulfilled" && conta.value.ok) {
        const d = (await conta.value.json()) as { email: string };
        setEmail(d.email);
        setErroConta(false);
      } else {
        setErroConta(true);
      }

      // Falha de rede nao pode virar "nenhuma exclusao ate agora": numa tela de
      // auditoria isso e uma afirmacao falsa, nao um estado vazio.
      if (auditoria.status === "fulfilled" && auditoria.value.ok) {
        const d = (await auditoria.value.json()) as { entradas: Entrada[] };
        setHistorico({ tipo: "ok", itens: d.entradas });
      } else {
        setHistorico({ tipo: "erro" });
      }
    }

    void carregar().catch(() => {});
    return () => controller.abort();
  }, [tentativa]);

  return (
    <div className="mt-6 space-y-4">
      <section className="instrument bg-panel p-5">
        <h3 className="tick mb-3">conta</h3>
        <p className="text-sm">
          <span className="text-ash">email:</span>{" "}
          {erroConta ? (
            <span style={{ color: "#ff8a78" }}>nao foi possivel carregar</span>
          ) : (
            (email ?? "…")
          )}
        </p>
        <p className="mt-1 text-sm">
          <span className="text-ash">conexao com a vercel:</span>{" "}
          {tokenAtivo ? (
            <span className="text-live">ativa</span>
          ) : (
            <span style={{ color: "#ff8a78" }}>token nao informado</span>
          )}
        </p>
        {erroConta && (
          <button
            onClick={() => setTentativa((n) => n + 1)}
            className="mt-3 border border-line px-3 py-2 text-xs tracking-wider uppercase hover:bg-panel-2"
          >
            tentar de novo
          </button>
        )}
      </section>

      <TrocarSenha />

      <section className="instrument bg-panel p-5">
        <h3 className="tick mb-3">historico de exclusoes</h3>
        {historico.tipo === "carregando" ? (
          <p className="text-sm text-ash">carregando…</p>
        ) : historico.tipo === "erro" ? (
          <p className="text-sm" style={{ color: "#ff8a78" }}>
            Nao foi possivel carregar o historico. Isto nao significa que nada foi apagado.
          </p>
        ) : historico.itens.length === 0 ? (
          <p className="text-sm text-ash">
            Nenhum projeto foi apagado por esta conta ate agora. Toda exclusao feita aqui fica
            registrada, com data e resultado. Mostramos as 50 mais recentes.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {historico.itens.map((e, i) => (
              <li key={`${e.projectId}-${i}`} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: e.result === "ok" ? "#3ddc84" : "#ff4a35" }}
                />
                <span className="min-w-[8rem] flex-1 truncate">{e.projectName}</span>
                {e.error && (
                  <span className="text-xs" style={{ color: "#ff8a78" }}>
                    {e.error}
                  </span>
                )}
                <time className="tick" dateTime={e.at}>
                  {new Date(e.at).toLocaleString("pt-BR")}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      {email && !erroConta && <ApagarConta email={email} />}
    </div>
  );
}

function TrocarSenha() {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [msg, setMsg] = useState<{ texto: string; ok: boolean } | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/senha", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atual, nova }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Nao foi possivel trocar a senha.");
      setMsg({ texto: "Senha trocada. As outras sessoes foram encerradas.", ok: true });
      setAtual("");
      setNova("");
    } catch (err) {
      setMsg({ texto: (err as Error).message, ok: false });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="instrument bg-panel p-5">
      <h3 className="tick mb-3">trocar senha</h3>
      <form onSubmit={enviar} className="flex max-w-md flex-col gap-3">
        <input
          type="password"
          value={atual}
          onChange={(e) => setAtual(e.target.value)}
          placeholder="senha atual"
          aria-label="Senha atual"
          autoComplete="current-password"
          required
          className="border border-line bg-panel-2 px-3.5 py-2.5 text-sm outline-none placeholder:text-ash/40 focus:border-signal/60"
        />
        <input
          type="password"
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          placeholder="nova senha (minimo 10 caracteres)"
          aria-label="Nova senha"
          autoComplete="new-password"
          minLength={10}
          required
          className="border border-line bg-panel-2 px-3.5 py-2.5 text-sm outline-none placeholder:text-ash/40 focus:border-signal/60"
        />
        {msg && (
          <p
            role={msg.ok ? "status" : "alert"}
            aria-live="polite"
            className="text-xs"
            style={{ color: msg.ok ? "#3ddc84" : "#ff8a78" }}
          >
            {msg.texto}
          </p>
        )}
        <button
          type="submit"
          disabled={enviando}
          className="w-fit border border-line px-4 py-2.5 text-xs tracking-[0.15em] uppercase transition-colors hover:border-signal hover:text-signal disabled:opacity-40"
        >
          {enviando ? "trocando…" : "trocar senha"}
        </button>
      </form>
      <p className="mt-3 text-xs text-ash">
        Trocar a senha encerra todas as sessoes, inclusive em outros aparelhos.
      </p>
    </section>
  );
}

function ApagarConta({ email }: { email: string }) {
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function apagar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha, confirmacao }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Nao foi possivel apagar a conta.");
      window.location.assign("/");
    } catch (err) {
      setErro((err as Error).message);
      setEnviando(false);
    }
  }

  return (
    <section className="instrument bg-panel p-5" style={{ borderColor: "rgba(255,74,53,0.4)" }}>
      <h3 className="tick mb-3" style={{ color: "#ff8a78" }}>
        apagar minha conta
      </h3>
      <p className="max-w-lg text-sm leading-relaxed text-ash">
        Remove a conta, o token guardado, as sessoes ativas, o historico de exclusoes e os resumos
        diarios. <strong className="text-bone">Seus projetos na Vercel nao sao tocados</strong> — o
        que some e o que este painel guardou sobre voce.
      </p>

      {!aberto ? (
        <button
          onClick={() => setAberto(true)}
          className="mt-4 border px-4 py-2.5 text-xs tracking-[0.15em] uppercase transition-colors"
          style={{ borderColor: "#3a2320", color: "#ff8a78" }}
        >
          quero apagar
        </button>
      ) : (
        <form onSubmit={apagar} className="mt-4 flex max-w-md flex-col gap-3">
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="sua senha"
            aria-label="Senha"
            autoComplete="current-password"
            required
            className="border border-line bg-panel-2 px-3.5 py-2.5 text-sm outline-none placeholder:text-ash/40"
          />
          <label htmlFor="confirmacao-email" className="text-xs text-ash">
            digite <span className="text-signal select-all">{email}</span> para confirmar
          </label>
          <input
            id="confirmacao-email"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            aria-describedby="confirmacao-estado"
            autoComplete="off"
            required
            className="border bg-panel-2 px-3.5 py-2.5 text-sm outline-none"
            style={{ borderColor: confirmacao === email ? "#3ddc84" : "#24282d" }}
          />
          {/* estado tambem em texto: cor de borda nao e perceptivel para todos */}
          <p id="confirmacao-estado" aria-live="polite" className="text-xs text-ash">
            {confirmacao === email ? (
              <span className="text-live">email confere</span>
            ) : (
              "o botao libera quando o email bater"
            )}
          </p>
          {erro && (
            <p role="alert" className="shake text-xs" style={{ color: "#ff8a78" }}>
              {erro}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="border border-line px-4 py-2.5 text-xs tracking-wider uppercase hover:bg-panel-2"
            >
              cancelar
            </button>
            <button
              type="submit"
              disabled={enviando || confirmacao !== email}
              className="border px-4 py-2.5 text-xs tracking-wider uppercase transition-all disabled:opacity-30"
              style={{ borderColor: "#ff4a35", color: "#ff8a78" }}
            >
              {enviando ? "apagando…" : "apagar definitivamente"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
