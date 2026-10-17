#!/usr/bin/env node
// Renders all PNG images for Ivano-Frankivsk from data/ivano-frankivsk.json into images/ivano-frankivsk/.
//
// Usage: node scripts/render.mjs [--scale 2] [--now <ms>]
//   --now  render instant in ms (default now); it decides which Kyiv day is "today"
// Requirements: Playwright Chromium (npx playwright install chromium).

import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGION_ID } from './lib/convert.mjs';
import { buildViews } from './lib/views.mjs';
import { startStaticServer, createBrowser, renderView } from './lib/renderer.mjs';
import { argValue } from './lib/cli.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(projectRoot, 'data', `${REGION_ID}.json`);
const outDir = path.join(projectRoot, 'images', REGION_ID);
const templatesDir = path.join(projectRoot, 'templates', 'html');

async function main() {
  const scale = Math.min(Math.max(Number(argValue('scale', 2)) || 2, 1), 4);
  const doc = JSON.parse(await readFile(dataPath, 'utf8'));
  const nowMs = Number(argValue('now', String(Date.now())));
  if (!Number.isFinite(nowMs)) throw new Error('--now must be a number of milliseconds');
  const views = buildViews(doc, nowMs);
  await mkdir(outDir, { recursive: true });

  const { server, baseURL } = await startStaticServer(templatesDir);
  const browser = await createBrowser();
  let failed = 0;
  try {
    const context = await browser.newContext({
      deviceScaleFactor: scale,
      locale: 'uk-UA',
      timezoneId: 'Europe/Kyiv',
      viewport: { width: 1600, height: 1000 },
    });
    for (const { file, view } of views) {
      const outPath = path.join(outDir, file);
      try {
        await renderView({ context, baseURL, templatePath: 'schedule.html', view, outPath });
        console.log(`[OK] ${path.relative(projectRoot, outPath)}`);
      } catch (e) {
        failed++;
        console.error(`[ERROR] ${file}: ${e.message}`);
      }
    }
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`[INFO] Rendered ${views.length - failed}/${views.length} images (scale=${scale})`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(`[ERROR] render crashed: ${e?.stack || e}`);
  process.exit(1);
});
