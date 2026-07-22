import { NextResponse } from "next/server";
import { listProjects, whoami, VercelError } from "@/lib/vercel/client";
import { requireAuth } from "@/lib/auth/api-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const { auth, response } = await requireAuth();
  if (response) return response;

  try {
    const [result, account] = await Promise.all([
      listProjects(auth),
      whoami(auth).catch(() => null),
    ]);
    return NextResponse.json({
      projects: result.projects,
      truncated: result.truncated,
      account,
    });
  } catch (err) {
    if (err instanceof VercelError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("GET /api/projects falhou:", err instanceof Error ? err.name : "erro");
    return NextResponse.json({ error: "Erro interno ao listar projetos." }, { status: 500 });
  }
}
