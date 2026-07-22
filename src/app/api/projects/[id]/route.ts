import { NextResponse } from "next/server";
import { deleteProject, getProject, VercelError } from "@/lib/vercel";
import { requireAuth } from "@/lib/api-session";
import { requireSameOrigin } from "@/lib/same-origin";
import { recordDeletion } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cross = requireSameOrigin(req);
  if (cross) return cross;

  const { session, auth, response } = await requireAuth();
  if (response) return response;

  const { id } = await ctx.params;

  try {
    const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };

    // Barreira final no servidor: o nome digitado precisa bater com o projeto
    // real. A resposta nao ecoa o nome, para nao virar um oraculo de nomes.
    const project = await getProject(auth, id);
    if (typeof body.confirm !== "string" || body.confirm.trim() !== project.name) {
      return NextResponse.json(
        { error: "Confirmacao invalida: o nome digitado nao corresponde ao projeto." },
        { status: 400 },
      );
    }

    try {
      await deleteProject(auth, project.id);
    } catch (err) {
      await recordDeletion({
        userId: session.userId,
        projectId: project.id,
        projectName: project.name,
        result: "error",
        error: (err instanceof Error ? err.message : "desconhecido").slice(0, 500),
      });
      throw err;
    }

    await recordDeletion({
      userId: session.userId,
      projectId: project.id,
      projectName: project.name,
      result: "ok",
    });

    return NextResponse.json({ deleted: project.name });
  } catch (err) {
    if (err instanceof VercelError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("DELETE /api/projects falhou:", err instanceof Error ? err.name : "erro");
    return NextResponse.json({ error: "Erro interno ao apagar o projeto." }, { status: 500 });
  }
}
