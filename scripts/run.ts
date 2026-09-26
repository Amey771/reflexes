import { config } from "dotenv";
config({ path: ".env.local" });

import { closeDb } from "../lib/db";
import { runSurge } from "../lib/runner";

// Usage: npm run run -- [--limit 100] [--rate 3] [--concurrency 6] [--keep]
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

// A stray rejected model call must never kill a recording run.
process.on("unhandledRejection", (e) => console.error("unhandled rejection:", (e as Error)?.message?.slice(0, 200)));

runSurge({
  limit: arg("limit") ? Number(arg("limit")) : undefined,
  arrivalsPerSec: arg("rate") ? Number(arg("rate")) : undefined,
  concurrency: arg("concurrency") ? Number(arg("concurrency")) : undefined,
  reset: !process.argv.includes("--keep"),
})
  .then(closeDb)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
