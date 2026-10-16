import { DEFAULT_TTL_SECONDS, LICENSE_MODELS } from '@keygrant/shared'
import { entitlementsText, fields, majorsText, table, when } from '../output.js'
import { metersLine, type Meters } from './meter-view.js'

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
  /** Its offline days, null for its type's default; absent from a KeyGrant that predates them, as the two below. */
  leaseDays?: number | null
  graceDays?: number
  /** Days an unused device keeps its seat before the nightly pass frees it; null for never. */
  seatReleaseDays?: number | null
  createdAt: number
  revokedAt: number | null
  revokedReason: string | null
  versions: { minMajor: number; maxMajor: number | null; upgradeUntil: number | null }
  versionRule: string | null
  entitlements: Record<string, unknown>
  /** What it counts, by meter code (`{}` for none); absent from a KeyGrant that predates meters. */
  meters?: Meters
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

/** `1 day`, `30 days`. */
const days = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`

/**
 * How long each of its leases lives offline: its own days, else its type's
 * default (a timed key's lease is a subscription's); nothing from a KeyGrant
 * that does not say.
 */
function offlineDays(l: License): string | null {
  if (l.leaseDays === undefined) return null
  if (l.leaseDays !== null) return days(l.leaseDays)
  const leaseType = l.model === 'timed' ? 'subscription' : l.model
  // A type the lease format does not know reads as perpetual, as the worker reads one; whole days up, as its floor counts them.
  const type = LICENSE_MODELS.find((m) => m === leaseType) ?? 'perpetual'
  return `${days(Math.ceil(DEFAULT_TTL_SECONDS[type] / 86_400))} (its type's default)`
}

/** When an unused device's seat is freed, as the dashboard's Unused seats row says it: `freed after 30 days unseen`, or `kept`. */
function unusedSeats(l: License): string | null {
  if (l.seatReleaseDays === undefined) return null
  return l.seatReleaseDays === null ? 'kept' : `freed after ${days(l.seatReleaseDays)} unseen`
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
    ['Grace', l.graceDays === undefined ? null : l.graceDays ? days(l.graceDays) : 'none'],
    ['Devices', `${l.activeDevices} of ${l.deviceLimit} active${l.seats > 1 ? `, ${l.seats} seats` : ''}`],
    ['Unused seats', unusedSeats(l)],
    ['Offline days', offlineDays(l)],
    ['Versions', l.versionRule ? `bound by its first activation (${l.versionRule.replace('_', ' ')})` : majorsText(l.versions, now)],
    ['Entitlements', entitlementsText(l.entitlements)],
    ['Meters', metersLine(l.meters)],
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
