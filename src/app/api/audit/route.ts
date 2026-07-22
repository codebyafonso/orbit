import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/session";
import { listDeletions } from "@/lib/db/audit";

export const dynamic = "force-dynamic";

/** Historico de exclusoes do proprio usuario. */
export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Faca login novamente." }, { status: 401 });

  return NextResponse.json({ entradas: await listDeletions(session.userId) });
}
