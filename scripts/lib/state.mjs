// Change policy for data/ivano-frankivsk.json. Pure functions: they get the previous
// document (or null) and return the next document plus a flag that says whether to write it.

import { REGION_ID, REGION_AFFILIATION, SCHEMA_VERSION, contentHash } from './convert.mjs';

function emptyDoc() {
  return {
    regionId: REGION_ID,
    regionAffiliation: REGION_AFFILIATION,
    lastUpdated: null,
    fact: null,
    preset: null,
    lastUpdateStatus: { status: 'idle', ok: true, code: null, message: null, at: null, attempt: 0 },
    meta: { schemaVersion: SCHEMA_VERSION, contentHash: null },
  };
}

const prevAttempt = (prev) =>
  (prev && prev.lastUpdateStatus && Number.isFinite(prev.lastUpdateStatus.attempt)) ? prev.lastUpdateStatus.attempt : 0;

/**
 * All 12 queues fetched OK.
 * Do not rewrite the file when the content hash is unchanged and the previous status was ok.
 * `contentChanged` is true only when fact/preset changed (images must be re-rendered).
 */
export function applySuccess(prev, { fact, preset, nowIso }) {
  const hash = contentHash(fact, preset);
  const prevOk = !!(prev && prev.lastUpdateStatus && prev.lastUpdateStatus.ok === true && prev.lastUpdateStatus.status !== 'idle');
  if (prev && prev.meta && prev.meta.contentHash === hash && prevOk) {
    return { changed: false, contentChanged: false, doc: prev };
  }
  const contentChanged = !(prev && prev.meta && prev.meta.contentHash === hash);
  const doc = {
    regionId: REGION_ID,
    regionAffiliation: REGION_AFFILIATION,
    lastUpdated: nowIso,
    fact,
    preset,
    lastUpdateStatus: { status: 'parsed', ok: true, code: 200, message: null, at: nowIso, attempt: prevAttempt(prev) + 1 },
    meta: { schemaVersion: SCHEMA_VERSION, contentHash: hash },
  };
  return { changed: true, contentChanged, doc };
}

/**
 * Fetch failed (all queues, or some queues: a partial day is never published).
 * Keep previous fact/preset/meta and only update lastUpdateStatus. Write only when the
 * status goes from ok to error, or the error code/message changes.
 */
export function applyError(prev, { code, message, nowIso }) {
  const base = prev ? structuredClone(prev) : emptyDoc();
  const s = prev && prev.lastUpdateStatus;
  if (s && s.ok === false && s.status === 'error' && s.code === code && s.message === message) {
    return { changed: false, contentChanged: false, doc: prev };
  }
  base.lastUpdateStatus = { status: 'error', ok: false, code, message, at: nowIso, attempt: prevAttempt(prev) + 1 };
  base.meta = { schemaVersion: SCHEMA_VERSION, contentHash: base.meta ? base.meta.contentHash ?? null : null };
  return { changed: true, contentChanged: false, doc: base };
}
