// Small helpers shared by the command-line entry points.

import { appendFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Returns the value after `--<name>` in argv. Returns `def` when the flag is absent,
 * has no value, or the value is empty.
 */
export function argValue(name, def, argv = process.argv) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v === '' ? def : v;
}

/** Appends `name=value` to GITHUB_OUTPUT when it is set. */
export async function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

/**
 * Reads the files that change how images look: templates/html/* and scripts/lib/views.mjs.
 * @returns {Promise<{ path: string, content: Buffer }[]>} sorted by path, paths relative to projectRoot
 */
export async function readRenderSources(projectRoot) {
  const templatesDir = path.join(projectRoot, 'templates', 'html');
  const rel = (await readdir(templatesDir, { withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => `templates/html/${e.name}`);
  rel.push('scripts/lib/views.mjs');
  rel.sort();
  return Promise.all(rel.map(async (p) => ({ path: p, content: await readFile(path.join(projectRoot, p)) })));
}
