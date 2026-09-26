import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { askJev } from "../lib/jev";
import { MODELS } from "../lib/models";

// Jev connectivity and response-shape check: one call with all three question types.
async function main() {
  const r = await askJev(
    {
      alert: "Okta: 14 failed logins for svc-backup from 185.220.101.4 (Tor exit node) in 2 minutes, then 1 success.",
      context: { asset_criticality: "high", user_privileged: true, threat_intel_match: true },
    },
    {
      category: {
        type: "choice",
        instructions: "What kind of security event is this?",
        criteria: { brute_force: "Many failed logins", phishing: "Suspicious email", benign_admin_activity: "Expected admin work" },
      },
      severity: { type: "score", instructions: "How severe is this?", criteria: ["Low", "Medium", "High", "Critical"] },
      escalate: { type: "noul", instructions: "Should the on-call analyst be paged now?" },
    },
  );
  console.log(`Jev (${MODELS.jev}) OK in ${r.ms} ms, ${r.inputTokens} input tokens, $${r.cost.toFixed(7)}`);
  console.log(JSON.stringify(r.answers, null, 2));
}

main().catch((e) => {
  console.error("Jev FAIL:", (e as Error).message);
  process.exit(1);
});
