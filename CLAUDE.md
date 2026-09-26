@AGENTS.md

## Claude Code specifics

- **Context, in order:**
  1. [docs/HLD.md](docs/HLD.md) for the architecture
  2. [docs/LLD.md](docs/LLD.md) for exact constants and schemas
  3. [docs/DEMO.md](docs/DEMO.md) for the demo script, and HACKATHON_PLAYBOOK.md for judge strategy. The playbook is gitignored and may not exist in a fresh clone.
- **MongoDB MCP server** (`mongodb`, in `.mcp.json`). Inspect real collections before writing queries. Read tools are pre-approved and write tools prompt. Archived runs are in the `reflexes_run1`, `reflexes_run2` and `reflexes_run3` databases.
- **Project skills** in `.claude/skills/` come from MongoDB's official agent-skills repo (Apache-2.0):
  - `mongodb-search-and-ai`: vector index and `$vectorSearch` work
  - `mongodb-schema-design`: data model decisions
  - `mongodb-connection`: the client in serverless routes
  - `mongodb-natural-language-querying`: writing queries
  - `mongodb-query-optimizer`: indexes
  - `mongodb-mcp-setup`: MCP connection setup
- **Check UI changes visually.** Run the dev server, then screenshot with headless Chrome and read the PNG:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --window-size=1440,900 --virtual-time-budget=10000 --screenshot=<scratchpad>/shot.png "http://localhost:3000/details?db=run3&at=330&node=category"`
- **Secrets.** `.env*` files and `.claude/settings.local.json` can't be read by design. To check a variable, run a script that only prints whether it's set (as `scripts/check.ts` does).
- **Read-only numbers.** For read-only analysis outside `scripts/`, run plain Node with `NODE_PATH=$PWD/node_modules` so it finds the project's `mongodb` and `dotenv` packages.
