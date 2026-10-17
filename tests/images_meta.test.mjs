import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson, scheduleHash, renderKey, todayKeyAt, decideRender, buildMeta, repoSlugFrom, creditLine,
} from '../scripts/lib/images_meta.mjs';
import { argValue, readRenderSources } from '../scripts/lib/cli.mjs';
import { buildViews } from '../scripts/lib/views.mjs';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const doc = (data, update = '17.10.2026 18:54', extra = {}) => ({
  regionId: 'ivano-frankivsk',
  lastUpdated: '2026-10-17T16:00:00.000Z',
  fact: { data, update, today: 1792184400 },
  lastUpdateStatus: { status: 'parsed', ok: true },
  ...extra,
});
const DATA = { 1792184400: { 'GPV1.1': { 1: 'yes', 2: 'no' }, 'GPV1.2': { 1: 'first', 2: 'yes' } } };

describe('scheduleHash', () => {
  test('same data with different update, lastUpdated and status -> same hash', () => {
    const a = doc(DATA, '17.10.2026 18:54');
    const b = doc(structuredClone(DATA), '17.10.2026 20:00', {
      lastUpdated: '2026-10-17T18:00:00.000Z',
      lastUpdateStatus: { status: 'error', ok: false },
    });
    assert.equal(scheduleHash(a), scheduleHash(b));
    assert.match(scheduleHash(a), /^[0-9a-f]{64}$/);
  });

  test('a changed cell -> different hash', () => {
    const changed = structuredClone(DATA);
    changed[1792184400]['GPV1.1'][2] = 'second';
    assert.notEqual(scheduleHash(doc(DATA)), scheduleHash(doc(changed)));
  });

  test('key order does not matter', () => {
    const reordered = { 1792184400: { 'GPV1.2': { 2: 'yes', 1: 'first' }, 'GPV1.1': { 2: 'no', 1: 'yes' } } };
    assert.equal(scheduleHash(doc(DATA)), scheduleHash(doc(reordered)));
    assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), '{"a":[{"c":3,"d":2}],"b":1}');
  });

  test('missing fact gives the hash of {}', () => {
    assert.equal(scheduleHash({ fact: null }), scheduleHash(doc({})));
  });
});

describe('renderKey', () => {
  const NOW = Date.UTC(2026, 9, 17, 16, 0); // 17.10.2026 19:00 Kyiv
  const SOURCES = [{ path: 'templates/html/a.css', content: 'a' }, { path: 'scripts/lib/views.mjs', content: 'v' }];
  const key = (d, o = {}) => renderKey(d, { nowMs: NOW, sources: SOURCES, slug: 'o/r', ...o });

  test('update time, lastUpdated and status do not change the key', () => {
    const b = doc(structuredClone(DATA), '17.10.2026 21:00', { lastUpdated: 'x', lastUpdateStatus: { status: 'error', ok: false } });
    assert.equal(key(doc(DATA)), key(b));
    assert.match(key(doc(DATA)), /^[0-9a-f]{64}$/);
  });
  test('a changed cell changes the key', () => {
    const changed = structuredClone(DATA);
    changed[1792184400]['GPV1.1'][1] = 'no';
    assert.notEqual(key(doc(DATA)), key(doc(changed)));
  });
  test('same Kyiv day -> same key; next Kyiv day -> new key', () => {
    // 20:59 UTC = 23:59 Kyiv, 21:01 UTC = 00:01 Kyiv next day
    const late = Date.UTC(2026, 9, 17, 20, 59);
    const next = Date.UTC(2026, 9, 17, 21, 1);
    assert.equal(key(doc(DATA)), key(doc(DATA), { nowMs: late }));
    assert.notEqual(key(doc(DATA), { nowMs: late }), key(doc(DATA), { nowMs: next }));
    assert.equal(todayKeyAt(next) - todayKeyAt(late), 86400);
  });
  test('template content, source order and slug', () => {
    assert.notEqual(key(doc(DATA)), key(doc(DATA), { sources: [SOURCES[0], { path: 'scripts/lib/views.mjs', content: 'v2' }] }));
    assert.equal(key(doc(DATA)), key(doc(DATA), { sources: [...SOURCES].reverse() }));
    assert.notEqual(key(doc(DATA)), key(doc(DATA), { slug: 'x/y' }));
  });
  test('readRenderSources lists templates and views.mjs sorted', async () => {
    const paths = (await readRenderSources(root)).map((f) => f.path);
    assert.deepEqual(paths, [...paths].sort());
    for (const p of ['scripts/lib/views.mjs', 'templates/html/schedule.css', 'templates/html/schedule.html', 'templates/html/schedule.js']) {
      assert.ok(paths.includes(p), p);
    }
  });
});

describe('decideRender', () => {
  const key = 'abc';
  test('force -> render', () => {
    assert.equal(decideRender({ force: true, branchExists: true, prevMeta: { renderKey: key }, key }).render, true);
  });
  test('images branch missing -> render', () => {
    assert.equal(decideRender({ branchExists: false, prevMeta: null, key }).render, true);
  });
  test('meta.json missing or invalid -> render', () => {
    assert.equal(decideRender({ branchExists: true, prevMeta: null, key }).render, true);
    assert.equal(decideRender({ branchExists: true, prevMeta: 'x', key }).render, true);
  });
  test('meta.json without renderKey -> render', () => {
    const r = decideRender({ branchExists: true, prevMeta: { scheduleHash: 'x' }, key });
    assert.equal(r.render, true);
    assert.match(r.reason, /no renderKey/);
  });
  test('key changed -> render', () => {
    const r = decideRender({ branchExists: true, prevMeta: { renderKey: 'old' }, key });
    assert.equal(r.render, true);
    assert.match(r.reason, /old -> abc/);
  });
  test('key unchanged -> no render', () => {
    assert.equal(decideRender({ branchExists: true, prevMeta: { renderKey: key }, key }).render, false);
  });
});

describe('argValue', () => {
  const argv = ['node', 's', '--a', '1', '--empty', '', '--last'];
  test('value, absent, empty and missing value', () => {
    assert.equal(argValue('a', 'd', argv), '1');
    assert.equal(argValue('b', 'd', argv), 'd');
    assert.equal(argValue('empty', 'd', argv), 'd');
    assert.equal(argValue('last', 'd', argv), 'd');
  });
});

describe('meta and credit', () => {
  test('buildMeta shape', () => {
    const d = doc(DATA);
    const m = buildMeta(d, [
      { name: 'gpv-2-1.png', sha256: 'b', bytes: 2 },
      { name: 'gpv-1-1.png', sha256: 'a', bytes: 1 },
    ], { nowIso: '2026-10-17T16:00:00.000Z', renderKey: 'k', slug: 'o/r' });
    assert.deepEqual(m, {
      regionId: 'ivano-frankivsk',
      renderedAt: '2026-10-17T16:00:00.000Z',
      scheduleUpdate: '17.10.2026 18:54',
      scheduleHash: scheduleHash(d),
      renderKey: 'k',
      sourceRepo: 'https://github.com/o/r',
      files: { 'gpv-1-1.png': { sha256: 'a', bytes: 1 }, 'gpv-2-1.png': { sha256: 'b', bytes: 2 } },
    });
    assert.deepEqual(Object.keys(m.files), ['gpv-1-1.png', 'gpv-2-1.png']);
  });

  test('repo slug comes from GITHUB_REPOSITORY with a fallback', () => {
    assert.equal(repoSlugFrom({ GITHUB_REPOSITORY: 'someone/fork' }), 'someone/fork');
    assert.equal(repoSlugFrom({}), 'samokisha/outage-data-if');
    assert.equal(repoSlugFrom({ GITHUB_REPOSITORY: 'bad slug' }), 'samokisha/outage-data-if');
  });

  test('every view has the credit line', () => {
    const views = buildViews({ fact: { data: {}, update: null } }, Date.UTC(2026, 9, 17, 16, 0), { repoSlug: 'o/r' });
    assert.equal(views.length, 14);
    for (const { view } of views) assert.equal(view.credit, creditLine('o/r'));
    assert.equal(creditLine('o/r'), 'Дані: АТ «Прикарпаттяобленерго» · github.com/o/r');
  });
});

describe('need_render.mjs', () => {
  async function cli(args, files) {
    const dir = await mkdtemp(path.join(tmpdir(), 'need-render-'));
    try {
      const dataPath = path.join(dir, 'data.json');
      await writeFile(dataPath, JSON.stringify(files.data));
      const metaPath = path.join(dir, 'meta.json');
      if (files.meta !== undefined) await writeFile(metaPath, typeof files.meta === 'string' ? files.meta : JSON.stringify(files.meta));
      const out = path.join(dir, 'out');
      await writeFile(out, '');
      const { stdout } = await run(process.execPath, [
        // args go first: argValue takes the first occurrence of a flag
        path.join(root, 'scripts', 'need_render.mjs'), ...args, '--data', dataPath, '--prev-meta', metaPath, '--now', String(NOW),
      ], { env: { ...process.env, GITHUB_OUTPUT: out } });
      const outputs = Object.fromEntries((await readFile(out, 'utf8')).trim().split('\n').map((l) => l.split('=')));
      return { stdout, outputs };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const d = doc(DATA);
  const NOW = Date.UTC(2026, 9, 17, 16, 0);
  const expectedKey = async (nowMs = NOW) => renderKey(d, { nowMs, sources: await readRenderSources(root) });

  test('missing meta file -> render=true', async () => {
    const r = await cli([], { data: d });
    assert.equal(r.outputs.render, 'true');
    assert.equal(r.outputs.schedule_hash, scheduleHash(d));
    assert.equal(r.outputs.render_key, await expectedKey());
    assert.equal(r.outputs.now_ms, String(NOW));
    assert.match(r.stdout, /meta\.json is missing/);
  });
  test('empty meta file -> render=true', async () => {
    assert.equal((await cli([], { data: d, meta: '' })).outputs.render, 'true');
  });
  test('branch missing -> render=true', async () => {
    const r = await cli(['--branch-exists', 'false'], { data: d });
    assert.equal(r.outputs.render, 'true');
    assert.match(r.stdout, /branch does not exist/);
  });
  test('same key -> render=false; with force -> true', async () => {
    const meta = { renderKey: await expectedKey(), scheduleHash: scheduleHash(d) };
    assert.equal((await cli([], { data: d, meta })).outputs.render, 'false');
    assert.equal((await cli(['--force', 'true'], { data: d, meta })).outputs.render, 'true');
  });
  test('only fact.update changed -> render=false', async () => {
    const meta = { renderKey: await expectedKey() };
    assert.equal((await cli([], { data: doc(DATA, '17.10.2026 23:00'), meta })).outputs.render, 'false');
  });
  test('next Kyiv day -> render=true', async () => {
    const meta = { renderKey: await expectedKey() };
    assert.equal((await cli(['--now', String(NOW + 86400e3)], { data: d, meta })).outputs.render, 'true');
  });
  test('old meta with scheduleHash only -> render=true', async () => {
    assert.equal((await cli([], { data: d, meta: { scheduleHash: scheduleHash(d) } })).outputs.render, 'true');
  });
});
