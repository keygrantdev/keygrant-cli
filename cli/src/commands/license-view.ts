import { entitlementsText, fields, majorsText, table, when } from '../output.js'

/** A license as the tenant API answers it (only what the CLI prints is named). */
export interface License {
  key: string
  product: string
  model: string
  modelId: string | null
  modelName: string | null
  status: string
  kind: string
  test: boolean
  email: string | null
  expiresAt: number | null
  term?: { months: number; days: number } | null
  validUntil: number | null
  deviceLimit: number
  activeDevices: number
  seats: number
  createdAt: number
  revokedAt: number | null
  revokedReason: string | null
  versions: { minMajor: number; maxMajor: number | null; upgradeUntil: number | null }
  versionRule: string | null
  entitlements: Record<string, unknown>
  sale?: { id: string; index: number; size: number }
}

/** A term a timed key waits with: `12 months`, `30 days`, `1 month and 15 days`. */
export function termText(term: { months: number; days: number }): string {
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  const parts = [term.months ? part(term.months, 'month') : '', term.days ? part(term.days, 'day') : ''].filter(Boolean)
  return parts.join(' and ') || '0 days'
}

/** When it ends, as people read it, a timed key waiting for its first use included. */
function ends(l: License): string {
  if (l.expiresAt === null && l.term) return `${termText(l.term)} from its first activation`
  return when(l.expiresAt)
}

/** What it is now: its kind, and why when it was revoked or cancelled; marked when it is a test license. */
function state(l: License): string {
  const why = l.revokedReason ? ` (${l.revokedReason.replace(/_/g, ' ')})` : ''
  return `${l.kind}${why}${l.test ? ', test license' : ''}`
}

/** One license, a field per line. */
export function licenseBlock(l: License, now: number): string {
  const model = l.modelName ? `${l.modelName} (${l.model}, ${l.modelId})` : l.model
  return fields([
    ['Key', l.key],
    ['Product', l.product],
    ['Model', model],
    ['State', state(l)],
    ['Email', l.email],
    ['Expires', ends(l)],
    ['Valid until', l.validUntil === l.expiresAt ? null : when(l.validUntil)],
    ['Devices', `${l.activeDevices} of ${l.deviceLimit} active${l.seats > 1 ? `, ${l.seats} seats` : ''}`],
    ['Versions', l.versionRule ? `bound by its first activation (${l.versionRule.replace('_', ' ')})` : majorsText(l.versions, now)],
    ['Entitlements', entitlementsText(l.entitlements)],
    ['Sale', l.sale ? `key ${l.sale.index} of ${l.sale.size} (${l.sale.id})` : null],
    ['Created', when(l.createdAt)],
    ['Revoked', l.revokedAt ? when(l.revokedAt) : null],
  ])
}

/** Licenses as a table, one a row. */
export function licenseTable(licenses: readonly License[]): string {
  return table(
    ['KEY', 'PRODUCT', 'MODEL', 'STATE', 'EXPIRES', 'DEVICES', 'EMAIL'],
    licenses.map((l) => [l.key, l.product, l.modelName ?? l.model, state(l), ends(l), `${l.activeDevices}/${l.deviceLimit}`, l.email ?? '']),
  )
}
