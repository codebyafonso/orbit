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

    // Indices sao best-effort: uma falha aqui (ex.: duplicata legada em
    // vercelUserId) nao pode derrubar um banco saudavel.
    void db
      .collection("users")
      .createIndex({ vercelUserId: 1 }, { unique: true })
      .catch((err) => console.error("indice users falhou:", sanitize(err)));
    void db
      .collection("audit_logs")
      .createIndex({ vercelUserId: 1, at: -1 })
      .catch((err) => console.error("indice audit_logs falhou:", sanitize(err)));

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
