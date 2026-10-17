/** What the commands print for people: tables, a field per line, dates in UTC. */

/** An instant as people read it, in UTC: `2027-01-31 23:59 UTC`; `never` for none. */
export function when(ms: unknown, none = 'never'): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return none
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/**
 * Control and direction characters a terminal acts on rather than shows: C0 (line breaks and the escape that starts a
 * terminal sequence among them), DEL, C1, the line and paragraph separators, and the bidirectional marks, embeddings,
 * overrides and isolates. Text people other than the tenant write reaches the output (a device's name, platform and
 * app version come from the activation an app sends; a file's header names its signing key unsigned), so a value could
 * otherwise move the cursor, rewrite a row or retitle the window.
 */
const UNPRINTABLE: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x061c, 0x061c],
  [0x200e, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
]

/** Whether a code point is one of `UNPRINTABLE`. */
function unprintable(code: number): boolean {
  return UNPRINTABLE.some(([from, to]) => code >= from && code <= to)
}

/** A value as a terminal may show it: each control or direction character as `?`. */
export function printable(text: string): string {
  return Array.from(text, (ch) => (unprintable(ch.codePointAt(0) ?? 0) ? '?' : ch)).join('')
}

/** Text for people, each line `printable`: what `emit` prints and an error says, whatever a command put in it. */
export function printableLines(text: string): string {
  return text.split('\n').map(printable).join('\n')
}

/** A table: a header row, then each row, every column as wide as its widest cell, every cell `printable`. */
export function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const shown = rows.map((r) => r.map(printable))
  const widths = header.map((h, i) => Math.max(h.length, ...shown.map((r) => (r[i] ?? '').length)))
  const line = (cells: readonly string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i] ?? 0)))
      .join('  ')
      .trimEnd()
  return [line(header), ...shown.map(line)].join('\n')
}

/** Fields, one per line, the names aligned: `Key       SLUICE-...`, every value `printable`. Empty values are left out. */
export function fields(pairs: readonly (readonly [string, string | null | undefined])[]): string {
  const shown = pairs.filter((p): p is readonly [string, string] => p[1] !== null && p[1] !== undefined && p[1] !== '')
  const width = Math.max(...shown.map(([name]) => name.length))
  return shown.map(([name, v]) => `${name.padEnd(width)}  ${printable(v)}`).join('\n')
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

/**
 * JSON as the commands print it for scripts: two-space indented, one value. JSON escapes C0 but leaves DEL, C1, the
 * separators and the direction marks raw, which a terminal may act on: they are written as escapes too, so what a
 * script parses is the same and a terminal is shown nothing it acts on.
 */
export function asJson(value: unknown): string {
  return Array.from(JSON.stringify(value, null, 2), (ch) => {
    const code = ch.codePointAt(0) ?? 0
    return code >= 0x7f && unprintable(code) ? `\\u${code.toString(16).padStart(4, '0')}` : ch
  }).join('')
}
