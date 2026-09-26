@AGENTS.md

## Claude Code specifics

- Check scope decisions (what to build, what to cut, what the judges want) against [HACKATHON_PLAYBOOK.md](HACKATHON_PLAYBOOK.md).
- **MongoDB MCP server** (`mongodb`, in `.mcp.json`): inspect real collections and schemas before writing queries or pipelines. Read tools are pre-approved; write tools will prompt.
- **Project skills** in `.claude/skills/` come from MongoDB's official agent-skills repo (Apache-2.0):
  - `mongodb-search-and-ai`: vector index and `$vectorSearch` work
  - `mongodb-schema-design`: data model decisions
  - `mongodb-connection`: the client in serverless routes
  - `mongodb-natural-language-querying`: writing queries
  - `mongodb-query-optimizer`: indexes
  - `mongodb-mcp-setup`: MCP connection setup
- `.env*` files and `.claude/settings.local.json` can't be read by design. To check that a variable is set, ask the user, or run a script that only prints whether it is present.
