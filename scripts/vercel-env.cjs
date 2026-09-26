// Push the deploy's required env vars from .env.local to Vercel production without printing them.
require("dotenv").config({ path: ".env.local", quiet: true });
const { spawnSync } = require("node:child_process");

for (const name of ["MONGODB_URI", "MONGODB_DB", "OPENROUTER_API_KEY"]) {
  const value = process.env[name];
  if (!value) {
    console.log(`${name}: missing in .env.local, skipped`);
    continue;
  }
  spawnSync("vercel", ["env", "rm", name, "production", "--yes"], { stdio: "ignore" });
  const r = spawnSync("vercel", ["env", "add", name, "production"], { input: value, encoding: "utf8" });
  console.log(`${name}: ${r.status === 0 ? "set" : "FAILED " + (r.stderr || "").split("\n").filter((l) => /error/i.test(l)).join(" ").slice(0, 200)}`);
}
