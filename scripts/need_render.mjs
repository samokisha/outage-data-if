#!/usr/bin/env node
// Decides whether the images must be re-rendered.
//
// Usage: node scripts/need_render.mjs [--prev-meta <path>] [--branch-exists true|false] [--force true|false]
//                                     [--data <path>] [--now <ms>]
//   --prev-meta      meta.json from the images branch; the file may not exist
//   --branch-exists  whether the images branch exists on the remote (default true)
//   --force          force_render input (default false)
//   --data           data JSON (default data/ivano-frankivsk.json)
//   --now            render instant in ms (default now); pass the same value to render.mjs and write_meta.mjs
// Env: GITHUB_OUTPUT (optional) - receives render=true|false, render_key, schedule_hash, now_ms

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGION_ID } from './lib/convert.mjs';
import { scheduleHash, renderKey, decideRender } from './lib/images_meta.mjs';
import { argValue, setOutput, readRenderSources } from './lib/cli.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJsonOrNull(p) {
  if (!p) return null;
  try {
    const text = await readFile(p, 'utf8');
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function main() {
  const dataPath = argValue('data', path.join(projectRoot, 'data', `${REGION_ID}.json`));
  const nowMs = Number(argValue('now', String(Date.now())));
  if (!Number.isFinite(nowMs)) throw new Error('--now must be a number of milliseconds');
  const doc = JSON.parse(await readFile(dataPath, 'utf8'));
  const key = renderKey(doc, { nowMs, sources: await readRenderSources(projectRoot) });
  const { render, reason } = decideRender({
    force: argValue('force', 'false') === 'true',
    branchExists: argValue('branch-exists', 'true') === 'true',
    prevMeta: await readJsonOrNull(argValue('prev-meta', '')),
    key,
  });
  console.log(`[INFO] render=${render}: ${reason}`);
  await setOutput('render', String(render));
  await setOutput('render_key', key);
  await setOutput('schedule_hash', scheduleHash(doc));
  await setOutput('now_ms', String(nowMs));
}

main().catch((e) => {
  console.error(`[ERROR] need_render crashed: ${e?.stack || e}`);
  process.exit(1);
});
