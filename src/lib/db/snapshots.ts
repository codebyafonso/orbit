import { ObjectId } from "mongodb";
import { getDb } from "./mongo";

const FUSO = process.env.APP_TIMEZONE ?? "America/Sao_Paulo";

export type Snapshot = {
  dia: string; // YYYY-MM-DD
  projetos: number;
  deploys7d: number;
  falhas7d: number;
  buildMedioMs: number | null;
};

/**
 * Um registro por usuario por dia.
 *
 * A API da Vercel so devolve o estado atual e os deploys que ainda existem;
 * guardar o resumo diario e o que permite dizer "a taxa de falha subiu neste
 * mes" daqui a algumas semanas. E a unica parte do painel que depende de
 * memoria propria.
 */
export async function registrarSnapshot(userId: string, dados: Omit<Snapshot, "dia">) {
  if (!ObjectId.isValid(userId)) return;
  const db = await getDb();
  if (!db) return;

  // Dia no fuso de quem usa: em UTC, tudo depois das 21h em Brasilia cairia no
  // dia seguinte e o "um registro por dia" ficaria desalinhado.
  const dia = new Date().toLocaleDateString("sv-SE", { timeZone: FUSO });
  const gravar = () =>
    db
      .collection("snapshots")
      .updateOne(
        { userId: new ObjectId(userId), dia },
        { $set: { ...dados, at: new Date() } },
        { upsert: true },
      );

  try {
    await gravar();
  } catch (err) {
    // Duas visitas simultaneas no mesmo dia colidem no indice unico; na segunda
    // tentativa o documento ja existe. Outros erros nao podem sumir em silencio:
    // a memoria do painel depende desta escrita.
    if ((err as { code?: number }).code === 11000) {
      await gravar().catch(() => {});
      return;
    }
    console.error("snapshot nao gravado:", err instanceof Error ? err.name : "erro");
  }
}

export async function historico(userId: string, limite = 60): Promise<Snapshot[]> {
  if (!ObjectId.isValid(userId)) return [];
  const db = await getDb();
  if (!db) return [];

  const docs = await db
    .collection("snapshots")
    .find({ userId: new ObjectId(userId) })
    .sort({ dia: -1 })
    .limit(limite)
    .toArray();

  return docs
    .map((d) => ({
      dia: String(d.dia),
      projetos: Number(d.projetos) || 0,
      deploys7d: Number(d.deploys7d) || 0,
      falhas7d: Number(d.falhas7d) || 0,
      buildMedioMs: typeof d.buildMedioMs === "number" ? d.buildMedioMs : null,
    }))
    .reverse();
}
