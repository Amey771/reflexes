import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { MongoClient } from "mongodb";

// Connectivity check for Atlas and OpenRouter. Prints no secrets.
async function mongo() {
  const t0 = Date.now();
  const c = new MongoClient(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 10000 });
  try {
    await c.connect();
    const admin = c.db().admin();
    const info = await admin.command({ buildInfo: 1 });
    const dbs = await admin.listDatabases({ nameOnly: true });
    console.log("Atlas OK", { ms: Date.now() - t0, version: info.version, databases: dbs.databases.map((d) => d.name) });
  } catch (e) {
    const err = e as Error;
    console.log("Atlas FAIL", err.name, err.message.replace(/mongodb\+srv:\/\/[^@]+@/, "mongodb+srv://***@"));
  } finally {
    await c.close();
  }
}

async function openrouter() {
  const h = { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` };
  const [key, credits] = await Promise.all([
    fetch("https://openrouter.ai/api/v1/key", { headers: h }).then((r) => r.json()),
    fetch("https://openrouter.ai/api/v1/credits", { headers: h }).then((r) => r.json()),
  ]);
  console.log("OpenRouter key", { limit: key.data?.limit, usage: key.data?.usage, free_tier: key.data?.is_free_tier });
  console.log("OpenRouter credits", credits.data ?? credits.error);
}

Promise.all([mongo(), openrouter()]);
