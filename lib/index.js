/**
 * dsh-peak-price-panel — server half (Cordis plugin).
 *
 * Watches DeepSeek peak/off-peak pricing and the account balance, and serves a
 * JSON snapshot to the browser half over a loopback web-server route:
 *
 * - GET  /cost-panel/status   -> snapshot (period, countdown, prices, balance)
 * - POST /cost-panel/refresh  -> force an immediate balance re-fetch
 * - POST /cost-panel/open-topup -> open the top-up page in the default browser
 *
 * The peak/off-peak schedule and price table are DATA, not code: they live in
 * the settings layer (`prices`, `peakWindows`) with built-in defaults from
 * `lib/pricing.js` as a fallback, so a DeepSeek repricing is a config edit
 * (Settings UI or `cordis.patch.yml`), not a code change.
 *
 * Balance is polled from `GET https://api.deepseek.com/user/balance` on a
 * timer (config.refreshSeconds) and cached. The API key is resolved via the
 * DSH credentials service (`ctx.credentials.resolve(apiKeyEnv)`), falling back
 * to the matching process env var.
 *
 * @module dsh-peak-price-panel
 */
import { spawn } from 'node:child_process'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  currentPeriod,
  nextTransition,
  leadWarning,
  priceFor,
  priceTable,
  daysSinceVersion,
  SCHEDULE_VERSION,
  DEFAULT_MODEL_PRICES,
  DEFAULT_PEAK_WINDOWS,
} from './pricing.js'

const name = 'cost-panel'
const inject = ['settings', 'credentials']

const COST_NS = settingsNamespace('cost-panel')

const PriceItem = z.object({
  cacheHit: z.number(),
  cacheMiss: z.number(),
  output: z.number(),
})

const Config = z.object({
  warnThreshold: z.number().default(50),
  criticalThreshold: z.number().default(20),
  extremeThreshold: z.number().default(5),
  refreshSeconds: z.number().default(60),
  peakLeadSeconds: z.number().default(1800),
  currency: z.union([z.const('CNY'), z.const('USD')]).default('CNY'),
  apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
  scheduleVersion: z.string().default(SCHEDULE_VERSION),
  // Days after `scheduleVersion` before the price table is flagged stale.
  staleAfterDays: z.number().default(30),
  // Empty = list every model in the effective price table (all models).
  models: z.array(z.string()).default([]),
  prices: z.dict(PriceItem).default(DEFAULT_MODEL_PRICES),
  peakWindows: z.array(z.tuple([z.number(), z.number()])).default(DEFAULT_PEAK_WINDOWS),
})

const TOPUP_URL = 'https://platform.deepseek.com/top_up'
const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/** Resolve an API key: explicit env var first, then the DSH credentials service. */
async function resolveApiKey(envName, credentials) {
  if (!envName) return undefined
  if (process.env[envName] && process.env[envName].trim()) return process.env[envName].trim()
  if (credentials && typeof credentials.resolve === 'function') {
    try {
      const resolved = await credentials.resolve(envName)
      const value = resolved && typeof resolved.value === 'string' ? resolved.value.trim() : ''
      if (value) return value
    } catch {
      /* credentials unavailable — fall through */
    }
  }
  return undefined
}

/** Effective pricing data, preferring settings overrides over built-in defaults. */
function effectivePricing(config) {
  const prices = config.prices && typeof config.prices === 'object' && Object.keys(config.prices).length
    ? config.prices
    : DEFAULT_MODEL_PRICES
  const windows = Array.isArray(config.peakWindows) && config.peakWindows.length
    ? config.peakWindows
    : DEFAULT_PEAK_WINDOWS
  return { prices, windows }
}

async function fetchBalance(apiKey, currency) {
  const res = await fetch(BALANCE_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`balance API ${res.status}`)
  }
  const body = await res.json()
  const infos = Array.isArray(body.balance_infos) ? body.balance_infos : []
  const info = infos.find((b) => b.currency === currency) || infos[0]
  if (!info) {
    return {
      isAvailable: body.is_available === true,
      total: null,
      granted: null,
      toppedUp: null,
      currency,
    }
  }
  return {
    isAvailable: body.is_available === true,
    total: Number(info.total_balance),
    granted: Number(info.granted_balance),
    toppedUp: Number(info.topped_up_balance),
    currency: info.currency,
  }
}

function tierOf(total, config) {
  if (total === null || total === undefined || Number.isNaN(total)) return 'unknown'
  if (total <= config.extremeThreshold) return 'extreme'
  if (total <= config.criticalThreshold) return 'critical'
  if (total <= config.warnThreshold) return 'warn'
  return 'normal'
}

function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function apply(ctx, config) {
  let balance = undefined // { total, granted, toppedUp, currency, isAvailable, error, fetchedAt }
  let balanceTimer = null
  let disposed = false
  let fetching = null

  const refresh = async () => {
    const apiKey = await resolveApiKey(config.apiKeyEnv, ctx.credentials)
    if (!apiKey) {
      balance = { error: 'no-api-key', fetchedAt: new Date().toISOString() }
      return
    }
    try {
      const data = await fetchBalance(apiKey, config.currency)
      balance = { ...data, error: null, fetchedAt: new Date().toISOString() }
    } catch (error) {
      balance = {
        error: error?.message ? String(error.message) : String(error),
        fetchedAt: new Date().toISOString(),
        total: null,
        granted: null,
        toppedUp: null,
        currency: config.currency,
        isAvailable: false,
      }
    }
  }

  const requestRefresh = () => {
    if (disposed) return Promise.resolve()
    if (fetching !== null) return fetching
    fetching = refresh().finally(() => {
      fetching = null
    })
    return fetching
  }

  const scheduleTimer = () => {
    if (balanceTimer) clearInterval(balanceTimer)
    const sec = Math.max(5, config.refreshSeconds || 60)
    balanceTimer = setInterval(() => {
      void requestRefresh()
    }, sec * 1000)
  }

  const buildSnapshot = () => {
    const now = new Date()
    const { prices: priceData, windows } = effectivePricing(config)
    const period = currentPeriod(now, windows)
    const nt = nextTransition(now, windows)
    const lead = leadWarning(now, config.peakLeadSeconds || 1800, windows)
    const staleAfterDays = config.staleAfterDays || 30
    const priceAgeDays = daysSinceVersion(config.scheduleVersion, now)
    const priceStale = typeof priceAgeDays === 'number' && priceAgeDays > staleAfterDays
    const models = Array.isArray(config.models) && config.models.length
      ? config.models
      : Object.keys(priceData)
    const prices = {}
    const tables = {}
    for (const model of models) {
      prices[model] = priceFor(model, now, priceData, windows)
      tables[model] = priceTable(model, priceData)
    }
    return {
      time: now.toISOString(),
      period,
      periodLabel: period === 'peak' ? '高峰' : '低谷',
      multiplier: period === 'peak' ? 1 : 0.5,
      nextChange: nt.at.toISOString(),
      nextChangeLabel: formatCountdown(nt.deltaSeconds),
      nextIsPeak: nt.toPeak,
      lead,
      scheduleVersion: config.scheduleVersion,
      staleAfterDays,
      priceAgeDays,
      priceStale,
      models,
      prices,
      tables,
      balance: balance
        ? { ...balance, tier: tierOf(balance.total, config) }
        : { error: 'not-fetched', tier: 'unknown' },
    }
  }

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  const openTopup = () => {
    // Open in the user's default browser via the OS, cross-platform.
    try {
      const base = { detached: true, stdio: 'ignore' }
      let child
      if (process.platform === 'win32') {
        child = spawn('cmd', ['/c', 'start', '', TOPUP_URL], { ...base, windowsHide: true })
      } else if (process.platform === 'darwin') {
        child = spawn('open', [TOPUP_URL], base)
      } else {
        child = spawn('xdg-open', [TOPUP_URL], base)
      }
      child.unref()
      return true
    } catch {
      return false
    }
  }

  installSettingsSection(ctx, COST_NS, Config, config, {
    setSource: (current) => {
      // `current` is a source FUNCTION () => scope.get(), not the config object.
      config = current()
      scheduleTimer()
    },
    onChange: () => {
      scheduleTimer()
    },
  })

  // Kick off the first balance fetch and the polling timer.
  void requestRefresh()
  scheduleTimer()

  // Loopback-only status route for the browser half.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scope) => {
      scope.effect(() => scope.webServer.register({
        name: 'cost-panel-status',
        kind: 'exact',
        path: '/cost-panel/status',
        handler: (req, res) => {
          try {
            json(res, 200, buildSnapshot())
          } catch (error) {
            json(res, 500, { error: String(error) })
          }
        },
      }), 'cost-panel: /cost-panel/status route')
      scope.effect(() => scope.webServer.register({
        name: 'cost-panel-refresh',
        kind: 'exact',
        path: '/cost-panel/refresh',
        handler: (req, res) => {
          if (req.method === 'POST') {
            void requestRefresh().then(() => json(res, 200, buildSnapshot()))
            return
          }
          json(res, 405, { error: 'method not allowed' })
        },
      }), 'cost-panel: /cost-panel/refresh route')
      scope.effect(() => scope.webServer.register({
        name: 'cost-panel-open-topup',
        kind: 'exact',
        path: '/cost-panel/open-topup',
        handler: (req, res) => {
          if (req.method === 'POST') {
            json(res, 200, { opened: openTopup(), url: TOPUP_URL })
            return
          }
          json(res, 405, { error: 'method not allowed' })
        },
      }), 'cost-panel: /cost-panel/open-topup route')
    })
  }

  ctx.effect(() => {
    return () => {
      disposed = true
      if (balanceTimer) clearInterval(balanceTimer)
    }
  }, 'cost-panel: cleanup')
}

export { Config, apply, inject, name }
