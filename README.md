# sessions-mcp

An MCP server that turns every Claude Code session on your machine — past or **currently running in another terminal** — into something your next conversation can search, read, and follow.

Zero dependencies. Four tools. Reads the JSONL transcripts Claude Code already writes.

## Why

> *"You spent thirty minutes getting everything up to speed — the stack, the conventions, your special cases. Then the terminal crashes, or auto-compaction kicks in. Tomorrow's session is a blank slate."*
> — [Binu Thayamkery, *Claude Code Forgets Everything Between Sessions*](https://medium.com/@binu_thayamkery/claude-code-forgets-everything-between-sessions-heres-how-to-fix-that-fdba66cf537a)

Claude Code already writes every session to disk as a JSONL transcript under `~/.claude/projects/`. The file is there. The question is whether the agent in your *next* conversation — or your *parallel* conversation in another terminal — can read it. `sessions-mcp` answers that with four MCP tools.

## Install

Needs only Node 18+. Each install reads that machine's own `~/.claude/projects/` — installing this shares the tool, never session data.

```sh
git clone https://github.com/abhitsian/sessions-mcp.git
claude mcp add -s user sessions -- node "$(pwd)/sessions-mcp/server.js"
```

Restart Claude Code, verify with `claude mcp list`.

## Tools

| Tool | Use |
|---|---|
| `list_sessions` | Recent sessions, newest first. Live ones flagged 🟢. Args: `limit`, `since` ("7d" / ISO), `project`, `active_only`. |
| `search_sessions` | Full-text search across all transcripts (past + running), ranked, with snippets. |
| `get_session` | Cleaned content of one session by id (full or prefix) — strips thinking, tool-result noise. `query` slices to matches. |
| `tail_session` | Last N turns of a session — **including one running right now in another terminal**. Poll to follow it. |

Liveness: a transcript written in the last 3 min is `🟢 LIVE`, last 15 min is `● recent`, older is `○ idle`. A live session is visible up to its last **completed** turn — the turn in progress shows up once it finishes.

## Use cases

A handful of concrete scenarios, beyond *"find past work"*:

- **Resume a setup.** *"Pull the bash commands from the session where I set up Postgres last Tuesday — I need to repeat them on staging."*
- **Watch a long task from another terminal.** Kick off a 30-minute migration in worktree A; from worktree B, ask Claude *"is it past the database step yet?"* via `tail_session`.
- **Avoid re-walking dead ends.** *"Search all sessions in this repo for prior attempts at this refactor before I start."*
- **Help a teammate stuck on a bug you already hit.** Search your sessions for the error string and hand them the clean transcript.
- **Diagnose a crashed subagent.** Tail its session JSONL from the parent agent to see where it died, without re-running the whole task.
- **Generate a weekly changelog.** Search this week's sessions for *"shipped"* / *"merged"* / *"deployed"*, group by project.
- **Quarterly self-review.** Search for *"I learned"* / *"next time"* — surface retrospective notes scattered across conversations.
- **PR review with context.** Tail the Claude session that wrote the PR; surface the design discussion turns, skip the tool noise.
- **Build a personal eval set.** `list_sessions` + `get_session` to dump 50 real prompts to YAML for prompt-regression testing.

## Who this is for

- **Anyone running multiple Claude Codes in parallel** (`git worktree`, tmux panes) — `tail_session` is the missing "peek into terminal B without alt-tabbing" primitive.
- **Agencies / consultancies juggling many client projects** — cross-project search finds *"how did we solve auth for client X six weeks ago."*
- **Technical writers and researchers** using Claude as a thinking partner — past chats become a queryable corpus.
- **AI tooling / DX builders** writing hooks and observability — this is the read-path complement to your write-path hooks.
- **Anyone whose work routinely outlives a single context window.**

## What it's not for

- **Real-time token streaming.** Turn-granular only — a running session is visible up to its last completed turn.
- **Cross-machine sync.** Reads only the local `~/.claude/projects/` tree.
- **A memory layer.** Doesn't summarize, embed, or auto-inject context.
- **Structured analytics.** Search is full-text; no schema for token counts or per-day usage. Use Langfuse or a hooks-based monitor for that.
- **A `/pin` or `--resume` replacement.** Those push context proactively; this lets the agent pull on demand. Complementary.

## Privacy and security

Anything in `~/.claude/projects/` is readable by any agent with `sessions-mcp` loaded. On shared machines, or where session content is sensitive, treat that as a footgun. There is no per-tool auth — the server reads whatever the user running it can read.

## License

MIT.
