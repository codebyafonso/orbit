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

/**
 * Confere a senha de um usuario ja identificado.
 *
 * Diferente de verifyUser, resolve por _id: em operacoes destrutivas quem
 * manda e o id da sessao, e nao o email — que um dia podera ser trocado.
 * Tambem nao mexe em lastLoginAt nem recusa conta pendente.
 */
export async function checkPassword(id: string, senha: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDb();
  if (!db) return false;

  const doc = await db.collection("users").findOne({ _id: new ObjectId(id) });
  const guardado = typeof doc?.passwordHash === "string" ? doc.passwordHash : HASH_DUMMY;

  return (await verify(guardado, senha).catch(() => false)) && Boolean(doc);
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

/**
 * Apaga a conta e tudo que pertence a ela.
 *
 * Apagar so o documento do usuario deixaria para tras o token cifrado, as
 * sessoes ativas e o historico — dados de alguem que pediu para sumir. A ordem
 * comeca pelo token: e o unico item sensivel.
 */
export async function purgeUser(
  id: string,
  email: string,
): Promise<{ removidos: Record<string, number> }> {
  // Caminho destrutivo nao falha em silencio com "apaguei nada, tudo certo".
  if (!ObjectId.isValid(id)) throw new Error("Usuario invalido.");
  const db = await getDb();
  if (!db) throw new Error("Banco indisponivel: a conta nao foi apagada.");

  const _id = new ObjectId(id);
  const removidos: Record<string, number> = {};
  const falhas: string[] = [];

  // Marca antes de apagar: se algo falhar no meio, a conta ja nao loga mais e
  // uma nova tentativa e segura. O contrario deixaria conta viva meio-apagada.
  await db.collection("users").updateOne({ _id }, { $set: { pending: true } });

  const alvos: [string, Record<string, unknown>][] = [
    ["vercel_tokens", { userId: _id }],
    ["sessions", { userId: id }],
    ["snapshots", { userId: _id }],
    ["audit_logs", { userId: id }],
    // Sobraria o email em claro de uma conta apagada ate a janela do limitador vencer.
    [
      "rate_limits",
      { chave: { $in: [`login-conta:${email.toLowerCase()}`, `conta-apagar:${id}`, `senha:${id}`] } },
    ],
  ];

  for (const [colecao, filtro] of alvos) {
    try {
      const r = await db.collection(colecao).deleteMany(filtro);
      removidos[colecao] = r.deletedCount ?? 0;
    } catch (err) {
      // Melhor terminar com orfao sem dono do que com conta viva pela metade.
      falhas.push(colecao);
      console.error(`purge de ${colecao} falhou:`, err instanceof Error ? err.name : "erro");
    }
  }

  const r = await db.collection("users").deleteOne({ _id });
  removidos.users = r.deletedCount ?? 0;

  if (falhas.length) console.error("purge parcial, colecoes com sobra:", falhas.join(", "));
  return { removidos };
}

export async function changePassword(
  id: string,
  senhaAtual: string,
  novaSenha: string,
): Promise<{ ok: true } | { erro: string }> {
  if (!ObjectId.isValid(id)) return { erro: "Usuario invalido." };
  if (novaSenha.length < MIN_SENHA) {
    return { erro: `A senha precisa de pelo menos ${MIN_SENHA} caracteres.` };
  }

  const db = await getDb();
  if (!db) return { erro: "Banco indisponivel. Tente novamente em instantes." };

  const doc = await db.collection("users").findOne({ _id: new ObjectId(id) });
  if (!doc || typeof doc.passwordHash !== "string") return { erro: "Conta nao encontrada." };

  if (!(await verify(doc.passwordHash, senhaAtual).catch(() => false))) {
    return { erro: "Senha atual incorreta." };
  }

  // Repetir a mesma senha daria a falsa sensacao de ter rotacionado o segredo.
  if (await verify(doc.passwordHash, novaSenha).catch(() => false)) {
    return { erro: "A nova senha precisa ser diferente da atual." };
  }

  await db
    .collection("users")
    .updateOne({ _id: doc._id }, { $set: { passwordHash: await hash(novaSenha) } });

  // Trocar a senha precisa expulsar todo mundo: e o unico recurso de quem
  // desconfia que a sessao foi copiada. A rota emite uma sessao nova para o
  // navegador que fez a troca.
  await db.collection("sessions").deleteMany({ userId: id });

  return { ok: true };
}
