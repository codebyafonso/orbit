import { MongoClient, type Db } from "mongodb";

// O banco e secundario: guarda perfil e auditoria. Se cair, o painel continua
// listando e apagando projetos, entao getDb() devolve null em vez de lancar.
//
// O cache vive em globalThis porque o HMR do Next recria o modulo a cada
// recompilacao: com `let` de modulo, cada recompilacao abriria um MongoClient
// novo e nenhum seria fechado.
const cache = globalThis as typeof globalThis & { __orbitDb?: Promise<Db | null> };

function sanitize(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : "erro desconhecido";
  // A URI pode conter usuario e senha; nunca deve ir para log.
  return raw.replace(/mongodb(\+srv)?:\/\/\S+/gi, "[uri omitida]");
}

async function connect(): Promise<Db | null> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });
  try {
    await client.connect();
    const db = client.db();

    // Indices sao best-effort: uma falha aqui (ex.: duplicata legada de email)
    // nao pode derrubar um banco saudavel.
    void db
      .collection("users")
      .createIndex({ email: 1 }, { unique: true })
      .catch((err) => console.error("indice users falhou:", sanitize(err)));

    // Cadastro interrompido some sozinho, sem depender de compensacao.
    void db
      .collection("users")
      .createIndex({ pendingUntil: 1 }, { expireAfterSeconds: 0 })
      .catch((err) => console.error("indice ttl users falhou:", sanitize(err)));
    void db
      .collection("audit_logs")
      .createIndex({ userId: 1, at: -1 })
      .catch((err) => console.error("indice audit_logs falhou:", sanitize(err)));

    // expireAfterSeconds: 0 => o Mongo apaga o documento quando expiresAt vence.
    // E o banco que esquece o token, sem depender de rotina da aplicacao.
    void db
      .collection("vercel_tokens")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .catch((err) => console.error("indice ttl vercel_tokens falhou:", sanitize(err)));
    void db
      .collection("vercel_tokens")
      .createIndex({ userId: 1 }, { unique: true })
      .catch((err) => console.error("indice userId vercel_tokens falhou:", sanitize(err)));

    // Sessoes revogaveis: sem isto, logout so limpa o cookie daquele navegador
    // e uma copia do cookie continuaria valida ate o prazo.
    void db
      .collection("sessions")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .catch((err) => console.error("indice ttl sessions falhou:", sanitize(err)));
    void db
      .collection("sessions")
      .createIndex({ sid: 1 }, { unique: true })
      .catch((err) => console.error("indice sid sessions falhou:", sanitize(err)));

    void db
      .collection("rate_limits")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .catch((err) => console.error("indice ttl rate_limits falhou:", sanitize(err)));
    void db
      .collection("rate_limits")
      .createIndex({ chave: 1, inicioJanela: 1 }, { unique: true })
      .catch((err) => console.error("indice rate_limits falhou:", sanitize(err)));

    return db;
  } catch (err) {
    console.error("MongoDB indisponivel:", sanitize(err));
    await client.close().catch(() => {}); // sem isso, cada retry vaza sockets
    cache.__orbitDb = undefined; // permite nova tentativa na proxima chamada
    return null;
  }
}

export function getDb(): Promise<Db | null> {
  return (cache.__orbitDb ??= connect());
}
