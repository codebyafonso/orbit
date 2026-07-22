"use client";

import { useState } from "react";

type Aba = "entrar" | "criar";

export default function AuthForm({ erroInicial }: { erroInicial?: string }) {
  const [aba, setAba] = useState<Aba>("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [token, setToken] = useState("");
  const [teamId, setTeamId] = useState("");
  const [erro, setErro] = useState<string | null>(erroInicial ?? null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);

    const rota = aba === "entrar" ? "/api/auth/login" : "/api/auth/register";
    const corpo =
      aba === "entrar" ? { email, senha } : { email, senha, token, teamId: teamId || undefined };

    try {
      const res = await fetch(rota, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Nao foi possivel continuar.");
      window.location.href = "/painel";
    } catch (err) {
      setErro((err as Error).message);
      setEnviando(false);
    }
  }

  return (
    <div className="instrument w-full max-w-md bg-panel">
      <div className="flex border-b border-line">
        {(["entrar", "criar"] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => {
              setAba(a);
              setErro(null);
            }}
            className="flex-1 px-4 py-3.5 text-xs tracking-[0.15em] uppercase transition-colors"
            style={{
              color: aba === a ? "#08090b" : "#7c848d",
              background: aba === a ? "#ffb020" : "transparent",
            }}
          >
            {a === "entrar" ? "Entrar" : "Criar conta"}
          </button>
        ))}
      </div>

      <form onSubmit={enviar} className="space-y-4 px-5 py-6">
        <Campo
          rotulo="email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <Campo
          rotulo={aba === "criar" ? "senha (minimo 10 caracteres)" : "senha"}
          type="password"
          value={senha}
          onChange={setSenha}
          autoComplete={aba === "entrar" ? "current-password" : "new-password"}
          minLength={aba === "criar" ? 10 : undefined}
          required
        />

        {aba === "criar" && (
          <>
            <Campo
              rotulo="token da vercel"
              type="password"
              value={token}
              onChange={setToken}
              placeholder="vcp_..."
              required
            />
            <Campo
              rotulo="team id (opcional)"
              type="text"
              value={teamId}
              onChange={setTeamId}
              placeholder="team_..."
            />

            <p
              className="border-l-2 pl-3 text-xs leading-relaxed text-ash"
              style={{ borderColor: "#ffb020" }}
            >
              Seu token da Vercel da <strong className="text-bone">acesso total</strong> a sua
              conta. Ele fica guardado com seguranca, nunca e exibido de novo e e{" "}
              <strong className="text-bone">apagado automaticamente em 7 dias</strong> — depois
              disso pedimos outro. Voce pode revoga-lo quando quiser em{" "}
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
          </>
        )}

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
          className="w-full border px-4 py-3.5 text-sm tracking-[0.12em] uppercase transition-all disabled:opacity-40"
          style={{ borderColor: "#ffb020", color: "#ffb020" }}
        >
          {enviando ? "..." : aba === "entrar" ? "Entrar" : "Criar conta e conectar"}
        </button>
      </form>
    </div>
  );
}

function Campo({
  rotulo,
  value,
  onChange,
  ...rest
}: {
  rotulo: string;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <label className="block">
      <span className="tick">{rotulo}</span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full border border-line bg-panel-2 px-3.5 py-3 text-sm outline-none transition-colors placeholder:text-ash/40 focus:border-signal/60"
      />
    </label>
  );
}
