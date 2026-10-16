import type { Meters as LeaseMeters } from '@keygrant/shared'
import { table, when } from '../output.js'

/** A key's meter as the tenant API shows it on a license (integration.md section 19, "A licence"). */
export interface Meter {
  /** The uses its model gave it, or its own. */
  uses: number
  /** Uses added on top: top-ups, a timed model bought again, adds by hand. */
  extra: number
  /** Spent this period, or for good. */
  used: number
  left: number
  /** Spent past what it held, which only reports from offline can make. */
  overage: number
  /** The offline allowance a lease signs now, per device. */
  offline: number
  /** The key's own allowance; null is the default. */
  ownOffline: number | null
  /** `never`, or `period` for a meter that comes back each billing period (a word a newer KeyGrant adds is shown as it is). */
  resets: string
  /** The end of a `period` meter's period, when one is known. */
  periodEnd: number | null
}

/** A license's meters, by code. */
export type Meters = Record<string, Meter>

/** A product meter's setting on a license model, as `GET /v1/products` lists it. */
export interface ModelMeter {
  code: string
  uses: number
  resets: string
  /** The allowance per device; null (or absent) is the default. */
  offline?: number | null
}

/** A product's meter, as `GET /v1/products` lists it. */
export interface ProductMeter {
  code: string
  name: string
}

/** A whole number as people read it: `1,500`. */
export const n = (value: number): string => value.toLocaleString('en-US')

/** The uses a key holds for good or this period. */
const totalOf = (m: Meter): number => m.uses + m.extra

/** How much of a meter is left, of its total: `550 of 1,500`. */
export function leftOf(m: Meter): string {
  return `${n(m.left)} of ${n(totalOf(m))}`
}

/** A number of uses: `1 use`, `1,500 uses`. */
export function usesText(count: number): string {
  return `${n(count)} ${count === 1 ? 'use' : 'uses'}`
}

/** The meters of a license in a line, for its print: `exports 550 of 1,500 left; renders 5 of 5 left (each period)`. Null for none. */
export function metersLine(meters: Meters | undefined): string | null {
  const entries = Object.entries(meters ?? {})
  if (entries.length === 0) return null
  return entries.map(([code, m]) => `${code} ${leftOf(m)} left${m.overage > 0 ? `, ${n(m.overage)} over` : ''}${m.resets === 'period' ? ' (each period)' : ''}`).join('; ')
}

/** When a meter comes back: never, each billing period, and where the period ends when that is known. */
function resetsText(m: Meter): string {
  if (m.resets !== 'period') return m.resets
  return m.periodEnd === null ? 'each period' : `each period, to ${when(m.periodEnd)}`
}

/** A license's meters as a table, one a row; the overage column only when some meter has any. */
export function metersTable(meters: Meters): string {
  const entries = Object.entries(meters)
  const over = entries.some(([, m]) => m.overage > 0)
  const header = ['METER', 'LEFT', 'TOTAL', 'USED', 'ADDED', 'OFFLINE', ...(over ? ['OVER'] : []), 'RESETS']
  const rows = entries.map(([code, m]) => [
    code,
    n(m.left),
    n(totalOf(m)),
    n(m.used),
    n(m.extra),
    `${n(m.offline)}${m.ownOffline === null ? ' (default)' : ''}`,
    ...(over ? [m.overage > 0 ? n(m.overage) : ''] : []),
    resetsText(m),
  ])
  return table(header, rows)
}

/** A model's meters and top-up in a cell, for `products`: `exports 1,000; renders 50 a period (offline 5); +500 exports`. */
export function modelMetersText(meters: readonly ModelMeter[] | undefined, addsUses: Readonly<Record<string, number>> | undefined): string {
  const held = (meters ?? []).map((m) => `${m.code} ${n(m.uses)}${m.resets === 'period' ? ' a period' : ''}${m.offline === null || m.offline === undefined ? '' : ` (offline ${n(m.offline)})`}`)
  const added = Object.entries(addsUses ?? {}).map(([code, uses]) => `+${n(uses)} ${code}`)
  return [...held, ...added].join('; ')
}

/** A product's meters in a line, for `products`: `exports (Exports), renders (Renders)`. Empty for none. */
export function productMetersText(meters: readonly ProductMeter[] | undefined): string {
  return (meters ?? []).map((m) => `${m.code} (${m.name})`).join(', ')
}

/** A lease's meters in a line, for `verify`: `exports 950 of 1,000 left, 100 offline a device; renders 5 of 5 left (each period)`. Null for none. */
export function leaseMetersText(met: LeaseMeters | undefined): string | null {
  const entries = Object.entries(met ?? {})
  if (entries.length === 0) return null
  return entries.map(([code, m]) => `${code} ${n(m.left)} of ${n(m.total)} left, ${n(m.offline)} offline a device${m.resets ? ' (each period)' : ''}`).join('; ')
}
