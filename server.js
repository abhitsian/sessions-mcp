#!/usr/bin/env node
'use strict';

/*
 * sessions-mcp — reference past AND live Claude Code sessions from inside a session.
 * Zero dependencies. Speaks MCP over stdio (newline-delimited JSON-RPC 2.0).
 *
 * Tools: list_sessions, search_sessions, get_session, tail_session
 * Data source: ~/.claude/projects/<project>/<sessionId>.jsonl
 *
 * Transcripts are appended turn-by-turn while a session runs, so a session
 * active in another terminal is visible here up to its last completed turn.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const HOME_PROJECT = os.homedir().replace(/[\\/.]/g, '-'); // project-dir slug for $HOME
const SERVER_NAME = 'sessions';
const SERVER_VERSION = '1.1.1';
const MAX_OUTPUT = 60000; // char cap on get_session / tail_session output
const LIVE_MS = 3 * 60 * 1000; // < 3 min since last write: almost certainly a session mid-work
const RECENT_MS = 15 * 60 * 1000; // < 15 min: recently active

const log = (...a) => process.stderr.write('[sessions-mcp] ' + a.join(' ') + '\n');

// ---------- helpers ----------
function oneLine(s, n) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function snippet(text, idx, qlen) {
  const start = Math.max(0, idx - 70);
  const end = Math.min(text.length, idx + qlen + 90);
  const s = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + s + (end < text.length ? '…' : '');
}

function parseSince(since) {
  if (!since) return 0;
  const m = /^(\d+)\s*([dhw])$/i.exec(String(since).trim());
  if (m) {
    const n = +m[1];
    const unit = m[2].toLowerCase() === 'd' ? 864e5 : m[2].toLowerCase() === 'h' ? 36e5 : 6048e5;
    return Date.now() - n * unit;
  }
  const d = Date.parse(since);
  return isNaN(d) ? 0 : d;
}

function fmtWhen(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

// classify a transcript by how recently it was written
function liveness(mtimeMs) {
  const age = Date.now() - mtimeMs;
  let ago;
  if (age < 60000) ago = Math.max(1, Math.round(age / 1000)) + 's ago';
  else if (age < 3600000) ago = Math.round(age / 60000) + 'm ago';
  else if (age < 86400000) ago = Math.round(age / 3600000) + 'h ago';
  else ago = Math.round(age / 86400000) + 'd ago';
  const state = age < LIVE_MS ? 'live' : age < RECENT_MS ? 'recent' : 'idle';
  return { state, age, ago };
}

function livenessMark(state) {
  return state === 'live' ? '🟢 LIVE' : state === 'recent' ? '● recent' : '○ idle';
}

function toolSummary(t) {
  const inp = t.input || {};
  let detail = inp.command || inp.file_path || inp.path || inp.pattern ||
    inp.query || inp.url || inp.description || inp.prompt || '';
  if (!detail) {
    const v = Object.values(inp).find((x) => typeof x === 'string');
    detail = v || '';
  }
  detail = oneLine(detail, 90);
  return '  ⚙ ' + t.name + (detail ? '(' + detail + ')' : '');
}

function renderMsg(m, includeTools) {
  if (m.role === 'user') return '👤 User:\n' + m.text.trim();
  let block = '🤖 Claude:';
  if (m.text.trim()) block += '\n' + m.text.trim();
  if (includeTools && m.tools && m.tools.length) {
    block += '\n' + m.tools.map(toolSummary).join('\n');
  }
  return block;
}

// ---------- transcript discovery + parsing ----------
function listTranscriptFiles() {
  const out = [];
  let projDirs = [];
  try { projDirs = fs.readdirSync(PROJECTS_DIR); } catch { return out; }
  for (const pd of projDirs) {
    const full = path.join(PROJECTS_DIR, pd);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (!st.isDirectory()) continue;
    let files = [];
    try { files = fs.readdirSync(full); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(full, f);
      let fst;
      try { fst = fs.statSync(fp); } catch { continue; }
      out.push({
        path: fp,
        project: pd,
        sessionId: f.replace(/\.jsonl$/, ''),
        mtime: fst.mtimeMs,
        size: fst.size,
      });
    }
  }
  return out;
}

const cache = new Map(); // path:mtime -> parsed (mtime in key => live files re-parse on every append)

function parseTranscript(fileInfo) {
  const key = fileInfo.path + ':' + fileInfo.mtime;
  if (cache.has(key)) return cache.get(key);

  let raw = '';
  try { raw = fs.readFileSync(fileInfo.path, 'utf8'); } catch { return null; }

  const msgs = [];
  let aiTitle = null, firstPrompt = null, lastPrompt = null, cwd = null, gitBranch = null;
  let userCount = 0, asstCount = 0, firstTs = null, lastTs = null;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; } // partial last line of a live file just skips

    const t = o.type;
    if (t === 'ai-title') { aiTitle = o.aiTitle || aiTitle; continue; }
    if (t === 'last-prompt') { lastPrompt = o.lastPrompt || lastPrompt; continue; }
    if (o.cwd && !cwd) cwd = o.cwd;
    if (o.gitBranch && !gitBranch && o.gitBranch !== 'HEAD') gitBranch = o.gitBranch;
    if (o.timestamp) { if (!firstTs) firstTs = o.timestamp; lastTs = o.timestamp; }

    if (t === 'user') {
      const c = o.message && o.message.content;
      let text = '';
      if (typeof c === 'string') {
        text = c;
      } else if (Array.isArray(c)) {
        if (c.length && c.every((b) => b && b.type === 'tool_result')) continue; // pure tool-result turn
        text = c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
      }
      if (!text.trim()) continue;
      if (/^<(system-reminder|command-name|local-command)/.test(text.trim())) continue;
      userCount++;
      if (!firstPrompt) firstPrompt = text;
      msgs.push({ role: 'user', text, ts: o.timestamp });
    } else if (t === 'assistant') {
      const c = (o.message && o.message.content) || [];
      let text = '';
      const tools = [];
      for (const b of c) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text') text += (text ? '\n' : '') + b.text;
        else if (b.type === 'tool_use') tools.push({ name: b.name, input: b.input });
      }
      if (!text.trim() && !tools.length) continue;
      asstCount++;
      msgs.push({ role: 'assistant', text, ts: o.timestamp, tools });
    }
  }

  const result = {
    ...fileInfo, aiTitle, firstPrompt, lastPrompt, cwd, gitBranch,
    userCount, asstCount, firstTs, lastTs, msgs,
  };
  cache.set(key, result);
  if (cache.size > 250) cache.delete(cache.keys().next().value);
  return result;
}

function resolveSession(files, sid) {
  return files.find((f) => f.sessionId === sid) ||
    files.filter((f) => f.sessionId.startsWith(sid)).sort((a, b) => b.mtime - a.mtime)[0];
}

// ---------- tools ----------
function toolListSessions(args) {
  const limit = Math.min(Math.max(+args.limit || 25, 1), 100);
  const sinceMs = parseSince(args.since);
  let files = listTranscriptFiles().filter((f) => f.mtime >= sinceMs);
  if (args.project) {
    const needle = String(args.project).toLowerCase();
    files = files.filter((f) => f.project.toLowerCase().includes(needle));
  }
  if (args.active_only) files = files.filter((f) => liveness(f.mtime).state !== 'idle');
  files.sort((a, b) => b.mtime - a.mtime);
  const total = files.length;
  files = files.slice(0, limit);
  if (!files.length) return args.active_only ? 'No active sessions right now.' : 'No sessions found.';

  const liveCount = files.filter((f) => liveness(f.mtime).state === 'live').length;
  const rows = files.map((f) => {
    const p = parseTranscript(f);
    const title = (p && p.aiTitle) || (p && p.firstPrompt && oneLine(p.firstPrompt, 70)) || '(untitled)';
    const opened = p && p.firstPrompt ? oneLine(p.firstPrompt, 110) : '';
    const lv = liveness(f.mtime);
    const mark = lv.state === 'live' ? '🟢 LIVE  ' : lv.state === 'recent' ? '● recent  ' : '';
    return [
      '• ' + mark + title,
      '  id: ' + f.sessionId + '   ' + fmtWhen(f.mtime) + ' (' + lv.ago + ')' +
        '   ' + (p ? p.userCount + p.asstCount : '?') + ' msgs   ' +
        Math.round(f.size / 1024) + 'KB' +
        (p && p.project && p.project !== HOME_PROJECT ? '   [' + p.project + ']' : ''),
      opened ? '  opened: ' + opened : null,
    ].filter(Boolean).join('\n');
  });
  const head = `Showing ${files.length} of ${total} sessions` +
    (liveCount ? `, ${liveCount} live now` : '') + ' (newest first):';
  return head + '\n\n' + rows.join('\n\n');
}

function toolSearchSessions(args) {
  const q = String(args.query || '').toLowerCase().trim();
  if (!q) return 'Error: `query` is required.';
  const limit = Math.min(Math.max(+args.limit || 10, 1), 30);
  const sinceMs = parseSince(args.since);
  const files = listTranscriptFiles().filter((f) => f.mtime >= sinceMs);

  const hits = [];
  for (const f of files) {
    const p = parseTranscript(f);
    if (!p) continue;
    let count = 0;
    const snippets = [];
    for (const m of p.msgs) {
      const lc = m.text.toLowerCase();
      let from = 0, idx;
      while ((idx = lc.indexOf(q, from)) !== -1) {
        count++;
        if (snippets.length < 3) {
          snippets.push((m.role === 'user' ? '👤 ' : '🤖 ') + snippet(m.text, idx, q.length));
        }
        from = idx + q.length;
      }
    }
    if (p.aiTitle && p.aiTitle.toLowerCase().includes(q)) count += 3;
    if (count > 0) hits.push({ f, p, count, snippets });
  }
  hits.sort((a, b) => b.count - a.count || b.f.mtime - a.f.mtime);
  if (!hits.length) return `No sessions mention "${args.query}".`;

  const top = hits.slice(0, limit);
  const rows = top.map((h) => {
    const title = h.p.aiTitle || oneLine(h.p.firstPrompt, 70) || '(untitled)';
    const lv = liveness(h.f.mtime);
    const mark = lv.state !== 'idle' ? livenessMark(lv.state) + '  ' : '';
    return [
      `• ${mark}${title}  —  ${h.count} match${h.count > 1 ? 'es' : ''}`,
      `  id: ${h.f.sessionId}   ${fmtWhen(h.f.mtime)} (${lv.ago})`,
      ...h.snippets.map((s) => '  ' + s),
    ].join('\n');
  });
  return `${hits.length} session(s) mention "${args.query}" (top ${top.length}):\n\n` +
    rows.join('\n\n') +
    '\n\nNext: call get_session with an id (and optionally the same query) to pull the content.';
}

function toolGetSession(args) {
  const sid = String(args.session_id || '').trim();
  if (!sid) return 'Error: `session_id` is required.';
  const files = listTranscriptFiles();
  const match = resolveSession(files, sid);
  if (!match) return `No session found matching id "${sid}".`;

  const p = parseTranscript(match);
  if (!p || !p.msgs.length) return `Session ${match.sessionId} has no readable content.`;

  const includeTools = args.include_tools !== false;
  const q = args.query ? String(args.query).toLowerCase().trim() : null;
  const lv = liveness(match.mtime);

  const header = [
    '=== Session: ' + (p.aiTitle || oneLine(p.firstPrompt, 70) || '(untitled)') + ' ===',
    'id: ' + p.sessionId,
    'status: ' + (lv.state === 'live' ? '🟢 LIVE — active ' + lv.ago + ', content may still be growing' :
      lv.state === 'recent' ? '● recently active (' + lv.ago + ')' :
      '○ idle (last activity ' + lv.ago + ')'),
    'project: ' + p.project + (p.cwd ? '   cwd: ' + p.cwd : '') + (p.gitBranch ? '   branch: ' + p.gitBranch : ''),
    'when: ' + (p.firstTs || '?') + '  →  ' + (p.lastTs || '?'),
    'messages: ' + p.userCount + ' user / ' + p.asstCount + ' assistant',
    q ? 'filter: showing only excerpts matching "' + args.query + '" (+ neighbouring turn)' : '',
    '---',
  ].filter(Boolean).join('\n');

  let indices;
  if (q) {
    const keep = new Set();
    p.msgs.forEach((m, i) => {
      if (m.text.toLowerCase().includes(q)) {
        if (i > 0) keep.add(i - 1);
        keep.add(i);
        if (i < p.msgs.length - 1) keep.add(i + 1);
      }
    });
    indices = [...keep].sort((a, b) => a - b);
    if (!indices.length) {
      return header + '\n\n(no message text matches "' + args.query +
        '" — call get_session without `query` to read the whole session)';
    }
  } else {
    indices = p.msgs.map((_, i) => i);
  }

  const parts = [];
  let prev = -1;
  for (const i of indices) {
    if (prev !== -1 && i !== prev + 1) parts.push('  ⋯');
    prev = i;
    parts.push(renderMsg(p.msgs[i], includeTools));
  }

  let body = parts.join('\n\n');
  let note = '';
  if (body.length > MAX_OUTPUT) {
    body = body.slice(0, MAX_OUTPUT);
    note = '\n\n[…truncated at ' + MAX_OUTPUT + ' chars. Pass a `query` to narrow to the relevant slice.]';
  }
  return header + '\n\n' + body + note;
}

function toolTailSession(args) {
  const turns = Math.min(Math.max(+args.turns || 8, 1), 40);
  const includeTools = args.include_tools !== false;
  let files = listTranscriptFiles();
  if (!files.length) return 'No sessions found.';

  const sid = String(args.session_id || '').trim();
  let match;
  if (sid) {
    match = resolveSession(files, sid);
    if (!match) return `No session found matching id "${sid}".`;
  } else {
    match = files.sort((a, b) => b.mtime - a.mtime)[0]; // most recently active session
  }

  const p = parseTranscript(match);
  if (!p || !p.msgs.length) return `Session ${match.sessionId} has no readable content yet.`;

  const lv = liveness(match.mtime);
  const tail = p.msgs.slice(-turns);

  const header = [
    livenessMark(lv.state) + '  —  ' + (p.aiTitle || oneLine(p.firstPrompt, 60) || '(untitled)'),
    'id: ' + p.sessionId + '   last activity: ' + lv.ago +
      '   (' + (p.userCount + p.asstCount) + ' msgs total)',
    p.cwd ? 'cwd: ' + p.cwd + (p.gitBranch ? '   branch: ' + p.gitBranch : '') : '',
    'last ' + tail.length + ' turn(s):',
    '---',
  ].filter(Boolean).join('\n');

  let body = tail.map((m) => renderMsg(m, includeTools)).join('\n\n');
  let note = '';
  if (body.length > MAX_OUTPUT) {
    body = body.slice(-MAX_OUTPUT);
    note = '\n\n[…showing the most recent ' + MAX_OUTPUT + ' chars]';
  }
  const footer = lv.state === 'live'
    ? '\n\n[session is LIVE — call tail_session again to catch new turns; the turn in progress shows up once it completes]'
    : '';
  return header + '\n\n' + body + note + footer;
}

// ---------- MCP tool schemas ----------
const TOOLS = [
  {
    name: 'list_sessions',
    description:
      'List recent Claude Code sessions from this machine\'s transcript history, newest first. ' +
      'Sessions written in the last few minutes are flagged 🟢 LIVE (running now in another ' +
      'terminal). Use to discover what sessions exist — past or active — before pulling context. ' +
      'Returns each session\'s title, id, timestamp, message count, and opening prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max sessions to return (default 25, max 100).' },
        since: { type: 'string', description: 'Only sessions since this time. Relative ("7d", "24h", "2w") or ISO date.' },
        project: { type: 'string', description: 'Filter to sessions whose project/working-dir matches this substring.' },
        active_only: { type: 'boolean', description: 'Only show sessions live or recently active (written in the last ~15 min).' },
      },
    },
  },
  {
    name: 'search_sessions',
    description:
      'Full-text search across ALL Claude Code session transcripts on this machine — past and ' +
      'currently-running. Use whenever the user refers to something done or discussed in another ' +
      'session ("the session where we...", "what I figured out about...", "use the output from ' +
      'earlier") and you need to find which session it was. Returns matching sessions ranked by ' +
      'relevance with snippet excerpts; live sessions are flagged.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for (case-insensitive).' },
        limit: { type: 'number', description: 'Max sessions to return (default 10, max 30).' },
        since: { type: 'string', description: 'Only search sessions since this time. Relative ("7d") or ISO date.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_session',
    description:
      'Retrieve the cleaned content of a Claude Code session by id (full or unique prefix). Works ' +
      'on past sessions and on a session currently running in another terminal (visible up to its ' +
      'last completed turn). Strips thinking, tool-result noise and attachments — returns user ' +
      'prompts and assistant outputs, tool calls as one-liners. Pass `query` to get only the ' +
      'relevant slice. The status line reports whether the session is live, recent or idle.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session id (full uuid or a unique leading prefix).' },
        query: { type: 'string', description: 'Optional. If set, return only excerpts matching this text.' },
        include_tools: { type: 'boolean', description: 'Show tool calls as one-liners (default true).' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'tail_session',
    description:
      'Show the most recent turns of a Claude Code session — including one CURRENTLY RUNNING in ' +
      'another terminal. Use to check what another active session is doing right now, or to catch ' +
      'up on a session in progress. Transcripts are written turn-by-turn, so a live session is ' +
      'visible up to its last completed turn. Marks the session live / recent / idle. Call again ' +
      'to poll for new turns. Omit session_id to tail the most recently active session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session id (full or prefix). Omit to tail the most recently active session.' },
        turns: { type: 'number', description: 'How many recent turns to show (default 8, max 40).' },
        include_tools: { type: 'boolean', description: 'Show tool calls as one-liners (default true).' },
      },
    },
  },
];

// ---------- JSON-RPC / MCP stdio loop ----------
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function handle(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    });
    return;
  }
  if (method && method.startsWith('notifications/')) return;
  if (method === 'ping') { send({ jsonrpc: '2.0', id, result: {} }); return; }
  if (method === 'tools/list') { send({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); return; }

  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    let text;
    try {
      if (name === 'list_sessions') text = toolListSessions(args);
      else if (name === 'search_sessions') text = toolSearchSessions(args);
      else if (name === 'get_session') text = toolGetSession(args);
      else if (name === 'tail_session') text = toolTailSession(args);
      else { send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool: ' + name } }); return; }
    } catch (e) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true } });
      return;
    }
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    return;
  }

  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    try { handle(msg); } catch (e) { log('handler error:', e.message); }
  }
});
process.stdin.on('end', () => process.exit(0));

log('ready (v' + SERVER_VERSION + ') — projects dir: ' + PROJECTS_DIR);
