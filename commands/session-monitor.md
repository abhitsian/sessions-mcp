# Session Monitor — list & find your Claude Code sessions

A quick read on your Claude Code sessions across all terminals — both **live and idle** — so you can see your work-in-flight at a glance and pick what to do next.

By default it lists **all** recent sessions (active and inactive). Narrowing — to just the live ones, a time window, or a project — is something the user asks for in the query; it's never assumed.

The skill does exactly one thing: **list the sessions, then wait.** What happens after the list is open-ended and decided in the moment — jump back into one, summarize one, kill one, whatever. It is **not** tied to task tracking or any fixed follow-up.

Built on the `sessions` MCP (`list_sessions`, `tail_session`, `get_session`, `search_sessions`) — github.com/abhitsian/sessions-mcp.

## Prerequisite

The `sessions` MCP must be loaded. If its tools aren't available, tell the user to restart Claude Code so the server loads, then stop.

## What it does

Two entry points, same compact output:

- **List** (no query) — show recent sessions, **both active and idle**. Default.
- **Find** (a query given, e.g. "session monitor browse spec" or "find the session where I built the receipts app") — `search_sessions(query)` across ALL sessions, past and live, and list the matches ranked by relevance.

Then:

1. Call `list_sessions(since: "24h")` for the list path. Apply narrowing **only if the user asked for it** — otherwise return both active and inactive:
   - "just the live ones" / "what's running now" → `active_only: true`
   - a time window ("today", "last 3h", "this week") → set `since` accordingly
   - a project ("the sessions in repo X", "only my-app ones") → set `project`
   For the find path, call `search_sessions(query)` instead.
2. Drop the noise so the list is signal-only:
   - **This session** — the one running `/session-monitor` right now.
   - **Automated loop / agent runs** — e.g. queue-worker sessions that fire repeatedly, and short "Reply with: ready / OK" coordination pings.
   - **Empty sessions** (0 messages).
3. For each remaining session, get a one-line "what it's doing" from its title + opening prompt. Only `tail_session(session_id, turns: 8)` if the title is uninformative — don't deep-dive.
4. Print ONE compact numbered table — no per-session walls of text:

```
🔍 Sessions — HH:MM

| # | Session | State | What it's doing |
|---|---------|-------|-----------------|
| 1 | <title> | 🟢 live / idle Nm | <one line> |
| 2 | <title> | idle Nm | <one line> |

Anything you want to do with one? (e.g. "tail 1", "open 2", "search for X")
```

5. **Stop and wait.** Don't assume the next step or take any further action. Act only on what the user says next.

## Notes

- Listing touches nothing — no files written, no external services, no notifications. Pure read.
- Follow-ups are whatever the user asks. Common ones, all via the `sessions` MCP: `tail_session` / `get_session` to catch up on or resume a session, `search_sessions` to find one by content. Anything beyond that is a separate decision the user drives — not baked into this skill.
- Default window is 24h; honor any window the user specifies.
