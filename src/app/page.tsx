import AuthForm from "@/components/AuthForm";

export const dynamic = "force-dynamic";

const MENSAGENS: Record<string, string> = {
  "entre-primeiro": "Entre para ver o seu painel.",
  "sessao-expirada": "Sua sessao expirou. Entre novamente.",
};

export default async function Landing({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-12 px-6 py-16 lg:flex-row lg:items-center">
      <div className="rise flex-1">
        <div className="tick mb-3 flex items-center gap-2">
          <span className="pulse-dot block size-1.5 rounded-full bg-signal" />
          painel de controle // vercel
        </div>
        <h1 className="h-display text-6xl leading-[0.95] font-bold sm:text-7xl">
          ORBIT<span className="text-signal">.</span>
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-ash">
          Todos os seus projetos hospedados na Vercel em um so lugar: status do ultimo deploy,
          repositorio vinculado, busca e exclusao com dupla confirmacao.
        </p>

        <ul className="mt-8 space-y-3 border-l-2 pl-4 text-sm" style={{ borderColor: "#2c3036" }}>
          {[
            ["Tudo em uma tela", "status do ultimo deploy, repositorio e endereco de producao"],
            ["Acesso temporario", "sua conexao com a Vercel vence sozinha e e renovada por voce"],
            ["Dupla confirmacao", "nada some por clique acidental"],
          ].map(([titulo, desc]) => (
            <li key={titulo} className="flex gap-2.5">
              <span className="text-signal">—</span>
              <span>
                <span className="text-bone">{titulo}</span>
                <span className="text-ash"> · {desc}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rise flex justify-center lg:flex-1" style={{ animationDelay: "100ms" }}>
        <AuthForm erroInicial={erro ? MENSAGENS[erro] : undefined} />
      </div>
    </main>
  );
}
