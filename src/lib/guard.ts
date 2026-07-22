import { NextResponse } from "next/server";

/**
 * Enquanto o login OAuth do spec nao existir, estas rotas operam com o token
 * pessoal do dono e nao tem sessao para autorizar ninguem. Publicar assim
 * entregaria a conta Vercel a qualquer visitante, entao elas so respondem em
 * desenvolvimento local.
 */
export function requireDevOnly(): NextResponse | null {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Painel indisponivel: autenticacao ainda nao implementada." },
      { status: 503 },
    );
  }
  return null;
}

/**
 * Barreira contra requisicoes cross-site: um site malicioso aberto no navegador
 * nao pode disparar acoes contra o painel rodando em localhost.
 */
export function requireSameOrigin(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");
  if (!origin) return null; // curl e afins nao mandam Origin; o guard de ambiente ja cobre

  const host = req.headers.get("host");
  try {
    if (new URL(origin).host !== host) {
      return NextResponse.json({ error: "Origem nao permitida." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Origem invalida." }, { status: 403 });
  }
  return null;
}
