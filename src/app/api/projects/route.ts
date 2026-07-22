import { NextResponse } from "next/server";
import { listProjects, whoami, authFromEnv, VercelError } from "@/lib/vercel";
import { requireDevOnly } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const blocked = requireDevOnly();
  if (blocked) return blocked;

  try {
    const auth = authFromEnv();
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
    console.error("GET /api/projects falhou:", err);
    return NextResponse.json({ error: "Erro interno ao listar projetos." }, { status: 500 });
  }
}
