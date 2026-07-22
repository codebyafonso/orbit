import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "orbit_session";

/**
 * A presenca do cookie so evita renderizar o painel para quem nao entrou. A
 * validacao real (assinatura, prazo e revogacao) acontece nas rotas de API.
 */
export function middleware(req: NextRequest) {
  if (!req.cookies.get(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/?erro=entre-primeiro", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/painel/:path*"] };
