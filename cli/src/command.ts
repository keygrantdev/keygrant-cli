import { usage, type OptionSpecs, type Parsed } from './args.js'
import type { Context } from './api.js'
import type { ExitCode } from './errors.js'
import { asJson, printableLines } from './output.js'

/** One command: its words (`licenses issue`), its help, the options it takes, and what it does. */
export interface Command {
  name: string
  summary: string
  /** The help after the summary: its synopsis, then its options and what it prints. */
  help: string
  options: OptionSpecs
  run(ctx: Context, args: Parsed): Promise<ExitCode | void>
}

/** Prints for a script (`--json`: the value) or for a person (the text, each line `printable`). */
export function emit(ctx: Context, json: unknown, text: () => string): void {
  ctx.deps.out(ctx.json ? asJson(json) : printableLines(text()))
}

/** The command's positionals, exactly `names.length` of them, else a usage error naming the first missing. */
export function positionals(args: Parsed, ...names: string[]): string[] {
  const given = args.positionals
  if (given.length < names.length) throw usage(`missing ${names[given.length]}`)
  if (given.length > names.length) throw usage(`unexpected argument "${given[names.length]}"`)
  return given
}

/**
 * A license key or another id for a URL path: as typed, path-safe. None at
 * all is refused, and `.` and `..`: a URL reads them as steps up its path, so the request
 * would go to another route than the one named.
 */
export function segment(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') throw usage('a key or an id cannot be empty')
  if (trimmed === '.' || trimmed === '..') throw usage(`"${trimmed}" is not a key or an id`)
  return encodeURIComponent(trimmed)
}
