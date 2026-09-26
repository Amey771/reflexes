import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { closeDb } from "../lib/db";
import { triageAlert } from "../lib/triage";

// Try the learned harness on one alert from the command line.
// Usage: npx tsx scripts/triage.ts "Okta: 30 failed logins for admin from a Tor exit node, then success"
async function main() {
  const r = await triageAlert({ text: process.argv[2] ?? "", facts: { user_privileged: true, threat_intel_match: true } });
  console.log(JSON.stringify(r, null, 2));
  await closeDb();
}

main().catch((e) => {
  console.error("TRIAGE FAIL:", e.message);
  process.exit(1);
});
