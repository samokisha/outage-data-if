// Schedule hash, render decision and meta.json for the `images` branch. Pure, no I/O.

import { createHash } from 'node:crypto';
import { REGION_ID, kyivDateString, kyivMidnightUnix } from './convert.mjs';

const DEFAULT_REPO_SLUG = 'samokisha/outage-data-if';

/** Returns "owner/repo" from GITHUB_REPOSITORY when it is valid, otherwise the default slug. */
export function repoSlugFrom(env = process.env) {
  const v = env && env.GITHUB_REPOSITORY;
  return typeof v === 'string' && /^[\w.-]+\/[\w.-]+$/.test(v) ? v : DEFAULT_REPO_SLUG;
}

/** The single repo slug for image credits, meta.json and links. */
export const REPO_SLUG = repoSlugFrom();

export const creditLine = (slug = REPO_SLUG) => `Дані: АТ «Прикарпаттяобленерго» · github.com/${slug}`;

/** JSON with object keys sorted at every level, so key order does not change the result. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** sha256 of canonical JSON of fact.data only. fact.update, lastUpdated and status do not count. */
export function scheduleHash(doc) {
  const data = (doc && doc.fact && doc.fact.data) || {};
  return createHash('sha256').update(canonicalJson(data)).digest('hex');
}

const sha256 = (x) => createHash('sha256').update(x).digest('hex');

/** Kyiv day key (Unix seconds of 00:00 Europe/Kyiv) for the instant nowMs. */
export const todayKeyAt = (nowMs) => kyivMidnightUnix(kyivDateString(nowMs));

/**
 * The schedule content the images show at nowMs, without the dates: each day from today on as
 * [offset in days from today, content]. Offset 0 is "today", 1 is "tomorrow". A new Kyiv day
 * with the same content at the same offsets (for example, no schedule at all) gives the same value.
 */
export function visibleDays(doc, nowMs) {
  const data = (doc && doc.fact && doc.fact.data) || {};
  const todayKey = kyivMidnightUnix(kyivDateString(nowMs));
  return Object.keys(data).map(Number).filter((k) => k >= todayKey).sort((a, b) => a - b)
    // Math.round: a DST day has 23 or 25 hours
    .map((k) => [Math.round((k - todayKey) / 86400), data[String(k)]]);
}

/**
 * Key of everything that changes the rendered images: the visible schedule content (see
 * visibleDays), the template and view sources, and the repo slug.
 * The date alone is not part of the key: when only the Kyiv day changes and the visible
 * content stays the same, the images keep the old date. fact.update is not part of the key.
 * @param {object} doc data/ivano-frankivsk.json
 * @param {{ nowMs: number, sources: { path: string, content: string|Buffer }[], slug?: string }} opts
 */
export function renderKey(doc, { nowMs, sources, slug = REPO_SLUG }) {
  const files = [...sources]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => [f.path, sha256(f.content)]);
  return sha256(canonicalJson({ visible: visibleDays(doc, nowMs), files, slug }));
}

/**
 * @param {{ force?: boolean, branchExists?: boolean, prevMeta?: object|null, key: string }} input
 * @returns {{ render: boolean, reason: string }}
 */
export function decideRender({ force = false, branchExists = true, prevMeta = null, key }) {
  if (force) return { render: true, reason: 'force_render is set' };
  if (!branchExists) return { render: true, reason: 'images branch does not exist' };
  if (!prevMeta || typeof prevMeta !== 'object') return { render: true, reason: 'meta.json is missing or invalid on the images branch' };
  if (!prevMeta.renderKey) return { render: true, reason: 'meta.json has no renderKey' };
  if (prevMeta.renderKey !== key) {
    return { render: true, reason: `renderKey changed (${prevMeta.renderKey} -> ${key}): visible schedule, templates or repo slug changed` };
  }
  return { render: false, reason: `renderKey unchanged (${key})` };
}

/**
 * @param {object} doc data/ivano-frankivsk.json
 * @param {{ name: string, sha256: string, bytes: number }[]} files
 * @param {{ nowIso: string, renderKey: string, slug?: string }} opts
 */
export function buildMeta(doc, files, { nowIso, renderKey: key, slug = REPO_SLUG }) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  return {
    regionId: (doc && doc.regionId) || REGION_ID,
    renderedAt: nowIso,
    scheduleUpdate: (doc && doc.fact && doc.fact.update) || null,
    scheduleHash: scheduleHash(doc),
    renderKey: key,
    sourceRepo: `https://github.com/${slug}`,
    files: Object.fromEntries(sorted.map((f) => [f.name, { sha256: f.sha256, bytes: f.bytes }])),
  };
}
