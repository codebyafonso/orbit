import { NextResponse } from "next/server";

/**
 * Barreira contra requisicoes cross-site em rotas que criam ou usam sessao.
 *
 * Origin ausente e recusado: estas rotas emitem cookie de sessao, entao um
 * `<form method=POST>` cross-site sem Origin poderia plantar a sessao do
 * atacante no navegador da vitima (session fixation). Navegadores reais sempre
 * enviam Origin em POST, entao a exigencia nao quebra ninguem legitimo.
 */
export function requireSameOrigin(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");
  if (!origin) return NextResponse.json({ error: "Origem ausente." }, { status: 403 });

  const esperada = origemEsperada(req);
  if (origin !== esperada) {
    return NextResponse.json({ error: "Origem nao permitida." }, { status: 403 });
  }
  return null;
}

/**
 * Compara scheme + host. `APP_ORIGIN` e a ancora confiavel quando configurada;
 * sem ela caimos no header Host, que serve para desenvolvimento local.
 */
function origemEsperada(req: Request): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN;

  const host = req.headers.get("host") ?? "";
  const scheme = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${scheme}://${host}`;
}
