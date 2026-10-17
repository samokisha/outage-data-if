#!/usr/bin/env node
// Writes images/ivano-frankivsk/meta.json for the PNG files in that directory.
// Run it after pngquant, so the sha256 values match the final files.
//
// Usage: node scripts/write_meta.mjs [--data <path>] [--dir <path>] [--now <ms>]
//   --now  the render instant used by render.mjs (default now); it sets the Kyiv day in renderKey

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGION_ID } from './lib/convert.mjs';
import { buildMeta, renderKey } from './lib/images_meta.mjs';
import { argValue, readRenderSources } from './lib/cli.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const dataPath = argValue('data', path.join(projectRoot, 'data', `${REGION_ID}.json`));
  const dir = argValue('dir', path.join(projectRoot, 'images', REGION_ID));
  const nowMs = Number(argValue('now', String(Date.now())));
  if (!Number.isFinite(nowMs)) throw new Error('--now must be a number of milliseconds');
  const doc = JSON.parse(await readFile(dataPath, 'utf8'));
  const names = (await readdir(dir)).filter((n) => n.endsWith('.png'));
  if (!names.length) throw new Error(`No PNG files in ${dir}`);
  const files = await Promise.all(names.map(async (name) => {
    const buf = await readFile(path.join(dir, name));
    return { name, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
  }));
  const key = renderKey(doc, { nowMs, sources: await readRenderSources(projectRoot) });
  const meta = buildMeta(doc, files, { nowIso: new Date().toISOString(), renderKey: key });
  const out = path.join(dir, 'meta.json');
  await writeFile(out, JSON.stringify(meta, null, 2) + '\n');
  console.log(`[OK] ${path.relative(projectRoot, out)}: ${files.length} files, renderKey=${key}, scheduleHash=${meta.scheduleHash}`);
}

main().catch((e) => {
  console.error(`[ERROR] write_meta failed: ${e?.stack || e}`);
  process.exit(1);
});
