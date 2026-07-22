import { hash, verify } from "@node-rs/argon2";
import { ObjectId, type Document } from "mongodb";
import { getDb } from "../db/mongo";

const MIN_SENHA = 10;

/**
 * Hash descartavel com os mesmos parametros dos reais. Verificar contra ele
 * quando o email nao existe iguala o tempo de resposta: sem isso, "email
 * inexistente" volta em ~1ms e "senha errada" em ~50ms, e a mensagem unica do
 * login vira decoracao — da para enumerar contas pelo relogio.
 */
const HASH_DUMMY =
  "$argon2id$v=19$m=19456,t=2,p=1$jTTjJFVVtiqhFc7y/rH7YQ$igCmzioSdO5rKjWO0VAT7MUQNrR7R42VSSSV2vq0iw8";

export type PublicUser = { id: string; email: string };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createUser(
  email: string,
  senha: string,
): Promise<{ user: PublicUser } | { erro: string }> {
  const e = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { erro: "Email invalido." };
  if (senha.length < MIN_SENHA) {
    return { erro: `A senha precisa de pelo menos ${MIN_SENHA} caracteres.` };
  }

  const db = await getDb();
  if (!db) return { erro: "Banco indisponivel. Tente novamente em instantes." };

  try {
    // Sem findOne antes: dois cadastros simultaneos passariam os dois pela
    // checagem. Quem garante a unicidade e o indice, nao a leitura.
    // Nasce pendente: so vira conta utilizavel depois que o token e guardado.
    // Assim uma falha no meio do cadastro nao deixa conta logavel sem token, e
    // o TTL em pendingUntil limpa a sobra sem depender de compensacao.
    const result = await db.collection("users").insertOne({
      email: e,
      passwordHash: await hash(senha),
      createdAt: new Date(),
      lastLoginAt: new Date(),
      pending: true,
      pendingUntil: new Date(Date.now() + 15 * 60 * 1000),
      preferences: {},
    });
    return { user: { id: result.insertedId.toHexString(), email: e } };
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return { erro: "Nao foi possivel criar a conta com esses dados." };
    }
    throw err;
  }
}

export async function verifyUser(email: string, senha: string): Promise<PublicUser | null> {
  const db = await getDb();
  if (!db) return null;

  const doc = (await db
    .collection("users")
    .findOne({ email: normalizeEmail(email) })) as Document | null;

  const guardado = typeof doc?.passwordHash === "string" ? doc.passwordHash : HASH_DUMMY;

  let ok = false;
  try {
    ok = await verify(guardado, senha);
  } catch (err) {
    // Hash corrompido ou falha do modulo nativo nao pode virar "senha errada" silenciosa.
    console.error("verificacao de senha falhou:", err instanceof Error ? err.name : "erro");
    ok = false;
  }

  // Conta pendente nao loga: ela existe, mas o cadastro nunca foi concluido.
  if (!doc || !ok || doc.pending === true) return null;

  const id = doc._id as ObjectId;
  await db.collection("users").updateOne({ _id: id }, { $set: { lastLoginAt: new Date() } });

  return { id: id.toHexString(), email: String(doc.email) };
}

/** Conclui o cadastro: a conta deixa de ser pendente e passa a poder logar. */
export async function activateUser(id: string): Promise<void> {
  if (!ObjectId.isValid(id)) return;
  const db = await getDb();
  if (!db) throw new Error("Banco indisponivel: nao foi possivel ativar a conta.");
  await db
    .collection("users")
    .updateOne({ _id: new ObjectId(id) }, { $unset: { pending: "", pendingUntil: "" } });
}

/** Compensacao usada quando o cadastro falha depois de criar a conta. */
export async function deleteUser(id: string): Promise<void> {
  if (!ObjectId.isValid(id)) return;
  const db = await getDb();
  if (!db) return;
  await db.collection("users").deleteOne({ _id: new ObjectId(id) });
}
