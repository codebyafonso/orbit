import { NextResponse } from "next/server";
import { deleteProject, getProject, VercelError } from "@/lib/vercel";
import { requireDevOnly, requireSameOrigin } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = requireDevOnly() ?? requireSameOrigin(req);
  if (blocked) return blocked;

  const { id } = await ctx.params;

  try {
    const body = (await req.json().catch(() => ({}))) as { confirm?: string };

    // Segunda barreira, no servidor: o nome digitado precisa bater com o projeto
    // real. A resposta nao ecoa o nome, para nao virar um oraculo de nomes.
    const project = await getProject(id);
    if (body.confirm?.trim() !== project.name) {
      return NextResponse.json(
        { error: "Confirmacao invalida: o nome digitado nao corresponde ao projeto." },
        { status: 400 },
      );
    }

    await deleteProject(project.id);
    return NextResponse.json({ deleted: project.name });
  } catch (err) {
    if (err instanceof VercelError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("DELETE /api/projects/[id] falhou:", err);
    return NextResponse.json({ error: "Erro interno ao apagar o projeto." }, { status: 500 });
  }
}
