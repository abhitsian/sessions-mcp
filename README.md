# sessions-mcp

Reference past **and live** Claude Code sessions from inside a session.

Every Claude Code session is saved as a JSONL transcript under
`~/.claude/projects/<project>/<sessionId>.jsonl`, written **turn-by-turn while
the session runs**. This MCP server makes those transcripts queryable
mid-session — so the agent can pull another session's output/context into the
current conversation, or watch what a session running in another terminal is
doing right now (visible up to its last completed turn).

## Tools

| Tool | Use |
|---|---|
| `list_sessions` | Recent sessions, newest first — title, id, time, msg count, opening prompt. Live ones flagged 🟢. Args: `limit`, `since` ("7d"/"24h"/ISO), `project`, `active_only`. |
| `search_sessions` | Full-text search across **all** transcripts (past + running), ranked, with snippets. Args: `query` (req), `limit`, `since`. |
| `get_session` | Cleaned content of one session by id (full or prefix) — strips thinking/tool-result noise. Status line reports live/recent/idle. Args: `session_id` (req), `query` (slice to matches), `include_tools`. |
| `tail_session` | Last N turns of a session — including one running **now** in another terminal. Poll to follow it live. Args: `session_id` (omit for most-recent), `turns`, `include_tools`. |

Liveness: a transcript written in the last 3 min is `🟢 LIVE`, last 15 min is
`● recent`, older is `○ idle`. A live session is visible up to its last
**completed** turn — the turn in progress appears once it finishes.

## Typical loop

> "use the approach from the session where I built the receipts app"

`search_sessions("receipts app")` → get id → `get_session(id, query="receipts app")` → read slice → keep working.

## Install (anyone, on their own machine)

Needs only Node 18+ — no dependencies. Each install reads that machine's own
`~/.claude/projects/` transcripts: installing this shares the tool, never session data.

1. Put this folder anywhere — clone the repo, or copy `server.js` + `package.json`.
2. Register it user-scoped (available in every project):

   ```
   claude mcp add -s user sessions -- node /ABSOLUTE/PATH/TO/server.js
   ```

3. Restart Claude Code. Verify with `claude mcp list`.

This is an MCP server consumed by Claude Code, not a Claude Desk app — no
`.claude-app.json` manifest on purpose, so Desk won't spawn a stray copy.
