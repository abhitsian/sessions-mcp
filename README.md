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

### Use it from other local clients

It's a standard local stdio MCP server, so any MCP client that runs **on your machine** can use it — point the client at the same `node .../server.js` command:

- **Cursor / Cline** — add it under `mcpServers` in `~/.cursor/mcp.json` (or the client's MCP config)
- **Claude Desktop** — add it under `mcpServers` in `claude_desktop_config.json`
- **Your own scripts** — talk to the server directly over stdio

It can **not** run in Claude web (the browser): a web page can't spawn a local process or read your disk, and claude.ai only connects to remote HTTP connectors. This is a local-machine tool, so it reads your local Claude Code history only.

## Tools

| Tool | Use |
|---|---|
| `list_sessions` | Recent sessions, newest first. Live ones flagged 🟢. Args: `limit`, `since` ("7d" / ISO), `project`, `active_only`. |
| `search_sessions` | Full-text search across all transcripts (past + running), ranked, with snippets. |
| `get_session` | Cleaned content of one session by id (full or prefix) — strips thinking, tool-result noise. `query` slices to matches. |
| `tail_session` | Last N turns of a session — **including one running right now in another terminal**. Poll to follow it. |

Liveness: a transcript written in the last 3 min is `🟢 LIVE`, last 15 min is `● recent`, older is `○ idle`. A live session is visible up to its last **completed** turn — the turn in progress shows up once it finishes.

## Companion command

[`commands/session-monitor.md`](commands/session-monitor.md) is an optional Claude Code slash command built on these tools. It lists and finds your sessions — both live and idle — in one compact table, then waits for you to pick what to do next (tail one, resume one, search by topic). What you do after the list is up to you; it's deliberately not wired to any follow-up workflow.

Install it by dropping the file into `~/.claude/commands/`, then run `/session-monitor` (or `/session-monitor <topic>` to search).

## Use cases

What this looks like in practice, by persona — a few scenarios each.

### For engineers
- **Resume a setup.** *"Pull the bash commands from the session where I set up Postgres last Tuesday — I need to repeat them on staging."*
- **Watch a long task from another terminal.** Kick off a 30-minute migration in worktree A; from worktree B, ask Claude *"is it past the database step yet?"* via `tail_session`.
- **Avoid re-walking dead ends.** *"Search all sessions in this repo for prior attempts at this refactor before I start."*
- **Diagnose a crashed subagent.** Tail its session JSONL from the parent to see where it died, without re-running the whole task.
- **Help a teammate stuck on a bug you already hit.** Search your sessions for the error string and hand them the clean transcript.

### For product managers
- **Refresh a spec without starting over.** *"Pull the session where I drafted the onboarding flow three weeks ago — I want to update it with this week's feedback."*
- **Prep for a stakeholder review.** *"Search my sessions for anything about the Acme account this quarter — I want the talking points before tomorrow's review."*
- **Write the team explainer for a decision.** *"Find the session where I worked through the API design with engineering, then turn the reasoning into a one-pager."*
- **Status update in one prompt.** *"Draft Friday's update to my director based on what I worked on this week across all my sessions."*
- **Onboard a new PM to your product area.** *"Show them the sessions where I made the big product decisions here, so they read the reasoning, not just the outcome."*

### For founders and solo operators
- **Revisit your own thinking before a high-stakes conversation.** *"Find the session where I roughed out the pricing model — I want to re-read it before the investor call."*
- **One source of truth across scattered conversations.** *"Search every session about the legal entity setup — I need the summary for my accountant."*
- **Pick up a strategy thread you dropped.** *"Pull the session from last month where I was thinking through the GTM plan — let's continue."*

### For writers, researchers, and content folks
- **Continue a brainstorm without losing the thread.** *"Pull the session where I was working out the structure of this essay — I want to keep going from there."*
- **Don't repeat yourself.** *"Search past sessions for quotes I've already drafted on this topic before I write a new one."*
- **Three drafts, one decision.** *"I drafted three landing-page versions across different sessions — find them so I can compare side by side."*
- **Turn a thinking session into a deliverable.** *"Pull the session where I worked through the campaign brief, then turn it into something I can send the agency."*

### For customer-facing and operations roles
- **Walk into the next meeting already prepped.** *"I had Claude help me prep for the Acme call three weeks ago — pull that session, today's follow-up is in an hour."*
- **Surface the right history on the right account.** *"Search every conversation that mentioned the renewal for Customer X."*
- **Reuse the playbook you already drafted.** *"Find the session where I worked through the new refund policy — I want to apply the same wording to this case."*

## What it's not for

- **Real-time token streaming.** Turn-granular only — a running session is visible up to its last completed turn.
- **Cross-machine sync.** Reads only the local `~/.claude/projects/` tree.
- **A memory layer.** Doesn't summarize, embed, or auto-inject context.
- **Structured analytics.** Search is full-text; no schema for token counts or per-day usage. Use Langfuse or a hooks-based monitor for that.
- **A `/pin` or `--resume` replacement.** Those push context proactively; this lets the agent pull on demand. Complementary.
- **Claude web / the browser.** It's a local server — web clients can't reach your machine or files. Local desktop clients only (Claude Code, Claude Desktop, Cursor, your own scripts).
- **Your Claude *chats*.** It reads Claude *Code* sessions on disk (`~/.claude/projects/`), not your claude.ai / Claude Desktop chat history, which lives in the cloud.

## Privacy and security

Anything in `~/.claude/projects/` is readable by any agent with `sessions-mcp` loaded. On shared machines, or where session content is sensitive, treat that as a footgun. There is no per-tool auth — the server reads whatever the user running it can read.

## License

MIT.
