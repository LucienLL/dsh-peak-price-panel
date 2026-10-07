/** Settings wiring for the installed DSH configuration API. */
import * as settings from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const settingsNamespace = settings.settingsNamespace ?? (name => name)

export function liveConfig(schema) {
  if (settings.installSettingsSection) return schema
  return z.object(Object.fromEntries(Object.entries(schema.dict).map(([key, field]) => [key, field.volatile()])))
}

export const plainConfig = entry => Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, typeof value?.get === 'function' ? value.get() : value]))

export function installSettingsSection(ctx, ns, schema, entry, hooks) {
  if (settings.installSettingsSection) return settings.installSettingsSection(ctx, ns, schema, entry, hooks)
  const read = () => plainConfig(entry)
  hooks.setSource(read)
  ctx.on('loader/volatile-update', () => {
    hooks.setSource(read)
    hooks.onChange()
  })
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
