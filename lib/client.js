/**
 * dsh-peak-price-panel — browser face.
 *
 * Contributions:
 * 1. A compact status card at the sidebar foot (`sidebar.footer.action`):
 *    peak/off-peak dot + countdown, live balance + tier color, top-up button.
 * 2. A dismissible banner (`shell.overlay`) for approaching peak/valley
 *    price switches. Balance alerts live in the sidebar card (tier color +
 *    pulsing top-up button), not in a separate banner.
 * 3. A settings card (`settings.plugin.item`) for thresholds, refresh rate,
 *    lead time, currency, and the model list.
 *
 * Live data comes from the host route GET /cost-panel/status (polled every
 * 3s); settings ride ctx.settingsScope. No JSX, no bundler, no TS — the lazy
 * CJS bundle protocol.
 */
window.__ModuleLoader__.load({
  id: 'dsh-peak-price-panel/client',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var react = require('react')
    var useSyncExternalStore = react.useSyncExternalStore

    var cssId = 'dsh-peak-price-panel/client'
    var css = [
      '.dscp-card,.dscp-banner{--dscp-amber:#f59e0b}',
      '.dscp-card{display:flex;flex-direction:column;gap:6px;width:100%;box-sizing:border-box;padding:8px 10px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:16px;text-align:left}',
      '.dscp-row{display:flex;align-items:center;gap:8px}',
      '.dscp-dot{width:8px;height:8px;border-radius:50%;flex:none}',
      '.dscp-dot.peak{background:var(--dscp-amber)}',
      '.dscp-dot.offpeak{background:var(--dsw-alias-state-success-primary)}',
      '.dscp-dot.warn{background:var(--dscp-amber)}',
      '.dscp-dot.critical,.dscp-dot.extreme{background:var(--dsw-alias-state-error-primary)}',
      '.dscp-dot.unknown{background:var(--dsw-alias-border-l1)}',
      '.dscp-dot.pulse{animation:dscp-pulse 1.4s ease-in-out infinite}',
      '@keyframes dscp-pulse{0%,100%{opacity:1}50%{opacity:.3}}',
      '.dscp-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}',
      '.dscp-sub{color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dscp-btn{flex:none;font:inherit;font-size:11px;line-height:16px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.dscp-btn.danger{background:var(--dsw-alias-state-error-primary);border-color:transparent;color:#fff;animation:dscp-pulse 1.2s ease-in-out infinite}',
      '.dscp-banner{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483000;max-width:min(520px,calc(100vw - 24px));width:max-content;box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 6px 24px rgba(0,0,0,.18);font-size:13px;line-height:18px}',
      '.dscp-banner.peak{border-color:var(--dscp-amber)}',
      '.dscp-banner.valley{border-color:var(--dsw-alias-state-success-primary)}',
      '.dscp-banner.danger{border-color:var(--dsw-alias-state-error-primary)}',
      '.dscp-banner-close{flex:none;font:inherit;font-size:16px;line-height:1;border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0 2px}',
      '.dscp-field{display:flex;flex-direction:column;gap:4px;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.dscp-field>label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}',
      '.dscp-field input,.dscp-field select,.dscp-field textarea{box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}',
      '.dscp-field textarea{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;resize:vertical;min-height:140px;line-height:1.5}',
      '.dscp-hint{font-size:11px;color:var(--dsw-alias-label-caption)}',
      '.dscp-bal-warn{color:var(--dscp-amber);font-weight:500}',
      '.dscp-bal-critical,.dscp-bal-extreme{color:var(--dsw-alias-state-error-primary);font-weight:600}',
      'div:has(> [data-slot="sidebar.footer.action"]){flex-direction:column !important;gap:6px}',
      '.dscp-price{display:flex;flex-direction:column;gap:3px;margin-left:3px;padding-left:11px;border-left:1px solid var(--dsw-alias-border-l2)}',
      '.dscp-price-head{font-size:11px;color:var(--dsw-alias-label-caption)}',
      '.dscp-price-row{display:flex;align-items:baseline;gap:8px}',
      '.dscp-price-name{flex:1;min-width:0;font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dscp-price-val{flex:none;font-size:11px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.dscp-stale{color:var(--dscp-amber);font-weight:600}',
    ].join('')
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + cssId + '"]') === null) {
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-peak-price-panel'
      tag.dataset.pluginCss = cssId
      tag.textContent = css
      document.head.appendChild(tag)
    }

    function useSettingsSnapshot(scope) {
      var snapshot = useSyncExternalStore(
        function (onChange) { return scope.subscribe(onChange) },
        function () { return scope.getSnapshot() },
      )
      var ready = snapshot.status === 'ready' && snapshot.value !== undefined
      return { value: ready ? snapshot.value : undefined, writable: snapshot.writable === true && ready, ready: ready }
    }

    function useStatus() {
      var state = react.useState(null)
      react.useEffect(function () {
        var alive = true
        var timer
        function tick() {
          fetch('/cost-panel/status')
            .then(function (r) { return r.json() })
            .then(function (d) { if (alive) state[1](d) })
            .catch(function () { if (alive) state[1](null) })
        }
        tick()
        timer = setInterval(tick, 3000)
        return function () { alive = false; clearInterval(timer) }
      }, [])
      return state[0]
    }

    function openTopup() {
      fetch('/cost-panel/open-topup', { method: 'POST' }).catch(function () {})
    }

    var TIER_LABEL = { normal: '余额充足', warn: '余额偏低', critical: '余额告急', extreme: '余额极低', unknown: '余额未知' }

    function money(v, currency) {
      if (v === null || v === undefined || Number.isNaN(v)) return '--'
      var cur = currency === 'USD' ? '$' : '¥'
      return cur + Number(v).toFixed(2)
    }

    function SidebarCard(props) {
      var status = useStatus()
      var period = status && status.period === 'peak' ? 'peak' : 'offpeak'
      var tier = status && status.balance ? status.balance.tier : 'unknown'
      var balance = status && status.balance
      var staleReasons = []
      if (status && status.priceStale === true) staleReasons.push('价格表')
      if (status && status.holidayCovered === false) staleReasons.push('节假日数据')
      var stale = staleReasons.length > 0
      var label = status
        ? (status.period === 'peak' ? '高峰' : '低谷') + ' · ' + status.nextChangeLabel
        : '加载中…'
      var subParts = []
      if (balance && balance.total !== null && balance.total !== undefined) {
        subParts.push('余额 ' + money(balance.total, balance.currency))
      } else if (balance && balance.error === 'no-api-key') {
        subParts.push('未配置 API key')
      } else if (balance && balance.error) {
        subParts.push('余额获取失败')
      }
      if (status && status.lead && status.lead.kind) {
        subParts.push(status.lead.kind === 'approaching-peak' ? '即将涨价' : '即将半价')
      }
      var sub = subParts.join(' · ')
      var priceModels = []
      if (props.wide !== false && status && status.prices && Array.isArray(status.models)) {
        priceModels = status.models.map(function (m) {
          var p = status.prices && status.prices[m]
          if (!p) return null
          return { label: m.replace(/^deepseek-/, ''), output: Number(p.output).toFixed(2) }
        }).filter(Boolean)
      }

      return react.createElement(
        'div',
        { className: 'dscp-card', 'data-cost-panel': true, title: 'DeepSeek 峰谷价与余额' },
        react.createElement(
          'div',
          { className: 'dscp-row' },
          react.createElement('span', { className: 'dscp-dot ' + period }),
          props.wide !== false ? react.createElement('span', { className: 'dscp-label' }, label) : null
        ),
        props.wide !== false && sub
          ? react.createElement('div', { className: 'dscp-row' },
              react.createElement('span', { className: 'dscp-dot ' + (tier === 'extreme' ? 'extreme pulse' : tier) }),
              react.createElement('span', { className: 'dscp-sub' + (tier === 'warn' || tier === 'critical' || tier === 'extreme' ? ' dscp-bal-' + tier : ''), style: { flex: 1 } }, sub),
              react.createElement('button', {
                type: 'button',
                className: 'dscp-btn' + (tier === 'critical' || tier === 'extreme' ? ' danger' : ''),
                onClick: openTopup,
              }, '充值'))
          : null,
        props.wide !== false && priceModels.length
          ? react.createElement(
              'div',
              { className: 'dscp-price' },
              react.createElement('div', { className: 'dscp-price-head' + (stale ? ' dscp-stale' : '') },
                '输出单价' + (stale ? ' · ' + staleReasons.join('/') + '可能过期' : '')),
              priceModels.map(function (pm) {
                return react.createElement('div', { className: 'dscp-price-row', key: pm.label },
                  react.createElement('span', { className: 'dscp-price-name' }, pm.label),
                  react.createElement('span', { className: 'dscp-price-val' }, '¥' + pm.output))
              }))
          : null
      )
    }

    function Banner() {
      var status = useStatus()
      var dismissState = react.useState(null)
      var dismissed = dismissState[0]
      var kind = status && status.lead && status.lead.kind ? status.lead.kind : null

      // Reset the dismissal once the announced switch has passed (kind → null),
      // so the same announcement can fire again on the next cycle instead of
      // staying hidden forever until a page reload.
      react.useEffect(function () {
        if (kind === null && dismissed !== null) dismissState[1](null)
      }, [kind, dismissed])

      // Balance alerts live in the sidebar card (color/graphic), not here:
      // this banner only announces approaching peak/off-peak price switches.
      if (!status) return null
      if (!kind) return null
      if (dismissed === kind) return null

      var approachingPeak = kind === 'approaching-peak'
      var text = approachingPeak
        ? '临近高峰（还有 ' + status.nextChangeLabel + '），价格将翻倍，抓紧或错峰。'
        : '临近低谷（还有 ' + status.nextChangeLabel + '），价格将减半，可稍等再跑。'

      return react.createElement(
        'div',
        { className: 'dscp-banner ' + (approachingPeak ? 'peak' : 'valley'), 'data-cost-panel-banner': true },
        react.createElement('span', { style: { flex: 1 } }, text),
        react.createElement('button', {
          type: 'button',
          className: 'dscp-banner-close',
          'aria-label': '关闭',
          onClick: function () { dismissState[1](kind) },
        }, '×')
      )
    }

    function SettingsCard(props) {
      var state = useSettingsSnapshot(props.scope)
      if (!state.ready) {
        return react.createElement('div', { className: 'dscp-card', 'data-cost-panel-settings': true },
          react.createElement('p', { className: 'dscp-hint' }, '设置加载中…'))
      }
      var value = state.value || {}
      function num(field) {
        return function (event) {
          var raw = event.target.value
          if (raw === '' || raw === null) return // ignore empty (Number('') would write 0)
          var n = Number(raw)
          if (Number.isFinite(n)) {
            props.scope.set(field, n).catch(function (e) { console.error('[dsh-peak-price-panel] save failed:', e) })
          }
        }
      }
      function txt(field, parse) {
        return function (event) {
          var v = parse ? parse(event.target.value) : event.target.value
          props.scope.set(field, v).catch(function (e) { console.error('[dsh-peak-price-panel] save failed:', e) })
        }
      }
      var field = function (labelText, control, key) {
        return react.createElement('div', { className: 'dscp-field', key: key },
          react.createElement('label', null, labelText), control)
      }
      var models = Array.isArray(value.models) ? value.models.join(', ') : 'deepseek-v4-flash'
      return react.createElement(
        'div',
        { className: 'dscp-card', 'data-cost-panel-settings': true },
        field('提醒阈值（¥）', react.createElement('input', { type: 'number', defaultValue: value.warnThreshold, onBlur: num('warnThreshold') }), 'warn'),
        field('告警阈值（¥）', react.createElement('input', { type: 'number', defaultValue: value.criticalThreshold, onBlur: num('criticalThreshold') }), 'critical'),
        field('极低阈值（¥）', react.createElement('input', { type: 'number', defaultValue: value.extremeThreshold, onBlur: num('extremeThreshold') }), 'extreme'),
        field('余额刷新间隔（秒）', react.createElement('input', { type: 'number', defaultValue: value.refreshSeconds, onBlur: num('refreshSeconds') }), 'refresh'),
        field('峰谷提前提示（秒）', react.createElement('input', { type: 'number', defaultValue: value.peakLeadSeconds, onBlur: num('peakLeadSeconds') }), 'lead'),
        field('币种', react.createElement('select', {
          defaultValue: value.currency || 'CNY',
          onChange: txt('currency', function (v) { return v }),
        },
          react.createElement('option', { value: 'CNY' }, 'CNY（人民币）'),
          react.createElement('option', { value: 'USD' }, 'USD（美元）')), 'currency'),
        field('显示模型（逗号分隔，留空=全部）', react.createElement('input', {
          type: 'text',
          defaultValue: models,
          onBlur: txt('models', function (v) { return v.split(',').map(function (s) { return s.trim() }).filter(Boolean) }),
        }), 'models'),
        field('价格表 JSON（覆盖内置单价）', react.createElement('textarea', {
          defaultValue: JSON.stringify(value.prices || {}, null, 2),
          rows: 10,
          onBlur: function (event) {
            var raw = event.target.value
            try {
              var parsed = JSON.parse(raw)
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                props.scope.set('prices', parsed).catch(function (e) { console.error('[dsh-peak-price-panel] save prices failed:', e) })
              } else {
                console.error('[dsh-peak-price-panel] prices must be a JSON object')
              }
            } catch (e) {
              console.error('[dsh-peak-price-panel] invalid prices JSON:', e)
            }
          },
        }), 'prices'),
        react.createElement('p', { className: 'dscp-hint' },
          'API key 从 apiKeyEnv（默认 DEEPSEEK_API_KEY）经 DSH 凭据库解析；价格表/时段是数据配置，DeepSeek 调价时改上面 JSON 或 cordis.patch.yml，无需改代码。')
      )
    }

    function mount(ctx, scope, modern) {
      var settingsSlot = modern ? "settings.plugins.tab" : "settings.plugin.item"
      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'cost-panel',
          order: 20,
        }, function Card(props) {
          return react.createElement(SidebarCard, { wide: props.wide !== false })
        })
      })
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({
          name: 'shell.overlay',
          id: 'cost-panel-banner',
          order: 1000,
        }, function B() { return react.createElement(Banner, null) })
      })
      ctx.slots.inject(settingsSlot, function () {
        return ctx.slots.register({
          name: settingsSlot,
          key: 'cost-panel',
          id: "cost-panel",
          label: "价格与余额",
        }, function S() { return react.createElement(SettingsCard, { scope: scope }) })
      })
    }

    function apply(ctx) {
      ctx.inject(['configForms'], function (child) {
        mount(child, child.configForms.get('cost-panel'), true)
      })
      ctx.inject(['settingsScope'], function (child) {
        mount(child, child.settingsScope.bind({ namespace: 'cost-panel' }), false)
      })
    }

    exports.name = 'cost-panel-ui'
    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
