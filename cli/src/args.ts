import { CliError, EXIT } from './errors.js'

/** One option a command takes: a flag, or a value (repeatable when `many`). */
export interface OptionSpec {
  type: 'flag' | 'value'
  many?: boolean
}

export type OptionSpecs = Record<string, OptionSpec>

/** What a command line holds once read: its positionals, and each option by name. */
export interface Parsed {
  positionals: string[]
  flags: Set<string>
  values: Map<string, string[]>
}

/** Options every command takes. */
export const GLOBAL_OPTIONS: OptionSpecs = {
  json: { type: 'flag' },
  'api-url': { type: 'value' },
  'no-retry': { type: 'flag' },
  help: { type: 'flag' },
}

/**
 * Reads `argv` against the options a command takes: `--name value`,
 * `--name=value`, `--flag`, `-h` for `--help`, and `--` to end the options.
 * An option the command does not take, a value missing, or a value given twice
 * to an option that takes one, is a usage error naming it.
 */
export function parseArgs(argv: readonly string[], specs: OptionSpecs): Parsed {
  const all = { ...GLOBAL_OPTIONS, ...specs }
  const parsed: Parsed = { positionals: [], flags: new Set(), values: new Map() }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (arg === '--') {
      parsed.positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) i += readLong(arg, argv[i + 1], all, parsed)
    else readShort(arg, parsed)
  }
  return parsed
}

/** One argument that is not a long option: `-h`, or a positional (`-` and a negative number among them). */
function readShort(arg: string, parsed: Parsed): void {
  if (arg === '-h') parsed.flags.add('help')
  else if (arg.startsWith('-') && arg !== '-' && !/^-\d/.test(arg)) throw usage(`unknown option ${arg}`)
  else parsed.positionals.push(arg)
}

/** One long option, its value from `--name=value` or the `next` argument: how many arguments past it that took. */
function readLong(arg: string, next: string | undefined, all: OptionSpecs, parsed: Parsed): number {
  const eq = arg.indexOf('=')
  const name = arg.slice(2, eq < 0 ? undefined : eq)
  // Its own options only: never a name every object has (`--constructor`).
  const spec = Object.hasOwn(all, name) ? all[name] : undefined
  if (!spec) throw usage(`unknown option --${name}`)
  if (spec.type === 'flag') {
    if (eq >= 0) throw usage(`--${name} takes no value`)
    parsed.flags.add(name)
    return 0
  }
  const given = eq >= 0 ? arg.slice(eq + 1) : next
  if (given === undefined) throw usage(`--${name} needs a value`)
  const held = parsed.values.get(name) ?? []
  if (held.length > 0 && !spec.many) throw usage(`--${name} is given twice`)
  parsed.values.set(name, [...held, given])
  return eq >= 0 ? 0 : 1
}

/** The one value of an option, or undefined. */
export function value(parsed: Parsed, name: string): string | undefined {
  return parsed.values.get(name)?.[0]
}

/** A whole number from `min` to `max`, read from an option or an argument named `what`. */
export function wholeNumber(text: string, what: string, min: number, max: number): number {
  if (!/^-?\d+$/.test(text.trim())) throw usage(`${what} must be a whole number, not "${text}"`)
  const n = Number(text)
  if (n < min || n > max) throw usage(`${what} must be from ${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')}`)
  return n
}

/** The forms an instant is written in, as the help names them. */
const INSTANT_FORMS = 'a date (2027-01-31), a date and time with its offset (2027-01-31T12:00:00Z) or milliseconds since the epoch (13 digits)'

/**
 * An instant from what a person types: milliseconds since the epoch (13
 * digits), a date (`2027-01-31`, which `endOfDay` makes the last millisecond of
 * that day, UTC, else its first), or a date and time in ISO 8601 with its
 * offset (`Z` or `+02:00`), so a command means the same instant on every
 * machine. Ten digits are seconds, the Unix habit, and refused as such rather
 * than read as a moment in 1970.
 */
export function instant(text: string, what: string, endOfDay: boolean): number {
  const t = text.trim()
  if (/^\d{13}$/.test(t)) return Number(t)
  if (/^\d{10}$/.test(t)) throw usage(`${what} "${text}" looks like seconds since the epoch: give milliseconds (${t}000), or a date`)
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const start = dayStart(t, text, what)
    return endOfDay ? start + 86_400_000 - 1 : start
  }
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(t)) {
    // Its date held to the calendar first: a JavaScript date rolls 30 February on into March.
    dayStart(t.slice(0, 10), text, what)
    const at = Date.parse(t)
    if (!Number.isNaN(at)) return at
  }
  throw usage(`${what} must be ${INSTANT_FORMS}, not "${text}"`)
}

/** The first millisecond, UTC, of the date `day` (`2027-01-31`); a usage error for a date the calendar has not. */
function dayStart(day: string, text: string, what: string): number {
  const start = Date.parse(`${day}T00:00:00.000Z`)
  if (Number.isNaN(start) || new Date(start).toISOString().slice(0, 10) !== day) throw usage(`${what} is not a date: "${text}"`)
  return start
}

/** A usage error: exit 2, with the sentence and a pointer to the help. */
export function usage(message: string): CliError {
  return new CliError(EXIT.usage, message)
}
