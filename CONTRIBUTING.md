# Contributing to the Reflexes alpha

Start with [the redesign plan](research/PLAN.md) and [core contract](packages/core/README.md). The original SOC demo and archived run are historical artifacts; changes to the reusable core should not depend on live MongoDB or model credentials.

Run `npm ci --ignore-scripts`, `npm run core:test`, `npm run research:test`, `npm run core:lint`, `npx next typegen`, and `npx tsc --noEmit -p .`. If changing policy or replay logic, regenerate results with `npm run research:replay` and explain changes, including regressions. Keep source and generated results together in the PR.

Useful initial contributions: real-provider recording adapters with complete usage accounting; independently labeled low-risk workloads with redistribution rights; reproducibility reports; failure cases for delayed audits, teacher degradation or stale feedback. Named research baselines should be faithful implementations, with assumptions documented.

Do not put API keys, connection strings, personal data or customer payloads in issues, fixtures or commits. Avoid live run/reset/seed commands when contributing to the offline alpha. Report the expected and observed behavior, a minimal sanitized example, runtime version and exact revision.

The package remains unpublished pending license and contributor-rights decisions. Do not assume public repository visibility grants redistribution rights to every dependency or dataset.
