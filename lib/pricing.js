/**
 * dsh-peak-price-panel — pure pricing/schedule module (no DSH imports).
 *
 * Encodes DeepSeek's peak/off-peak schedule and the current price table
 * (data version 2026-09-10: V4.1-Flash release). Kept dependency-free so it is
 * unit-testable in isolation.
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
  'deepseek-flash': { cacheHit: 0.04, cacheMiss: 2.0, output: 8.0 },
  'deepseek-v4-pro': { cacheHit: 0.30, cacheMiss: 9.0, output: 27.0 },
  // Legacy Flash names: V4-Flash / V4-Flash-Vision-Exp are retired; requests are
  // routed to V4.1-Flash and billed at the Flash rate, so they share Flash prices.
  'deepseek-v4-flash': { cacheHit: 0.04, cacheMiss: 2.0, output: 8.0 },
  'deepseek-v4-flash-vision-exp': { cacheHit: 0.04, cacheMiss: 2.0, output: 8.0 },
}

/** Data version stamp shown in the UI; bump when the schedule/price changes. */
export const SCHEDULE_VERSION = '2026-09-10'

// Legacy aliases kept for any importer still referencing the old names.
export const PEAK_WINDOWS = DEFAULT_PEAK_WINDOWS
export const MODEL_PRICES = DEFAULT_MODEL_PRICES

/**
 * Chinese public holidays (Beijing dates, `YYYY-MM-DD`). DeepSeek bills these as
 * off-peak all day, exactly like weekends — 调休 work-weekends are already covered
 * by the weekend rule, so only holiday dates belong here. Weekends inside a
 * holiday span are listed too, so the array can be audited 1:1 against the notice.
 *
 * Source: 国务院办公厅关于2026年部分节假日安排的通知（国办发明电〔2025〕7号）.
 * UPDATE ANNUALLY — the State Council publishes the next year's notice each
 * November; extend/replace this list then.
 */
export const DEFAULT_HOLIDAYS = [
  '2026-01-01', '2026-01-02', '2026-01-03', // 元旦
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23', // 春节
  '2026-04-04', '2026-04-05', '2026-04-06', // 清明
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', // 劳动节
  '2026-06-19', '2026-06-20', '2026-06-21', // 端午
  '2026-09-25', '2026-09-26', '2026-09-27', // 中秋
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
  '2026-10-06', '2026-10-07', // 国庆
]

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

/** Beijing calendar date (`YYYY-MM-DD`) for an absolute instant. */
export function beijingDate(now = new Date()) {
  const d = new Date(now.getTime() + BJC_OFFSET_MS)
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${m}-${day}`
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
 * Whether an instant falls on an all-off-peak day: a weekend, or a Chinese public
 * holiday. DeepSeek bills both at the off-peak rate regardless of 调休.
 */
export function isOffDay(now = new Date(), holidays = DEFAULT_HOLIDAYS) {
  const { dayOfWeek } = beijingParts(now)
  if (isWeekendDow(dayOfWeek)) return true
  return Array.isArray(holidays) && holidays.includes(beijingDate(now))
}

/** Whether the holiday list has any entry for the Beijing year of `now`. */
export function holidaysCoverYear(holidays, now = new Date()) {
  const year = beijingDate(now).slice(0, 4)
  return Array.isArray(holidays) && holidays.some((h) => typeof h === 'string' && h.startsWith(year))
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

/** Whether an instant is inside a peak window (working weekdays only). */
export function isPeak(now = new Date(), windows = DEFAULT_PEAK_WINDOWS, holidays = DEFAULT_HOLIDAYS) {
  if (isOffDay(now, holidays)) return false // weekends + Chinese public holidays are off-peak
  const { hour } = beijingParts(now)
  for (const w of windows) {
    if (Array.isArray(w) && w.length >= 2 && hour >= w[0] && hour < w[1]) return true
  }
  return false
}

/** `peak` | `offpeak` for an instant. */
export function currentPeriod(now = new Date(), windows = DEFAULT_PEAK_WINDOWS, holidays = DEFAULT_HOLIDAYS) {
  return isPeak(now, windows, holidays) ? 'peak' : 'offpeak'
}

/**
 * The next peak/off-peak transition, skipping weekends (which have no peak).
 * @returns {{ at: Date, toPeak: boolean, deltaSeconds: number }}
 */
export function nextTransition(now = new Date(), windows = DEFAULT_PEAK_WINDOWS, holidays = DEFAULT_HOLIDAYS) {
  const start = now.getTime()
  const cur = beijingSecondOfDay(now)
  const startDow = beijingParts(now).dayOfWeek
  const dayMs = 86400000
  const todayMidnight = start - cur * 1000
  const bounds = boundariesOf(windows)
  const holidaySet = new Set(Array.isArray(holidays) ? holidays : [])
  // Skip off days (weekends + holidays); a Spring-Festival / National-Day stretch
  // can push the next boundary ~10 days out, so scan well past the old 8 days.
  for (let d = 0; d <= 30; d++) {
    const dow = (startDow + d) % 7
    const dayStart = todayMidnight + d * dayMs
    if (isWeekendDow(dow) || holidaySet.has(beijingDate(new Date(dayStart)))) continue
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
  throw new Error('unreachable: no peak boundary within 30 days')
}

/**
 * Current-period price for a model.
 * @returns {{ cacheHit: number, cacheMiss: number, output: number }|null}
 */
export function priceFor(model, now = new Date(), prices = DEFAULT_MODEL_PRICES, windows = DEFAULT_PEAK_WINDOWS, holidays = DEFAULT_HOLIDAYS) {
  const peak = prices && prices[model]
  if (!peak) return null
  const mul = isPeak(now, windows, holidays) ? 1 : 0.5
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
export function leadWarning(now, leadSeconds, windows = DEFAULT_PEAK_WINDOWS, holidays = DEFAULT_HOLIDAYS) {
  const nt = nextTransition(now, windows, holidays)
  if (nt.deltaSeconds > leadSeconds) return { kind: null, inSeconds: nt.deltaSeconds }
  const kind = nt.toPeak ? 'approaching-peak' : 'approaching-valley'
  return { kind, inSeconds: nt.deltaSeconds }
}

function round2(n) {
  return Math.round(n * 100) / 100
}
