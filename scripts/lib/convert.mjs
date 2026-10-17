// Pure conversion logic: Prykarpattiaoblenergo API responses -> outage-data-ua compatible JSON.
// No I/O here, so every function can be unit-tested with node:test.

import { createHash } from 'node:crypto';

export const REGION_ID = 'ivano-frankivsk';
export const REGION_AFFILIATION = 'Івано-Франківська область';
export const SCHEMA_VERSION = '1.0.0';
export const TIME_ZONE = 'Europe/Kyiv';

export const QUEUES = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'];

export const groupKey = (queue) => `GPV${queue}`;

const pad2 = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------
// Time helpers (Europe/Kyiv, DST-aware through Intl)
// ---------------------------------------------------------------------------

const kyivFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Wall-clock parts of an instant in Europe/Kyiv. */
export function kyivParts(ms) {
  const map = {};
  for (const p of kyivFormatter.formatToParts(new Date(ms))) map[p.type] = p.value;
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour: Number(map.hour), minute: Number(map.minute), second: Number(map.second),
  };
}

/** Offset of Europe/Kyiv from UTC in minutes at the given instant (+120 or +180). */
export function kyivOffsetMinutes(ms) {
  const p = kyivParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** Parses "DD.MM.YYYY" into { year, month, day } or returns null. */
export function parseDate(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

export const formatDate = ({ year, month, day }) => `${pad2(day)}.${pad2(month)}.${year}`;

/**
 * Unix seconds of 00:00 Europe/Kyiv on the given "DD.MM.YYYY" date.
 * This is the key convention used by outage-data-ua (fact.data keys, fact.today).
 */
export function kyivMidnightUnix(dateStr) {
  const d = parseDate(dateStr);
  if (!d) throw new Error(`Invalid date: ${dateStr}`);
  const guess = Date.UTC(d.year, d.month - 1, d.day, 0, 0, 0);
  let ts = guess - kyivOffsetMinutes(guess) * 60000;
  const corrected = guess - kyivOffsetMinutes(ts) * 60000;
  if (corrected !== ts) ts = corrected;
  return Math.floor(ts / 1000);
}

/** "DD.MM.YYYY" of the given instant in Europe/Kyiv. */
export function kyivDateString(ms) {
  const p = kyivParts(ms);
  return formatDate(p);
}

/** Calendar arithmetic on a "DD.MM.YYYY" date (independent of DST). */
export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  if (!d) throw new Error(`Invalid date: ${dateStr}`);
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return formatDate({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}

/** "DD.MM.YYYY" for a fact.data key (unix seconds of a Kyiv midnight). */
export function dateStringFromKey(key) {
  return kyivDateString(Number(key) * 1000 + 12 * 3600 * 1000);
}

/** Parses "DD.MM.YYYY HH:mm" into a sortable number, or null. */
export function stampValue(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m || !parseDate(`${m[1]}.${m[2]}.${m[3]}`)) return null;
  return Number(`${m[3]}${m[2]}${m[1]}${pad2(m[4])}${m[5]}`);
}

// ---------------------------------------------------------------------------
// Interval -> hourly state conversion (same rules as svitlo/index.html)
// ---------------------------------------------------------------------------

/** "HH:mm" -> minutes since midnight, or null. "24:00" -> 1440. */
export function toMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/**
 * Converts one API entry into [startMin, endMin) intervals inside the day.
 * - "to" equal to "24:00" or "00:00" means end of day ("00:00-00:00" is the whole day).
 * - from > to means the outage crosses midnight; it is clipped to the end of this day.
 * - Falls back to "shutdownHours" ("HH:mm-HH:mm") when from/to are missing.
 */
export function intervalsOf(entry) {
  let from = toMin(entry?.from);
  let to = toMin(entry?.to);
  if ((from === null || to === null) && typeof entry?.shutdownHours === 'string') {
    const parts = entry.shutdownHours.split('-');
    if (parts.length === 2) { from = toMin(parts[0]); to = toMin(parts[1]); }
  }
  if (from === null || to === null) return [];
  if (to === 0) to = 1440;
  if (to > from) return [[from, to]];
  if (to < from) return [[from, 1440]];
  return [];
}

/** Hour state from two half-hour "off" flags, in outage-data-ua vocabulary. */
export function hourState(firstOff, secondOff) {
  if (firstOff && secondOff) return 'no';
  if (firstOff) return 'first';
  if (secondOff) return 'second';
  return 'yes';
}

/**
 * Converts a list of API entries for one queue and one day into
 * { "1": state, ..., "24": state } where hour "1" is 00:00-01:00.
 * A 30-minute slot is "off" when outages overlap it by 15 minutes or more.
 * Only status 1 means an outage; any other status is ignored and reported via onWarn.
 */
export function hoursFromEntries(entries, onWarn = () => {}) {
  const off = new Array(48).fill(false);
  for (const e of entries || []) {
    if (!e || typeof e !== 'object') continue;
    if (Number(e.status) !== 1) {
      onWarn(`Ignoring entry with status=${JSON.stringify(e.status)}: ${JSON.stringify(e)}`);
      continue;
    }
    const ivs = intervalsOf(e);
    if (!ivs.length) onWarn(`Cannot read interval from entry: ${JSON.stringify(e)}`);
    for (const [a, b] of ivs) {
      for (let s = 0; s < 48; s++) {
        const overlap = Math.min(b, (s + 1) * 30) - Math.max(a, s * 30);
        if (overlap >= 15) off[s] = true;
      }
    }
  }
  const out = {};
  for (let h = 0; h < 24; h++) out[String(h + 1)] = hourState(off[2 * h], off[2 * h + 1]);
  return out;
}

export function allYes() {
  const out = {};
  for (let h = 1; h <= 24; h++) out[String(h)] = 'yes';
  return out;
}

// ---------------------------------------------------------------------------
// Response validation and fact/preset assembly
// ---------------------------------------------------------------------------

/** Returns null when the body of /schedule-by-queue looks valid, otherwise a reason. */
export function validateResponse(queue, body) {
  if (!Array.isArray(body)) return `queue ${queue}: response is not a JSON array`;
  for (const item of body) {
    if (!item || typeof item !== 'object') return `queue ${queue}: item is not an object`;
    if (!parseDate(item.eventDate)) return `queue ${queue}: invalid eventDate ${JSON.stringify(item.eventDate)}`;
    if (item.queues != null && typeof item.queues !== 'object') return `queue ${queue}: "queues" is not an object`;
    const list = item.queues?.[queue];
    if (list != null && !Array.isArray(list)) return `queue ${queue}: queues["${queue}"] is not an array`;
  }
  return null;
}

/**
 * Builds the `fact` block.
 * @param {Record<string, any[]>} responses queue -> response array (all 12 queues fetched OK)
 * @param {number} nowMs current instant
 * @param {(msg: string) => void} onWarn
 */
export function buildFact(responses, nowMs, onWarn = () => {}) {
  const todayKey = kyivMidnightUnix(kyivDateString(nowMs));
  const dates = new Map(); // key -> "DD.MM.YYYY"
  let best = null, bestVal = -1;

  for (const q of QUEUES) {
    for (const item of responses[q] || []) {
      const date = String(item.eventDate).trim();
      const key = kyivMidnightUnix(date);
      if (key < todayKey) continue; // past days are dropped, so they do not count for `update` either
      dates.set(key, date);
      for (const s of [item.scheduleApprovedSince, item.createdAt]) {
        const v = stampValue(s);
        if (v !== null) {
          if (v > bestVal) { bestVal = v; best = String(s).trim(); }
          break;
        }
      }
    }
  }

  const data = {};
  const keys = [...dates.keys()].sort((a, b) => a - b);
  for (const key of keys) {
    const date = dates.get(key);
    const day = {};
    for (const q of QUEUES) {
      const entries = [];
      let present = false;
      for (const item of responses[q] || []) {
        if (String(item.eventDate).trim() !== date) continue;
        const list = item.queues?.[q];
        if (Array.isArray(list)) { present = true; entries.push(...list); }
      }
      // A queue that fetched OK but has no entry for this date has power all day.
      day[groupKey(q)] = present
        ? hoursFromEntries(entries, (m) => onWarn(`${date} queue ${q}: ${m}`))
        : allYes();
    }
    data[String(key)] = day;
  }

  return { data, update: best, today: todayKey };
}

const DAYS = { 1: 'Понеділок', 2: 'Вівторок', 3: 'Середа', 4: 'Четвер', 5: "П'ятниця", 6: 'Субота', 7: 'Неділя' };
const DAYS_MINI = { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб', 7: 'Нд' };
export const TIME_TYPE = {
  yes: 'Світло є',
  maybe: 'Можливо відключення',
  no: 'Світла немає',
  first: 'Світла не буде перші 30 хв.',
  second: 'Світла не буде другі 30 хв',
  mfirst: 'Світла можливо не буде перші 30 хв.',
  msecond: 'Світла можливо не буде другі 30 хв',
};

function timeZoneDict() {
  const out = {};
  for (let h = 0; h < 24; h++) {
    out[String(h + 1)] = [`${pad2(h)}-${pad2(h + 1)}`, `${pad2(h)}:00`, `${pad2(h + 1)}:00`];
  }
  return out;
}

function stringKeys(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [String(k), v]));
}

/** Builds the `preset` block. IF has no weekly template, so `data` is empty. */
export function buildPreset(updateFact) {
  const schNames = {};
  for (const q of QUEUES) schNames[groupKey(q)] = `Черга ${q}`;
  return {
    days: stringKeys(DAYS),
    days_mini: stringKeys(DAYS_MINI),
    sch_names: schNames,
    time_zone: timeZoneDict(),
    time_type: { ...TIME_TYPE },
    data: {},
    updateFact: updateFact ?? null,
  };
}

/** sha256 over fact + preset (the non-volatile content), like outage-data-ua. */
export function contentHash(fact, preset) {
  return createHash('sha256').update(`${JSON.stringify(fact)}|${JSON.stringify(preset)}`).digest('hex');
}
