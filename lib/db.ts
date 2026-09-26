import { MongoClient, type Db } from "mongodb";

// Reuse one client per process (and across Next.js hot reloads).
const g = globalThis as unknown as { _mongo?: Promise<MongoClient> };

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  g._mongo ??= new MongoClient(uri, { maxPoolSize: 20, appName: "reflexes" }).connect();
  const client = await g._mongo;
  return client.db(process.env.MONGODB_DB || "reflexes");
}

export async function closeDb() {
  if (g._mongo) (await g._mongo).close();
  g._mongo = undefined;
}
