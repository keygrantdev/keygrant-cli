/** What the commands print for people: tables, a field per line, dates in UTC. */

/** An instant as people read it, in UTC: `2027-01-31 23:59 UTC`; `never` for none. */
export function when(ms: unknown, none = 'never'): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return none
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** A table: a header row, then each row, every column as wide as its widest cell. */
export function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const line = (cells: readonly string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i] ?? 0)))
      .join('  ')
      .trimEnd()
  return [line(header), ...rows.map(line)].join('\n')
}

/** Fields, one per line, the names aligned: `Key       SLUICE-...`. Empty values are left out. */
export function fields(pairs: readonly (readonly [string, string | null | undefined])[]): string {
  const shown = pairs.filter((p): p is readonly [string, string] => p[1] !== null && p[1] !== undefined && p[1] !== '')
  const width = Math.max(...shown.map(([name]) => name.length))
  return shown.map(([name, v]) => `${name.padEnd(width)}  ${v}`).join('\n')
}

/** Entitlements as `edition=pro, seats=5`, or `none`. */
export function entitlementsText(ent: unknown): string {
  if (!ent || typeof ent !== 'object') return 'none'
  const entries = Object.entries(ent as Record<string, unknown>)
  return entries.length ? entries.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ') : 'none'
}

/** A versions range as people read it: `2`, `2 to 4`, `2 and later`, and an upgrade window still open. */
export function majorsText(versions: unknown, now: number): string {
  if (!versions || typeof versions !== 'object') return '?'
  const v = versions as { minMajor?: unknown; maxMajor?: unknown; upgradeUntil?: unknown }
  const min = String(v.minMajor ?? '?')
  const range = v.maxMajor === null ? `${min} and later` : v.maxMajor === v.minMajor ? min : `${min} to ${String(v.maxMajor)}`
  if (typeof v.upgradeUntil === 'number' && v.upgradeUntil > now) return `${range}; every major from ${min} up until ${when(v.upgradeUntil)}`
  return range
}

/** JSON as the commands print it for scripts: two-space indented, one value. */
export const asJson = (value: unknown): string => JSON.stringify(value, null, 2)
