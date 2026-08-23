/**
 * dsh-peak-price-panel — pure pricing/schedule module (no DSH imports).
 *
 * Encodes DeepSeek's peak/off-peak schedule and the current v4 price table
 * (data version 2026-08-23). Kept dependency-free so it is unit-testable in
 * isolation.
 *
 * Schedule (Beijing time, UTC+8):
 *   - peak:     weekdays 09:00–12:00 and 14:00–18:00  (off-peak = 50% of peak)
 *   - off-peak: everything else, including ALL of Saturday and Sunday
 *               (weekend all-off-peak rule, effective 2026-08-23).
 *
 * Prices are the PEAK value per 1M tokens (CNY); off-peak is peak / 2.
 *
 * The schedule and price table are DATA, not code: every pure function accepts
 * optional `windows` / `prices` arguments so the host can feed user-overridden
 * values from settings, falling back to the built-in defaults exported below.
 */

/** Beijing is UTC+8 with no DST; shift wall-clock by this many ms. */
export const BJC_OFFSET_MS = 8 * 3600 * 1000

/** Default peak windows as [startHour, endHour) in Beijing wall-clock hours (weekdays). */
export const DEFAULT_PEAK_WINDOWS = [
  [9, 12],
  [14, 18],
]

/** Default peak (full-price) values per 1M tokens, CNY. Off-peak = value / 2. */
export const DEFAULT_MODEL_PRICES = {
  'deepseek-v4-flash': { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 },
  'deepseek-v4-pro': { cacheHit: 0.30, cacheMiss: 9.0, output: 27.0 },
  'deepseek-v4-flash-vision-exp': { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 },
}

/** Data version stamp shown in the UI; bump when the schedule/price changes. */
export const SCHEDULE_VERSION = '2026-08-23'

// Legacy aliases kept for any importer still referencing the old names.
export const PEAK_WINDOWS = DEFAULT_PEAK_WINDOWS
export const MODEL_PRICES = DEFAULT_MODEL_PRICES

/**
 * Whole days since a `YYYY-MM-DD` version stamp (e.g. SCHEDULE_VERSION).
 * @returns {number|null} null if the stamp is missing or unparseable.
 */
export function daysSinceVersion(version, now = new Date()) {
  if (typeof version !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(version)
  if (!m) return null
  const stamp = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (!Number.isFinite(stamp)) return null
  return Math.floor((now.getTime() - stamp) / 86400000)
}

/** Beijing wall-clock components of an absolute instant, via UTC getters. */
export function beijingParts(now = new Date()) {
  const d = new Date(now.getTime() + BJC_OFFSET_MS)
  return {
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    dayOfWeek: d.getUTCDay(),
  }
}

/** Seconds since Beijing midnight for an absolute instant. */
function beijingSecondOfDay(now = new Date()) {
  const { hour, minute, second } = beijingParts(now)
  return hour * 3600 + minute * 60 + second
}

/** Whether a Beijing day-of-week (0=Sun..6=Sat) is a weekend. */
export function isWeekendDow(dow) {
  return dow === 0 || dow === 6
}

/**
 * Sorted weekday boundary seconds-of-day derived from the peak windows.
 * @returns {Array<{ s: number, toPeak: boolean }>}
 */
export function boundariesOf(windows) {
  const enter = new Set()
  const all = new Set()
  for (const w of windows) {
    if (!Array.isArray(w) || w.length < 2) continue
    const start = Number(w[0]) * 3600
    const end = Number(w[1]) * 3600
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      enter.add(start)
      all.add(start)
      all.add(end)
    }
  }
  return [...all].sort((a, b) => a - b).map((s) => ({ s, toPeak: enter.has(s) }))
}

/** Whether an instant is inside a peak window (weekdays only; weekends are off-peak). */
export function isPeak(now = new Date(), windows = DEFAULT_PEAK_WINDOWS) {
  const { hour, dayOfWeek } = beijingParts(now)
  if (isWeekendDow(dayOfWeek)) return false // weekends are all off-peak (2026-08-23)
  for (const w of windows) {
    if (Array.isArray(w) && w.length >= 2 && hour >= w[0] && hour < w[1]) return true
  }
  return false
}

/** `peak` | `offpeak` for an instant. */
export function currentPeriod(now = new Date(), windows = DEFAULT_PEAK_WINDOWS) {
  return isPeak(now, windows) ? 'peak' : 'offpeak'
}

/**
 * The next peak/off-peak transition, skipping weekends (which have no peak).
 * @returns {{ at: Date, toPeak: boolean, deltaSeconds: number }}
 */
export function nextTransition(now = new Date(), windows = DEFAULT_PEAK_WINDOWS) {
  const start = now.getTime()
  const cur = beijingSecondOfDay(now)
  const startDow = beijingParts(now).dayOfWeek
  const dayMs = 86400000
  const todayMidnight = start - cur * 1000
  const bounds = boundariesOf(windows)
  // Every 7-day span contains a weekday, so at most 8 days ahead finds one.
  for (let d = 0; d <= 8; d++) {
    const dow = (startDow + d) % 7
    if (isWeekendDow(dow)) continue // weekends: all off-peak, no boundary
    const dayStart = todayMidnight + d * dayMs
    for (const b of bounds) {
      const at = dayStart + b.s * 1000
      if (at > start) {
        return {
          at: new Date(at),
          toPeak: b.toPeak,
          deltaSeconds: Math.round((at - start) / 1000),
        }
      }
    }
  }
  throw new Error('unreachable: every 7 days contains a weekday')
}

/**
 * Current-period price for a model.
 * @returns {{ cacheHit: number, cacheMiss: number, output: number }|null}
 */
export function priceFor(model, now = new Date(), prices = DEFAULT_MODEL_PRICES, windows = DEFAULT_PEAK_WINDOWS) {
  const peak = prices && prices[model]
  if (!peak) return null
  const mul = isPeak(now, windows) ? 1 : 0.5
  return {
    cacheHit: round2(peak.cacheHit * mul),
    cacheMiss: round2(peak.cacheMiss * mul),
    output: round2(peak.output * mul),
  }
}

/** Peak and off-peak price for a model, for display. */
export function priceTable(model, prices = DEFAULT_MODEL_PRICES) {
  const peak = prices && prices[model]
  if (!peak) return null
  return {
    cacheHit: { peak: peak.cacheHit, offpeak: round2(peak.cacheHit / 2) },
    cacheMiss: { peak: peak.cacheMiss, offpeak: round2(peak.cacheMiss / 2) },
    output: { peak: peak.output, offpeak: round2(peak.output / 2) },
  }
}

/**
 * Warning for an approaching transition.
 * @returns {{ kind: 'approaching-peak'|'approaching-valley'|null, inSeconds: number }}
 */
export function leadWarning(now, leadSeconds, windows = DEFAULT_PEAK_WINDOWS) {
  const nt = nextTransition(now, windows)
  if (nt.deltaSeconds > leadSeconds) return { kind: null, inSeconds: nt.deltaSeconds }
  const kind = nt.toPeak ? 'approaching-peak' : 'approaching-valley'
  return { kind, inSeconds: nt.deltaSeconds }
}

function round2(n) {
  return Math.round(n * 100) / 100
}
