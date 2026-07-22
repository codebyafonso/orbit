"use client";

import type { ProjetoAvaliado } from "@/lib/insights";

const COR_ALERTA: Record<string, string> = {
  "build-quebrado": "#ff4a35",
  "nunca-publicado": "#ff4a35",
  parado: "#ffb020",
  "sem-dominio": "#ffb020",
  "sem-repo": "#7c848d",
};

/**
 * Lista de motivos concretos para revisar um projeto. Nunca mostra um selo
 * generico de "risco": o texto diz exatamente o que esta errado.
 */
export default function Radar({
  itens,
  total,
  selecionados,
  onAlternar,
  onSelecionarTodos,
}: {
  itens: ProjetoAvaliado[];
  total: number;
  selecionados: Set<string>;
  onAlternar: (id: string) => void;
  onSelecionarTodos: (ids: string[]) => void;
}) {
  if (itens.length === 0) {
    return (
      <div className="instrument mt-6 bg-panel px-6 py-16 text-center">
        <p className="h-display text-xl">Nada para limpar</p>
        <p className="mt-2 text-sm text-ash">
          Os {total} projetos da conta tem deploy recente, endereco de producao e repositorio
          vinculado.
        </p>
      </div>
    );
  }

  const criticos = itens.filter((i) => i.risco >= 5).length;

  return (
    <div className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ash">
          <span className="h-display text-lg font-bold text-signal">{itens.length}</span> de {total}{" "}
          projetos pedem atencao
          {criticos > 0 && (
            <>
              {" — "}
              <span style={{ color: "#ff8a78" }}>{criticos} em estado critico</span>
            </>
          )}
        </p>
        <button
          onClick={() => onSelecionarTodos(itens.map((i) => i.id))}
          className="border border-line bg-panel px-4 py-2.5 text-xs tracking-[0.12em] uppercase transition-colors hover:border-ash hover:text-bone"
        >
          selecionar todos os {itens.length}
        </button>
      </div>

      <ul className="space-y-2">
        {itens.map((item, i) => (
          <li
            key={item.id}
            className="rise instrument flex flex-wrap items-center gap-x-4 gap-y-2 bg-panel px-4 py-3.5"
            style={{
              animationDelay: `${Math.min(i, 12) * 30}ms`,
              borderColor: selecionados.has(item.id) ? "#ffb020" : undefined,
            }}
          >
            <input
              type="checkbox"
              checked={selecionados.has(item.id)}
              onChange={() => onAlternar(item.id)}
              aria-label={`Selecionar ${item.nome}`}
              className="size-4 shrink-0 accent-[#ffb020]"
            />

            <span
              className="h-display w-8 shrink-0 text-center text-lg font-bold"
              style={{ color: item.risco >= 5 ? "#ff4a35" : "#ffb020" }}
              title="Soma dos problemas encontrados"
            >
              {item.risco}
            </span>

            <span className="h-display min-w-[8rem] flex-1 truncate text-base">{item.nome}</span>

            <span className="flex flex-wrap gap-1.5">
              {item.alertas.map((a) => (
                <span
                  key={a.codigo}
                  className="border px-2 py-1 text-xs"
                  style={{ borderColor: COR_ALERTA[a.codigo], color: COR_ALERTA[a.codigo] }}
                >
                  {a.texto}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-ash">
        Selecione os que quiser remover e use o botao de apagar — a confirmacao dupla continua
        valendo para cada projeto.
      </p>
    </div>
  );
}
