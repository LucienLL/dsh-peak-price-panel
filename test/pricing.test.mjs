import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isPeak,
  currentPeriod,
  nextTransition,
  priceFor,
  priceTable,
  leadWarning,
  boundariesOf,
  daysSinceVersion,
  SCHEDULE_VERSION,
} from '../lib/pricing.js'

// Beijing wall-clock via fixed UTC instants (Beijing = UTC+8).
// 2026-08-21 is a Friday; 08-22 Sat, 08-23 Sun, 08-24 Mon.
const bj = (h, m = 0, s = 0) => new Date(Date.UTC(2026, 7, 21, h - 8, m, s))
const bjDay = (day, h, m = 0, s = 0) => new Date(Date.UTC(2026, 7, day, h - 8, m, s))

test('schedule version is stamped', () => {
  assert.equal(typeof SCHEDULE_VERSION, 'string')
  assert.ok(SCHEDULE_VERSION.length > 0)
})

test('peak windows: 09-12 and 14-18 Beijing on weekdays', () => {
  assert.equal(isPeak(bj(10)), true)
  assert.equal(isPeak(bj(11, 59, 59)), true)
  assert.equal(isPeak(bj(12)), false)
  assert.equal(isPeak(bj(13)), false)
  assert.equal(isPeak(bj(14)), true)
  assert.equal(isPeak(bj(17, 59)), true)
  assert.equal(isPeak(bj(18)), false)
  assert.equal(isPeak(bj(20)), false)
  assert.equal(isPeak(bj(3)), false)
})

test('weekends are all off-peak (2026-08-23 rule)', () => {
  assert.equal(isPeak(bjDay(22, 10)), false) // Sat 10:00
  assert.equal(isPeak(bjDay(22, 15)), false) // Sat 15:00
  assert.equal(isPeak(bjDay(23, 10)), false) // Sun 10:00
  assert.equal(isPeak(bjDay(23, 17)), false) // Sun 17:00
  assert.equal(currentPeriod(bjDay(22, 10)), 'offpeak')
})

test('currentPeriod maps to peak/offpeak', () => {
  assert.equal(currentPeriod(bj(10)), 'peak')
  assert.equal(currentPeriod(bj(13)), 'offpeak')
})

test('nextTransition: peak -> 12:00 offpeak', () => {
  const nt = nextTransition(bj(10))
  assert.equal(nt.toPeak, false)
  assert.equal(nt.deltaSeconds, 2 * 3600)
})

test('nextTransition: offpeak -> 14:00 peak', () => {
  const nt = nextTransition(bj(13))
  assert.equal(nt.toPeak, true)
  assert.equal(nt.deltaSeconds, 3600)
})

test('nextTransition: Friday evening skips weekend, rolls to Monday 09:00', () => {
  const nt = nextTransition(bj(20)) // Fri 20:00
  assert.equal(nt.toPeak, true)
  assert.equal(nt.deltaSeconds, 61 * 3600) // 13h to Sat 09:00 + 48h weekend
  assert.equal(nt.at.getUTCDay(), 1) // Monday
})

test('nextTransition: Saturday evening rolls to Monday 09:00', () => {
  const nt = nextTransition(bjDay(22, 20)) // Sat 20:00
  assert.equal(nt.toPeak, true)
  assert.equal(nt.deltaSeconds, 37 * 3600) // Sat 20:00 -> Mon 09:00
})

test('priceFor: peak is full price, offpeak is half', () => {
  assert.deepEqual(priceFor('deepseek-v4-flash', bj(10)), { cacheHit: 0.1, cacheMiss: 3, output: 9 })
  assert.deepEqual(priceFor('deepseek-v4-flash', bj(13)), { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 })
})

test('priceFor: weekend uses off-peak (half) price', () => {
  assert.deepEqual(priceFor('deepseek-v4-flash', bjDay(22, 10)), { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 })
})

test('priceTable: peak is 2x offpeak for every model', () => {
  for (const model of ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp']) {
    const t = priceTable(model)
    assert.equal(t.cacheHit.peak, Math.round(t.cacheHit.offpeak * 2 * 100) / 100)
    assert.equal(t.cacheMiss.peak, Math.round(t.cacheMiss.offpeak * 2 * 100) / 100)
    assert.equal(t.output.peak, Math.round(t.output.offpeak * 2 * 100) / 100)
  }
})

test('leadWarning: approaching peak/valley within lead window', () => {
  assert.equal(leadWarning(bj(8, 30), 1800).kind, 'approaching-peak')
  assert.equal(leadWarning(bj(11, 30), 1800).kind, 'approaching-valley')
  assert.equal(leadWarning(bj(10), 1800).kind, null)
})

test('leadWarning: no false peak warning on weekend morning', () => {
  // Sat 08:30 -> next peak is Mon 09:00 (far away), so no warning.
  assert.equal(leadWarning(bjDay(22, 8, 30), 1800).kind, null)
})

// ── data-decoupling: custom prices / windows are honored ──

test('priceFor: custom price table is used (peak and off-peak)', () => {
  const custom = { 'deepseek-v4-flash': { cacheHit: 1, cacheMiss: 2, output: 3 } }
  assert.deepEqual(priceFor('deepseek-v4-flash', bj(10), custom), { cacheHit: 1, cacheMiss: 2, output: 3 })
  assert.deepEqual(priceFor('deepseek-v4-flash', bj(13), custom), { cacheHit: 0.5, cacheMiss: 1, output: 1.5 })
})

test('priceFor: unknown model in custom table returns null', () => {
  assert.equal(priceFor('does-not-exist', bj(10), { 'deepseek-v4-flash': { cacheHit: 1, cacheMiss: 2, output: 3 } }), null)
})

test('priceTable: custom price table is used', () => {
  const custom = { m: { cacheHit: 1, cacheMiss: 2, output: 3 } }
  assert.deepEqual(priceTable('m', custom), {
    cacheHit: { peak: 1, offpeak: 0.5 },
    cacheMiss: { peak: 2, offpeak: 1 },
    output: { peak: 3, offpeak: 1.5 },
  })
})

test('isPeak: custom windows are honored', () => {
  const windows = [[10, 11]]
  assert.equal(isPeak(bj(10, 30), windows), true)
  assert.equal(isPeak(bj(9, 30), windows), false) // outside custom window
  assert.equal(isPeak(bj(11, 30), windows), false)
})

test('nextTransition: custom windows derive boundaries', () => {
  const windows = [[10, 11]]
  const nt = nextTransition(bj(9), windows) // 09:00 -> 10:00 enter peak
  assert.equal(nt.toPeak, true)
  assert.equal(nt.deltaSeconds, 3600)
})

test('boundariesOf: derives enter/leave from default windows', () => {
  assert.deepEqual(boundariesOf([[9, 12], [14, 18]]), [
    { s: 9 * 3600, toPeak: true },
    { s: 12 * 3600, toPeak: false },
    { s: 14 * 3600, toPeak: true },
    { s: 18 * 3600, toPeak: false },
  ])
})

test('daysSinceVersion: computes whole days since a version stamp', () => {
  const now = new Date(Date.UTC(2026, 8, 22)) // 2026-09-22
  assert.equal(daysSinceVersion('2026-08-23', now), 30)
  assert.equal(daysSinceVersion('2026-09-22', now), 0)
  assert.equal(daysSinceVersion('2026-09-23', now), -1) // future -> negative
  assert.equal(daysSinceVersion('bad', now), null)
  assert.equal(daysSinceVersion(undefined, now), null)
})
