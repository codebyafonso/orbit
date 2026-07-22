import { getDb } from "./mongo";

export type AuditEntry = {
  projectId: string;
  projectName: string;
  result: "ok" | "error";
  error: string | null;
  at: Date;
};

export async function recordDeletion(e: {
  vercelUserId: string;
  projectId: string;
  projectName: string;
  result: "ok" | "error";
  error?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return; // auditoria e desejavel, nao pode bloquear a operacao
  await db.collection("audit_logs").insertOne({
    vercelUserId: e.vercelUserId,
    action: "project.delete",
    projectId: e.projectId,
    projectName: e.projectName,
    result: e.result,
    error: e.error ?? null,
    at: new Date(),
  });
}

export async function listDeletions(vercelUserId: string, limit = 50): Promise<AuditEntry[]> {
  const db = await getDb();
  if (!db) return [];
  const docs = await db
    .collection("audit_logs")
    .find({ vercelUserId })
    .sort({ at: -1 })
    .limit(limit)
    .toArray();
  return docs.map((d) => ({
    projectId: String(d.projectId),
    projectName: String(d.projectName),
    result: d.result === "ok" ? "ok" : "error",
    error: d.error ? String(d.error) : null,
    at: new Date(d.at),
  }));
}
