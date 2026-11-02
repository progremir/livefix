import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const isInside = (p, dir) => {
  const rel = path.relative(dir, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

export async function listFiles(dir, base = dir) {
  let out = [];
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(await listFiles(full, base));
    else if (e.isFile()) out.push(path.relative(base, full));
  }
  return out.sort();
}

export async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  for (const f of await listFiles(src)) {
    await fsp.mkdir(path.dirname(path.join(dest, f)), { recursive: true });
    await fsp.copyFile(path.join(src, f), path.join(dest, f));
  }
  return dest;
}

/** Make `dest` identical to `src` (adds, overwrites and deletes files). */
export async function mirrorDir(src, dest) {
  const want = new Set(await listFiles(src));
  for (const f of await listFiles(dest)) if (!want.has(f)) await fsp.rm(path.join(dest, f));
  await copyDir(src, dest);
}

export async function changedFiles(a, b) {
  const fa = await listFiles(a);
  const fb = await listFiles(b);
  const all = [...new Set([...fa, ...fb])].sort();
  const changed = [];
  for (const f of all) {
    const [x, y] = await Promise.all([read(path.join(a, f)), read(path.join(b, f))]);
    if (x === null || y === null || !x.equals(y)) changed.push(f);
  }
  return changed;
}

export async function hashDir(dir) {
  const h = crypto.createHash('sha1');
  for (const f of await listFiles(dir)) {
    h.update(f);
    h.update((await read(path.join(dir, f))) ?? '');
  }
  return h.digest('hex');
}

async function read(p) {
  try { return await fsp.readFile(p); } catch { return null; }
}
