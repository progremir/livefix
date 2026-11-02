import fsp from 'node:fs/promises';
import path from 'node:path';
import { ENGINE_GUIDE } from './guide.js';
import { isInside } from './files.js';

const ENDPOINT = 'https://api.cerebras.ai/v1/chat/completions';
const PRICE_PER_MTOK = { 'qwen-3.8-27b': { input: 0.99, output: 1.49 } };

export const FAST_MODEL = process.env.LIVEFIX_FAST_MODEL || 'qwen-3.8-27b';
const FAST_EFFORT = process.env.LIVEFIX_FAST_EFFORT || 'low';
export const fastEnabled =() => !!process.env.CEREBRAS_API_KEY;

const SYSTEM = `${ENGINE_GUIDE}

# Output for this run
You have no tools here. This overrides the tool, screenshot, replay and SUMMARY instructions above. Reply with one JSON object and nothing else:
{"summary": "<what you changed, or why you changed nothing, in plain words, at most 20 words>", "escalate": false, "edits": [{"path": "game/file.js", "old": "<exact text>", "new": "<replacement>"}]}

- "old" must match the current file exactly, including whitespace, and appear exactly once. Include enough surrounding text to make it unique.
- To create a file, use an empty "old".
- Set "escalate" to true, with no edits, if you can't be confident of the fix from the text you have, for example if it depends on how something looks.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'escalate', 'edits'],
  properties: {
    summary: { type: 'string' },
    escalate: { type: 'boolean' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'old', 'new'],
        properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } },
      },
    },
  },
};

/** Checks every edit before it writes any file, so a bad plan leaves game/ untouched. */
async function applyEdits(edits, gameDir) {
  const next = new Map();
  for (const edit of edits) {
    const file = path.resolve(gameDir, edit.path.replace(/^game\//, ''));
    if (!isInside(file, gameDir)) throw new Error(`${edit.path} is outside game/`);
    const current = next.get(file) ?? await fsp.readFile(file, 'utf8').catch(() => null);
    if (edit.old === '') {
      if (current !== null) throw new Error(`${edit.path} already exists`);
      next.set(file, edit.new);
    } else {
      if (current === null) throw new Error(`${edit.path} does not exist`);
      if (current.split(edit.old).length !== 2) throw new Error(`the old text must match ${edit.path} exactly once`);
      next.set(file, current.replace(edit.old, () => edit.new));
    }
  }
  for (const [file, text] of next) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, text);
  }
}

/** Returns { summary, cost } after it applies the edits, or { escalate: true }. Throws when the reply can't be used. */
export async function fastFix(prompt, gameDir, logFile) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CEREBRAS_API_KEY}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({
      model: FAST_MODEL,
      reasoning_effort: FAST_EFFORT,
      max_completion_tokens: 16000,
      response_format: { type: 'json_schema', json_schema: { name: 'fix', strict: true, schema: SCHEMA } },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    }),
  });
  const body = await res.json();
  await fsp.appendFile(logFile, `${JSON.stringify({ type: 'fast', status: res.status, model: FAST_MODEL, body })}\n`);
  if (!res.ok) throw new Error(`Cerebras returned ${res.status}: ${body.message || 'no message'}`);

  const plan = JSON.parse(body.choices[0].message.content);
  if (plan.escalate) return { escalate: true };
  await applyEdits(plan.edits, gameDir);
  const price = PRICE_PER_MTOK[FAST_MODEL];
  const cost = price ? (body.usage.prompt_tokens * price.input + body.usage.completion_tokens * price.output) / 1e6 : 0;
  return { summary: plan.summary, cost, fast: true };
}
