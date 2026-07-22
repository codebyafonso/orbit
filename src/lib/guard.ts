import { NextResponse } from "next/server";

/**
 * Enquanto as rotas de projetos ainda usam o token do ambiente (em vez do token
 * do usuario logado), elas nao tem dono de sessao para autorizar ninguem.
 * Publicar assim entregaria a conta Vercel a qualquer visitante, entao so
 * respondem em desenvolvimento local. Sai na Task 5.4.
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
