#!/usr/bin/env node
// Fetches the 12 Prykarpattiaoblenergo queues, builds data/ivano-frankivsk.json,
// applies the change policy and reports whether anything was written.
//
// Usage: node scripts/fetch_if.mjs
// Env:   GITHUB_OUTPUT (optional) - receives
//          data_changed=true|false  fact/preset content changed (images must be re-rendered)
//          changed=true|false       data or raw/ivano-frankivsk.json was rewritten (something to commit)
//        FETCH_TIMEOUT_MS (optional, default 20000)

import { readFile, writeFile, rename, mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUEUES, REGION_ID, buildFact, buildPreset, validateResponse } from './lib/convert.mjs';
import { applySuccess, applyError } from './lib/state.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = path.join(projectRoot, 'data', `${REGION_ID}.json`);
const RAW_PATH = path.join(projectRoot, 'raw', `${REGION_ID}.json`);

const API_URL = 'https://be-svitlo.oe.if.ua/schedule-by-queue?queue=';
const TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 20000;
const RETRIES = 3;
const CONCURRENCY = 4;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FetchError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

async function fetchOnce(queue) {
  let res;
  try {
    res = await fetch(API_URL + encodeURIComponent(queue), {
      headers: HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new FetchError(timeout ? `timeout after ${TIMEOUT_MS} ms` : `network error: ${e?.cause?.code || e?.message || e}`, timeout ? 504 : 503);
  }
  const text = await res.text();
  if (!res.ok) throw new FetchError(`HTTP ${res.status}`, res.status);
  let body;
  try { body = JSON.parse(text); } catch {
    throw new FetchError(`invalid JSON (starts with ${JSON.stringify(text.slice(0, 60))})`, 422);
  }
  const problem = validateResponse(queue, body);
  if (problem) throw new FetchError(problem, 422);
  return body;
}

async function fetchQueue(queue) {
  let last;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      return { queue, ok: true, body: await fetchOnce(queue) };
    } catch (e) {
      last = e;
      console.warn(`[WARN] queue ${queue} attempt ${attempt + 1}/${RETRIES + 1}: ${e.message}`);
    }
  }
  return { queue, ok: false, code: last.code, error: last.message };
}

async function fetchAll() {
  const results = new Array(QUEUES.length);
  let next = 0;
  async function worker() {
    while (next < QUEUES.length) {
      const i = next++;
      results[i] = await fetchQueue(QUEUES[i]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

async function readJson(p) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; }
}

async function writeAtomic(p, text) {
  await mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, p);
}

async function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const prev = await readJson(DATA_PATH);

  const results = await fetchAll();
  const failed = results.filter((r) => !r.ok);

  let outcome;
  let rawChanged = false;
  if (failed.length) {
    // Keep message and code stable between runs, so a flaky API does not rewrite the file every time.
    // The per-queue error details go to the log only.
    for (const r of failed) console.error(`[ERROR] queue ${r.queue}: ${r.error}`);
    const codes = new Set(failed.map((r) => r.code));
    const code = codes.size === 1 ? failed[0].code : 503;
    const message = failed.length === QUEUES.length
      ? `All ${QUEUES.length} queues failed, previous data kept`
      : `Partial fetch: ${failed.length}/${QUEUES.length} queues failed (${failed.map((r) => r.queue).join(', ')}), previous data kept`;
    console.error(`[ERROR] ${message}`);
    outcome = applyError(prev, { code, message, nowIso });
  } else {
    const responses = Object.fromEntries(results.map((r) => [r.queue, r.body]));
    const fact = buildFact(responses, now, (m) => console.warn(`[WARN] ${m}`));
    const preset = buildPreset(fact.update);
    outcome = applySuccess(prev, { fact, preset, nowIso });

    const rawText = JSON.stringify({ source: API_URL, queues: responses }, null, 2) + '\n';
    let prevRaw = null;
    try { prevRaw = await readFile(RAW_PATH, 'utf8'); } catch { prevRaw = null; }
    if (prevRaw !== rawText) {
      await writeAtomic(RAW_PATH, rawText);
      rawChanged = true;
      console.log(`[INFO] Raw responses written to ${path.relative(projectRoot, RAW_PATH)}`);
    }

    const days = Object.keys(fact.data).length;
    console.log(`[INFO] Fetched ${QUEUES.length} queues, ${days} day(s), update=${fact.update}`);
  }

  if (outcome.changed) {
    await writeAtomic(DATA_PATH, JSON.stringify(outcome.doc, null, 2) + '\n');
    console.log(`[OK] File written ${path.relative(projectRoot, DATA_PATH)} (status=${outcome.doc.lastUpdateStatus.status}, content changed=${outcome.contentChanged})`);
  } else {
    console.log('[OK] No changes, file not rewritten');
  }
  await setOutput('data_changed', String(outcome.contentChanged));
  await setOutput('changed', String(outcome.changed || rawChanged));
}

main().catch(async (e) => {
  console.error(`[ERROR] fetch_if crashed: ${e?.stack || e}`);
  await setOutput('data_changed', 'false').catch(() => {});
  await setOutput('changed', 'false').catch(() => {});
  process.exit(1);
});
