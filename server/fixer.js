import fsp from 'node:fs/promises';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ENGINE_GUIDE } from './guide.js';
import { copyDir, mirrorDir, changedFiles, hashDir, isInside } from './files.js';
import { FAST_MODEL, fastEnabled, fastFix } from './fast.js';

const MODEL = process.env.LIVEFIX_MODEL || 'claude-sonnet-5-5';
const EFFORT = process.env.LIVEFIX_EFFORT || 'low';
const MAX_LOAD_RETRIES = 2;
export const describeFixer = () => `${fastEnabled() ? `${FAST_MODEL}, then ` : ''}${MODEL} · effort ${EFFORT}`;
const UNDO_RE =/^\s*(please\s+)?(undo|revert|roll\s*back|go\s+back)(\s+(that|it|this|the\s+last\s+(fix|change)|your\s+(last\s+)?(fix|change)))?\s*(please)?[.!]*\s*$/i;

/**
 * Turns feedback into code changes, one at a time:
 *   snapshot game/ → run Claude on the context bundle → hot-reload → verify the browser accepted it
 *   → on rejection, hand the error back to Claude (twice) → otherwise restore the snapshot.
 */
export class Fixer {
  constructor({ root, session, hub }) {
    this.root = root;
    this.gameDir = path.join(root, 'game');
    this.session = session;
    this.hub = hub;
    this.queue = [];
    this.busy = false;
    this.lastHash = null;
  }

  enqueue(item) {
    this.queue.push(item);
    if (this.busy) this.hub.agent({ status: `working · ${this.queue.length} queued`, kind: 'warn' });
    this.#pump();
  }

  async #pump() {
    if (this.busy) return;
    const item = this.queue.shift();
    if (!item) {
      this.hub.agent({ status: 'idle' });
      return;
    }
    this.busy = true;
    try {
      if (item.type === 'undo' || UNDO_RE.test(item.fb?.text || '')) await this.#undo(item);
      else await this.#fix(item);
    } catch (err) {
      console.error('[fixer]', err);
      if (item.fb) this.hub.card(item.fb.id, 'failed', { summary: String(err.message || err).slice(0, 300) });
      this.hub.agent({ line: `❌ ${err.message || err}`, lineKind: 'text' });
    } finally {
      this.busy = false;
      this.#pump();
    }
  }

  async #fix({ fb, bundle, seq }) {
    const started = Date.now();
    this.hub.card(fb.id, 'working');
    this.hub.agent({ status: 'working', kind: 'warn', line: `── #${seq}: “${(fb.text || '').slice(0, 80)}”`, lineKind: 'text' });

    const beforeDir = path.join(this.session.dir, 'versions', `${String(seq).padStart(3, '0')}-before`);
    await copyDir(this.gameDir, beforeDir);
    const log = path.join(bundle.dir, 'agent.ndjson');

    let cost = 0;
    const prompt = await this.#prompt(fb, bundle, seq);
    let res = await this.#fast(prompt, log) || await this.#query(prompt, log, null);
    cost += res.cost;
    let files = await changedFiles(beforeDir, this.gameDir);

    for (let attempt = 0; files.length; attempt++) {
      const version = this.session.bumpVersion();
      this.lastHash = await hashDir(this.gameDir);
      this.hub.agent({ line: `🚀 hot-swapping v${version} into the running game…` });
      const r = await this.hub.reloadAndWait(version, 'fix');
      if (r.ok) {
        const fix = { id: `fix${seq}`, seq, feedbackId: fb.id, version, files, text: fb.text, summary: res.summary, beforeDir, at: Date.now() };
        this.session.meta.fixes.push(fix);
        await this.session.saveMeta();
        await fsp.appendFile(path.join(this.session.dir, 'fixes.ndjson'), `${JSON.stringify({ ...fix, text: fb.text, costUsd: cost })}\n`);
        this.hub.card(fb.id, 'applied', { summary: res.summary, files, version, fixId: fix.id, costUsd: cost, ms: Date.now() - started, startAt: fb.startAt });
        this.hub.agent({ line: `✅ v${version} live: ${res.summary}`, lineKind: 'text' });
        return;
      }
      if (res.fast) {
        this.hub.agent({ line: `⚠️ rejected by the engine: ${r.error?.message}. Handing it to ${MODEL}…`, lineKind: 'text' });
        await mirrorDir(beforeDir, this.gameDir);
        res = await this.#query(prompt, log, null);
        cost += res.cost;
        files = await changedFiles(beforeDir, this.gameDir);
        attempt--;
        continue;
      }
      if (attempt >= MAX_LOAD_RETRIES) {
        await mirrorDir(beforeDir, this.gameDir);
        const v = this.session.bumpVersion();
        this.lastHash = await hashDir(this.gameDir);
        this.hub.broadcast({ type: 'reload', version: v, reason: 'restore' });
        this.hub.card(fb.id, 'failed', { summary: `The new code kept failing to load (${r.error?.message}). Your game is unchanged.`, ms: Date.now() - started, costUsd: cost });
        return;
      }
      this.hub.agent({ line: `⚠️ rejected by the engine: ${r.error?.message}. Asking Claude to fix it…`, lineKind: 'text' });
      res = await this.#query(
        `The engine dry-ran your change against a copy of the live game state and rejected it, so it was NOT applied:\n\n` +
        `${r.error?.message}\n${r.error?.stack || ''}\n\nFix the code in game/ so it loads. Same rules as before. End with SUMMARY:.`,
        log,
        res.sessionId,
      );
      cost += res.cost;
      files = await changedFiles(beforeDir, this.gameDir);
    }

    this.hub.card(fb.id, 'nochange', { summary: res.summary, costUsd: cost, ms: Date.now() - started, startAt: fb.startAt });
    this.hub.agent({ line: `💬 ${res.summary}`, lineKind: 'text' });
  }

  async #fast(prompt, log) {
    if (!fastEnabled()) return null;
    this.hub.agent({ line: `⚡ asking ${FAST_MODEL}…` });
    try {
      const res = await fastFix(prompt, this.gameDir, log);
      if (!res.escalate) return res;
      this.hub.agent({ line: `${FAST_MODEL} isn't sure. Handing it to ${MODEL}…` });
    } catch (err) {
      console.error('[fast]', err.message);
      this.hub.agent({ line: `⚠️ ${FAST_MODEL} failed: ${err.message}. Handing it to ${MODEL}…`, lineKind: 'text' });
    }
    return null;
  }

  async #prompt(fb, bundle, seq) {
    const src = { voice: 'said (push-to-talk)', handsfree: 'said (hands-free)', typed: 'typed' }[fb.source];
    const notes = this.session.meta.notes.splice(0);
    this.session.saveMeta();
    const lines = fb.source === 'crash'
      ? [`The game crashed. This was auto-reported, not said by the player: ${fb.text}`,
         'If the crash came right after a hot reload, the engine already put the previous code back in memory, but the files on disk still have the crashing code.']
      : [`Feedback #${seq}. The player ${src}: “${fb.text}”`];
    const recent = this.session.meta.fixes.slice(-5).map((f) => `- #${f.seq}${f.text ? ` “${f.text}”` : ''} → ${f.summary}`);
    return [
      ...lines,
      `Context bundle: ${bundle.relDir}/`,
      `Game code version at that moment: v${fb.version}.`,
      ...notes.map((n) => `Note: ${n}`),
      ...(recent.length ? ['', 'Your recent fixes, for feedback that refers back to them:', ...recent] : []),
      '', '# feedback.md', await fsp.readFile(path.join(bundle.dir, 'feedback.md'), 'utf8'),
      '', '# Current code in game/', await this.#gameSource(),
    ].join('\n');
  }

  async #gameSource() {
    const names = await fsp.readdir(this.gameDir, { recursive: true });
    const sources = names.filter((n) => /\.(js|mjs|json|md)$/.test(n)).sort();
    const parts = await Promise.all(sources.map(async (n) => `## game/${n}\n\`\`\`\n${await fsp.readFile(path.join(this.gameDir, n), 'utf8')}\n\`\`\``));
    return parts.join('\n\n');
  }

  async #query(prompt, logFile, resume) {
    const root = this.root;
    const gameDir = this.gameDir;
    const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
    const guard = async (input) => {
      const ti = input.tool_input || {};
      if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(input.tool_name)) {
        const p = path.resolve(root, String(ti.file_path || ti.notebook_path || ''));
        return isInside(p, gameDir) ? {} : deny('In livefix you may only edit files inside game/.');
      }
      if (input.tool_name === 'Bash') {
        const cmd = String(ti.command || '').trim();
        return /^node tools\/replay\.mjs( +[\w@%+=:,./-]+)*$/.test(cmd)
          ? {}
          : deny('Only `node tools/replay.mjs <bundle dir> [--from s] [--to s] [--every s]` can be run here.');
      }
      return {};
    };

    const q = query({
      prompt,
      options: {
        cwd: root,
        model: MODEL,
        effort: EFFORT,
        tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
        allowedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash(node tools/replay.mjs:*)'],
        permissionMode: 'dontAsk', // anything not allowed above is denied, never prompted
        hooks: { PreToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash', hooks: [guard] }] },
        systemPrompt: { type: 'preset', preset: 'claude_code', append: ENGINE_GUIDE },
        settingSources: [],
        strictMcpConfig: true,
        maxTurns: 40,
        ...(resume ? { resume } : {}),
        ...(process.env.LIVEFIX_CLAUDE_PATH ? { pathToClaudeCodeExecutable: process.env.LIVEFIX_CLAUDE_PATH } : {}),
        // The user's claude.ai connectors attach mid-run and add about 200K tokens to every later turn.
        env: { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_AGENT_SDK_CLIENT_APP: 'livefix/0.1.0' },
      },
    });

    let result = null;
    let lastText = '';
    for await (const m of q) {
      fsp.appendFile(logFile, `${JSON.stringify(m)}\n`).catch(() => {});
      if (m.type === 'assistant' && !m.parent_tool_use_id) {
        for (const b of m.message?.content || []) {
          if (b.type === 'text' && b.text.trim()) {
            lastText = b.text;
            const t = b.text.replace(/^SUMMARY:.*$/im, '').trim();
            if (t) this.hub.agent({ line: t.length > 240 ? `${t.slice(0, 240)}…` : t, lineKind: 'text' });
          } else if (b.type === 'tool_use') {
            this.hub.agent({ line: this.#describeTool(b) });
          }
        }
      } else if (m.type === 'system' && m.subtype === 'api_retry') {
        this.hub.agent({ line: '⏳ The Claude API call failed. Retrying…', lineKind: 'text' });
      } else if (m.type === 'result') {
        result = m;
      }
    }
    if (!result || result.subtype !== 'success') {
      const why = result?.errors?.join?.('; ') || result?.subtype || 'no result';
      if (!lastText) throw new Error(`Claude run ended without a result (${why})`);
    }
    const text = result?.result || lastText;
    const m = text.match(/SUMMARY:\s*(.+)\s*$/im);
    const summary = (m ? m[1] : text.split('\n').filter(Boolean).at(-1) || 'Done.').trim().slice(0, 240);
    return { summary, text, cost: result?.total_cost_usd || 0, sessionId: result?.session_id };
  }

  #describeTool(b) {
    const i = b.input || {};
    const rel = (p) => (p ? path.relative(this.root, path.resolve(this.root, p)) : '');
    switch (b.name) {
      case 'Read': return /\.jpe?g$|\.png$/i.test(i.file_path || '') ? `🖼  looking at ${path.basename(i.file_path)}` : `📖 reading ${rel(i.file_path)}`;
      case 'Edit': case 'MultiEdit': return `✏️  editing ${rel(i.file_path)}`;
      case 'Write': return `📝 writing ${rel(i.file_path)}`;
      case 'Bash': return `▶️  ${String(i.command || '').replace(/sessions\/[^ ]+/, '<bundle>')}`;
      case 'Grep': return `🔎 grep ${i.pattern}`;
      case 'Glob': return `🔎 ${i.pattern}`;
      default: return `🔧 ${b.name}`;
    }
  }

  async #undo(item) {
    const fixes = this.session.meta.fixes;
    const last = fixes.at(-1);
    const fbId = item.fb?.id;
    if (!last || (item.fixId && item.fixId !== last.id)) {
      const msg = last ? 'Only the most recent fix can be undone.' : 'Nothing to undo yet.';
      if (fbId) this.hub.card(fbId, 'nochange', { summary: msg });
      else this.hub.broadcast({ type: 'toast', text: msg, kind: 'bad' });
      return;
    }
    await mirrorDir(last.beforeDir, this.gameDir);
    fixes.pop();
    this.session.meta.notes.push(`The player undid your fix for feedback #${last.seq} ("${last.summary}"). The code is back to how it was before it.`);
    await this.session.saveMeta();
    const version = this.session.bumpVersion();
    this.lastHash = await hashDir(this.gameDir);
    await this.hub.reloadAndWait(version, 'undo');
    this.hub.card(last.feedbackId, 'undone');
    if (fbId) this.hub.card(fbId, 'undo', { summary: `Reverted: ${last.summary}`, version });
    this.hub.agent({ line: `↩ reverted fix #${last.seq}` });
  }
}
