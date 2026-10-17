// Builds the view models for every image from data/ivano-frankivsk.json. Pure, no I/O.

import { QUEUES, groupKey, kyivDateString, kyivMidnightUnix, addDays, dateStringFromKey, parseDate } from './convert.mjs';
import { REPO_SLUG, creditLine } from './images_meta.mjs';

export const LEGEND = [
  { state: 'yes', label: 'Світло є' },
  { state: 'no', label: 'Світла немає' },
  { state: 'first', label: 'Світла не буде перші 30 хв.' },
  { state: 'second', label: 'Світла не буде другі 30 хв.' },
];

const WEEKDAYS = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота'];

export function weekdayOf(dateStr) {
  const d = parseDate(dateStr);
  return WEEKDAYS[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()];
}

export const fileNameForQueue = (q) => `gpv-${q.replace('.', '-')}.png`;

/**
 * @param {object} doc parsed data/ivano-frankivsk.json
 * @param {number} nowMs current instant; "today" is the current Kyiv date
 * @param {{ repoSlug?: string }} [opts] repo slug for the credit line
 * @returns {{ file: string, view: object }[]}
 */
export function buildViews(doc, nowMs, { repoSlug = REPO_SLUG } = {}) {
  const credit = creditLine(repoSlug);
  const data = (doc && doc.fact && doc.fact.data) || {};
  const updated = `Оновлено: ${(doc && doc.fact && doc.fact.update) || '—'}`;
  const todayStr = kyivDateString(nowMs);
  const tomorrowStr = addDays(todayStr, 1);
  const todayKey = kyivMidnightUnix(todayStr);
  const tomorrowKey = kyivMidnightUnix(tomorrowStr);
  const keys = Object.keys(data).map(Number).filter((k) => k >= todayKey).sort((a, b) => a - b);

  const out = [];

  for (const q of QUEUES) {
    const g = groupKey(q);
    const rows = keys.filter((k) => data[String(k)] && data[String(k)][g]).map((k) => {
      const date = dateStringFromKey(k);
      const rel = k === todayKey ? 'Сьогодні' : k === tomorrowKey ? 'Завтра' : null;
      return { head: date, sub: rel ? `${rel}, ${weekdayOf(date).toLowerCase()}` : weekdayOf(date), hours: data[String(k)][g] };
    });
    out.push({
      file: fileNameForQueue(q),
      view: {
        title: `Графік відключень: група ${q}`,
        updated,
        corner: 'Дата',
        tableClass: 'days',
        rows,
        message: rows.length ? null : 'Графік ще не опубліковано',
        legend: LEGEND,
        credit,
      },
    });
  }

  for (const [file, key, dateStr, missing] of [
    ['gpv-all-today.png', todayKey, todayStr, 'Графік на сьогодні ще не опубліковано'],
    ['gpv-all-tomorrow.png', tomorrowKey, tomorrowStr, 'Графік на завтра ще не опубліковано'],
  ]) {
    const day = data[String(key)];
    out.push({
      file,
      view: {
        title: `Графік відключень на: ${dateStr}`,
        updated,
        corner: 'Часові проміжки',
        tableClass: 'groups',
        rows: day ? QUEUES.map((q) => ({ head: `Група ${q}`, sub: null, hours: day[groupKey(q)] })) : [],
        message: day ? null : missing,
        legend: LEGEND,
        credit,
      },
    });
  }

  return out;
}
