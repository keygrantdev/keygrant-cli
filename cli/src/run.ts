import { parseArgs, value, type Parsed } from './args.js'
import { apiOrigin, type Context } from './api.js'
import type { Command } from './command.js'
import type { Deps } from './deps.js'
import { CliError, EXIT, type ExitCode } from './errors.js'
import { asJson } from './output.js'
import { VERSION } from './version.js'
import { login, logout } from './commands/auth.js'
import { products, release, testLicense } from './commands/catalog.js'
import { pubkey, verify } from './commands/keys.js'
import { checkout, get, list } from './commands/licenses-read.js'
import { licenseFile } from './commands/licenses-file.js'
import { deviceLimit, extend, freeDevice, issue, revoke, seatRelease, versions } from './commands/licenses-write.js'

/** Every command, in the order the help lists them. */
export const COMMANDS: readonly Command[] = [
  login,
  logout,
  products,
  issue,
  get,
  list,
  checkout,
  licenseFile,
  extend,
  versions,
  deviceLimit,
  seatRelease,
  revoke,
  freeDevice,
  testLicense,
  release,
  pubkey,
  verify,
]

const GROUP = 'licenses'
/** The group in the singular, and as it is spelt outside the US, taken as well. */
const GROUP_ALIASES = new Set([GROUP, 'license', 'licences', 'licence'])

const ENV_HELP = `Environment:
  KEYGRANT_API_KEY   a secret API key (kg_live_... or kg_test_...), used before a kept one
  KEYGRANT_API_URL   KeyGrant's address (https://api.keygrant.dev by default)`

const EXIT_HELP = `Exit codes: 0 done; 1 KeyGrant refused it, a lease or license file is not valid, or it failed otherwise;
2 the command line is wrong, or a file it names cannot be read or written; 3 no API key, or one KeyGrant does not accept; 4 rate limited;
5 KeyGrant could not be reached or failed.`

function mainHelp(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length))
  const lines = COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`)
  return `keygrant ${VERSION}: KeyGrant licensing from a terminal or a build pipeline.

Usage: keygrant <command> [options]

Commands:
${lines.join('\n')}

Every command takes:
  --json             print the answer as JSON, for a script (a command's --help says what)
  --api-url <url>    KeyGrant's address (an https:// URL, or http:// for localhost, 127.0.0.1 or [::1])
  --no-retry         when rate limited, stop at once instead of waiting once and retrying
  -h, --help         the command's own help

${ENV_HELP}

${EXIT_HELP}

Run \`keygrant <command> --help\` for a command's options.`
}

const commandHelp = (c: Command): string => `${c.summary}\n\nUsage: ${c.help}\n\n${EXIT_HELP}`

/** The command `words` name, and the rest of the line; or null when they name none. */
function find(words: readonly string[]): { command: Command; rest: string[] } | null {
  const [first, second] = words
  if (first !== undefined && GROUP_ALIASES.has(first)) {
    const command = COMMANDS.find((c) => c.name === `${GROUP} ${second ?? ''}`)
    return command ? { command, rest: words.slice(2) } : null
  }
  const command = COMMANDS.find((c) => c.name === first)
  return command ? { command, rest: words.slice(1) } : null
}

/** The options given before the command's words (`keygrant --json licenses list`), and where the words start. */
function leadingOptions(argv: readonly string[]): number {
  let at = 0
  while (at < argv.length && (argv[at] as string).startsWith('--')) at += argv[at] === '--api-url' ? 2 : 1
  return at
}

/**
 * What a line that names no command to run asks for: the help, a command's
 * help, or the version; null when it names a command (or none it knows).
 */
function helpAsked(argv: readonly string[], words: readonly string[]): string | null {
  const [first, second] = words
  if (first === undefined) return argv.includes('--version') ? VERSION : mainHelp()
  if (first === '-v' || first === 'version') return VERSION
  if (first === 'help' || first === '-h') {
    const named = find(words.slice(1))
    return named ? commandHelp(named.command) : mainHelp()
  }
  const bareGroup = GROUP_ALIASES.has(first) && (second === undefined || ['help', '--help', '-h'].includes(second))
  return bareGroup ? mainHelp() : null
}

/**
 * Runs one command line: prints what it answers on `deps.out`, what went wrong
 * on `deps.err`, and returns the exit code.
 */
export async function run(argv: readonly string[], deps: Deps): Promise<ExitCode> {
  const lead = leadingOptions(argv)
  const words = argv.slice(lead)
  const help = helpAsked(argv, words)
  if (help !== null) return say(deps, help)
  const found = find(words)
  if (!found) return fail(deps, argv.includes('--json'), notACommand(words))
  let args: Parsed | undefined
  try {
    args = parseArgs([...argv.slice(0, lead), ...found.rest], found.command.options)
    if (args.flags.has('help')) return say(deps, commandHelp(found.command))
    return (await found.command.run(contextOf(deps, args), args)) ?? EXIT.ok
  } catch (error) {
    return fail(deps, args?.flags.has('json') ?? argv.includes('--json'), asCliError(error), found.command)
  }
}

/** Why `words` name no command: the group with no command after it, or words it does not know (named by its words alone, never an option after them). */
function notACommand(words: readonly string[]): CliError {
  const [first, second] = words
  if (GROUP_ALIASES.has(first as string) && (second === undefined || second.startsWith('-'))) {
    return new CliError(EXIT.usage, `${first as string} needs a command: keygrant ${GROUP} <command> [options] (keygrant --help lists them)`)
  }
  const named = words.slice(0, 2).filter((w, i) => i === 0 || !w.startsWith('-'))
  return new CliError(EXIT.usage, `unknown command "${named.join(' ')}": run \`keygrant --help\` for the list`)
}

/** A run's settings, from the options every command takes. */
function contextOf(deps: Deps, args: Parsed): Context {
  return {
    deps,
    json: args.flags.has('json'),
    origin: apiOrigin(value(args, 'api-url') ?? deps.env.KEYGRANT_API_URL),
    retry: !args.flags.has('no-retry'),
  }
}

/** What failed, as the CLI reports it: its own errors as they are, anything else as unexpected. */
function asCliError(error: unknown): CliError {
  if (error instanceof CliError) return error
  const why = error instanceof Error ? error.message : String(error)
  return new CliError(EXIT.refused, `unexpected error: ${why}`, { error: 'unexpected', message: why })
}

function say(deps: Deps, text: string): ExitCode {
  deps.out(text)
  return EXIT.ok
}

function fail(deps: Deps, json: boolean, error: CliError, command?: Command): ExitCode {
  if (json) deps.err(asJson(error.json))
  else deps.err(`keygrant: ${error.message}${error.exit === EXIT.usage && command ? `\nRun \`keygrant ${command.name} --help\`.` : ''}`)
  return error.exit
}
