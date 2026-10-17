import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUEUES, intervalsOf, hoursFromEntries, kyivMidnightUnix, kyivDateString, addDays,
  dateStringFromKey, buildFact, buildPreset, contentHash, validateResponse, stampValue,
} from '../scripts/lib/convert.mjs';
import { applySuccess, applyError } from '../scripts/lib/state.mjs';
import { buildViews } from '../scripts/lib/views.mjs';

const off = (from, to, extra = {}) => ({ shutdownHours: `${from}-${to}`, from, to, status: 1, ...extra });

/** Returns the hours that are not "yes" as { hour: state }. */
function nonYes(hours) {
  return Object.fromEntries(Object.entries(hours).filter(([, v]) => v !== 'yes'));
}

describe('hoursFromEntries', () => {
  test('full hours', () => {
    const h = hoursFromEntries([off('10:00', '12:00'), off('20:00', '22:00')]);
    assert.deepEqual(nonYes(h), { 11: 'no', 12: 'no', 21: 'no', 22: 'no' });
    assert.equal(Object.keys(h).length, 24);
    assert.deepEqual(Object.keys(h), Array.from({ length: 24 }, (_, i) => String(i + 1)));
  });

  test(':30 boundaries give first/second half states', () => {
    // 10:30-12:30 -> 10-11 second half off, 11-12 full, 12-13 first half off
    assert.deepEqual(nonYes(hoursFromEntries([off('10:30', '12:30')])), { 11: 'second', 12: 'no', 13: 'first' });
  });

  test('a single half hour', () => {
    assert.deepEqual(nonYes(hoursFromEntries([off('08:00', '08:30')])), { 9: 'first' });
    assert.deepEqual(nonYes(hoursFromEntries([off('08:30', '09:00')])), { 9: 'second' });
  });

  test('15-minute overlap edges', () => {
    // exactly 15 min of a slot counts as off
    assert.deepEqual(nonYes(hoursFromEntries([off('10:15', '11:00')])), { 11: 'no' });
    assert.deepEqual(nonYes(hoursFromEntries([off('10:45', '11:00')])), { 11: 'second' });
    assert.deepEqual(nonYes(hoursFromEntries([off('10:00', '10:15')])), { 11: 'first' });
    // 14 min is not enough
    assert.deepEqual(nonYes(hoursFromEntries([off('10:16', '11:00')])), { 11: 'second' });
    assert.deepEqual(nonYes(hoursFromEntries([off('10:00', '10:14')])), {});
    assert.deepEqual(nonYes(hoursFromEntries([off('10:46', '11:00')])), {});
    // 10:15-10:45 overlaps each half by 15 min -> whole hour
    assert.deepEqual(nonYes(hoursFromEntries([off('10:15', '10:45')])), { 11: 'no' });
  });

  test('"24:00" and "00:00" as end of day', () => {
    assert.deepEqual(nonYes(hoursFromEntries([off('22:00', '24:00')])), { 23: 'no', 24: 'no' });
    assert.deepEqual(nonYes(hoursFromEntries([off('22:00', '00:00')])), { 23: 'no', 24: 'no' });
    const whole = hoursFromEntries([off('00:00', '24:00')]);
    assert.ok(Object.values(whole).every((v) => v === 'no'));
    const whole2 = hoursFromEntries([off('00:00', '00:00')]);
    assert.ok(Object.values(whole2).every((v) => v === 'no'));
  });

  test('crossing midnight is clipped to the day', () => {
    assert.deepEqual(intervalsOf(off('23:00', '02:00')), [[1380, 1440]]);
    assert.deepEqual(nonYes(hoursFromEntries([off('23:30', '01:00')])), { 24: 'second' });
  });

  test('falls back to shutdownHours when from/to are missing', () => {
    assert.deepEqual(intervalsOf({ shutdownHours: '14:00-17:00', status: 1 }), [[840, 1020]]);
    assert.deepEqual(nonYes(hoursFromEntries([{ shutdownHours: '14:00-15:30', status: 1 }])), { 15: 'no', 16: 'first' });
  });

  test('status other than 1 is ignored and warned', () => {
    const warns = [];
    const h = hoursFromEntries([off('10:00', '12:00', { status: 2 }), off('14:00', '15:00')], (m) => warns.push(m));
    assert.deepEqual(nonYes(h), { 15: 'no' });
    assert.equal(warns.length, 1);
    assert.match(warns[0], /status=2/);
  });

  test('overlapping entries merge', () => {
    assert.deepEqual(nonYes(hoursFromEntries([off('10:00', '11:30'), off('11:00', '12:00')])), { 11: 'no', 12: 'no' });
  });
});

describe('Kyiv day keys', () => {
  test('matches outage-data-ua key for 17.10.2026 (EEST, UTC+3)', () => {
    assert.equal(kyivMidnightUnix('17.10.2026'), 1792184400);
  });

  test('winter time (EET, UTC+2)', () => {
    // 01.12.2026 00:00 +02:00 = 30.11.2026 22:00 UTC
    assert.equal(kyivMidnightUnix('01.12.2026'), Date.UTC(2026, 10, 30, 22) / 1000);
  });

  test('DST switch days', () => {
    // 25.10.2026: clocks go back at 04:00 local; midnight is still +03:00
    assert.equal(kyivMidnightUnix('25.10.2026'), Date.UTC(2026, 9, 24, 21) / 1000);
    assert.equal(kyivMidnightUnix('26.10.2026'), Date.UTC(2026, 9, 25, 22) / 1000);
    assert.equal(kyivMidnightUnix('26.10.2026') - kyivMidnightUnix('25.10.2026'), 25 * 3600);
    // 29.03.2026: clocks go forward at 03:00 local; midnight is still +02:00
    assert.equal(kyivMidnightUnix('29.03.2026'), Date.UTC(2026, 2, 28, 22) / 1000);
    assert.equal(kyivMidnightUnix('30.03.2026') - kyivMidnightUnix('29.03.2026'), 23 * 3600);
  });

  test('date helpers', () => {
    assert.equal(kyivDateString(Date.UTC(2026, 9, 16, 21, 30)), '17.10.2026');
    assert.equal(kyivDateString(Date.UTC(2026, 9, 16, 20, 59)), '16.10.2026');
    assert.equal(addDays('31.12.2026', 1), '01.01.2027');
    assert.equal(dateStringFromKey(kyivMidnightUnix('25.10.2026')), '25.10.2026');
    assert.equal(dateStringFromKey(kyivMidnightUnix('29.03.2026')), '29.03.2026');
  });

  test('stampValue orders DD.MM.YYYY HH:mm', () => {
    assert.ok(stampValue('17.10.2026 18:54') > stampValue('17.10.2026 09:48'));
    assert.ok(stampValue('01.11.2026 00:00') > stampValue('31.10.2026 23:59'));
    assert.equal(stampValue('bad'), null);
  });
});

function responsesFor(day, perQueue, meta = {}) {
  const out = {};
  for (const q of QUEUES) {
    out[q] = perQueue[q] ? [{ eventDate: day, queues: { [q]: perQueue[q] }, createdAt: '17.10.2026 09:48', ...meta }] : [];
  }
  return out;
}

describe('buildFact', () => {
  const now = Date.UTC(2026, 9, 17, 16, 0); // 17.10.2026 19:00 Kyiv

  test('builds all 12 groups, missing group -> all yes', () => {
    const r = responsesFor('17.10.2026', { '1.1': [off('10:00', '12:00')] }, { scheduleApprovedSince: '17.10.2026 18:54' });
    const fact = buildFact(r, now);
    assert.equal(fact.today, 1792184400);
    assert.deepEqual(Object.keys(fact.data), ['1792184400']);
    const day = fact.data['1792184400'];
    assert.deepEqual(Object.keys(day), QUEUES.map((q) => `GPV${q}`));
    assert.deepEqual(nonYes(day['GPV1.1']), { 11: 'no', 12: 'no' });
    assert.deepEqual(nonYes(day['GPV6.2']), {});
    assert.equal(fact.update, '17.10.2026 18:54');
  });

  test('queue with tomorrow missing has power all day tomorrow', () => {
    const r = responsesFor('17.10.2026', { '1.1': [off('10:00', '12:00')], '2.1': [off('01:00', '02:00')] });
    r['2.1'].push({ eventDate: '18.10.2026', queues: { '2.1': [off('05:00', '06:00')] }, createdAt: '17.10.2026 20:00' });
    const fact = buildFact(r, now);
    const tomorrow = String(kyivMidnightUnix('18.10.2026'));
    assert.deepEqual(Object.keys(fact.data), ['1792184400', tomorrow]);
    assert.deepEqual(nonYes(fact.data[tomorrow]['GPV2.1']), { 6: 'no' });
    assert.deepEqual(nonYes(fact.data[tomorrow]['GPV1.1']), {});
    assert.equal(fact.update, '17.10.2026 20:00');
  });

  test('drops dates older than today, and their stamps do not count for update', () => {
    const r = responsesFor('16.10.2026', { '1.1': [off('10:00', '12:00')] });
    const fact = buildFact(r, now);
    assert.deepEqual(fact.data, {});
    assert.equal(fact.update, null);
    assert.equal(fact.today, 1792184400);
  });

  test('empty responses give empty data and null update', () => {
    const fact = buildFact(responsesFor('17.10.2026', {}), now);
    assert.deepEqual(fact, { data: {}, update: null, today: 1792184400 });
  });

  test('status != 1 is reported with date and queue', () => {
    const warns = [];
    buildFact(responsesFor('17.10.2026', { '3.1': [off('10:00', '12:00', { status: 0 })] }), now, (m) => warns.push(m));
    assert.equal(warns.length, 1);
    assert.match(warns[0], /17\.10\.2026 queue 3\.1: .*status=0/);
  });
});

describe('validateResponse', () => {
  test('accepts valid and empty arrays', () => {
    assert.equal(validateResponse('1.1', []), null);
    assert.equal(validateResponse('1.1', [{ eventDate: '17.10.2026', queues: { '1.1': [] } }]), null);
  });
  test('rejects wrong shapes', () => {
    assert.match(validateResponse('1.1', {}), /not a JSON array/);
    assert.match(validateResponse('1.1', [{ eventDate: '2026-10-17' }]), /invalid eventDate/);
    assert.match(validateResponse('1.1', [{ eventDate: '17.10.2026', queues: { '1.1': {} } }]), /not an array/);
  });
});

describe('preset and hash', () => {
  test('preset has the 12 IF groups and empty data', () => {
    const p = buildPreset('17.10.2026 18:54');
    assert.deepEqual(Object.keys(p.sch_names), QUEUES.map((q) => `GPV${q}`));
    assert.equal(p.sch_names['GPV1.1'], 'Черга 1.1');
    assert.deepEqual(p.data, {});
    assert.equal(p.updateFact, '17.10.2026 18:54');
    assert.deepEqual(p.time_zone['24'], ['23-24', '23:00', '24:00']);
    assert.equal(p.days['7'], 'Неділя');
  });
  test('hash is stable and content-sensitive', () => {
    const f = { data: {}, update: 'x', today: 1 };
    const p = buildPreset('x');
    assert.equal(contentHash(f, p), contentHash(structuredClone(f), structuredClone(p)));
    assert.notEqual(contentHash(f, p), contentHash({ ...f, update: 'y' }, p));
  });
});

describe('change policy', () => {
  const fact = { data: { 1: {} }, update: '17.10.2026 18:54', today: 1 };
  const preset = buildPreset(fact.update);

  test('first success writes', () => {
    const r = applySuccess(null, { fact, preset, nowIso: 't1' });
    assert.equal(r.changed, true);
    assert.equal(r.contentChanged, true);
    assert.equal(r.doc.lastUpdateStatus.ok, true);
    assert.equal(r.doc.lastUpdateStatus.attempt, 1);
    assert.equal(r.doc.meta.contentHash, contentHash(fact, preset));
  });

  test('same hash and previous ok -> no write', () => {
    const first = applySuccess(null, { fact, preset, nowIso: 't1' }).doc;
    const r = applySuccess(first, { fact, preset, nowIso: 't2' });
    assert.equal(r.changed, false);
    assert.equal(r.contentChanged, false);
    assert.equal(r.doc.lastUpdated, 't1');
  });

  test('error keeps data, writes once, then not again with same message', () => {
    const first = applySuccess(null, { fact, preset, nowIso: 't1' }).doc;
    const e1 = applyError(first, { code: 503, message: 'down', nowIso: 't2' });
    assert.equal(e1.changed, true);
    assert.equal(e1.contentChanged, false);
    assert.deepEqual(e1.doc.fact, first.fact);
    assert.equal(e1.doc.lastUpdated, 't1');
    assert.deepEqual(
      { status: e1.doc.lastUpdateStatus.status, ok: e1.doc.lastUpdateStatus.ok, code: e1.doc.lastUpdateStatus.code },
      { status: 'error', ok: false, code: 503 },
    );
    assert.equal(applyError(e1.doc, { code: 503, message: 'down', nowIso: 't3' }).changed, false);
    assert.equal(applyError(e1.doc, { code: 503, message: 'other', nowIso: 't3' }).changed, true);
    // recovery with the same content still writes, because the status changes back to ok
    const ok = applySuccess(e1.doc, { fact, preset, nowIso: 't4' });
    assert.equal(ok.changed, true);
    assert.equal(ok.contentChanged, false);
    assert.equal(ok.doc.lastUpdateStatus.ok, true);
  });

  test('error without previous file writes an empty document', () => {
    const r = applyError(null, { code: 504, message: 'timeout', nowIso: 't1' });
    assert.equal(r.changed, true);
    assert.equal(r.doc.fact, null);
    assert.equal(r.doc.regionId, 'ivano-frankivsk');
  });
});

describe('views', () => {
  test('tomorrow image shows a message when tomorrow has no data', () => {
    const now = Date.UTC(2026, 9, 17, 16, 0);
    const fact = buildFact(responsesFor('17.10.2026', { '1.1': [off('10:00', '12:00')] }), now);
    const views = buildViews({ fact }, now);
    assert.equal(views.length, 14);
    const tomorrow = views.find((v) => v.file === 'gpv-all-tomorrow.png').view;
    assert.equal(tomorrow.message, 'Графік на завтра ще не опубліковано');
    assert.equal(tomorrow.title, 'Графік відключень на: 18.10.2026');
    const today = views.find((v) => v.file === 'gpv-all-today.png').view;
    assert.equal(today.message, null);
    assert.equal(today.rows.length, 12);
    const g = views.find((v) => v.file === 'gpv-1-1.png').view;
    assert.equal(g.rows.length, 1);
    assert.equal(g.rows[0].head, '17.10.2026');
    assert.equal(g.rows[0].sub, 'Сьогодні, субота');
  });
});
