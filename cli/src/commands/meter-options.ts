import { MAX_METER_USES } from '@keygrant/shared'
import { usage, wholeNumber, type Parsed } from '../args.js'

// The meters `licenses issue` gives its key in place of its model's (`--meter`, `--no-meters`), read before anything is sent.

/** One meter an issue gives its key, as the API takes it (`ISSUE_METERS`): its uses, and when given, its period and offline allowance. */
interface IssuedMeter {
  uses: number
  resets?: 'never' | 'period'
  offline?: number | null
}

/** Reads one part after the uses into the meter: `period` or `never` (when it comes back), or `offline=<n|default>`. */
function readPart(meter: IssuedMeter, code: string, part: string): void {
  const word = part.toLowerCase()
  if (word === '') throw usage(`--meter ${code}: an empty part, from a trailing comma`)
  if (/^\d+$/.test(word)) throw usage(`--meter ${code}: "${part}" is part of a number: write 1000, not 1,000`)
  if (word === 'period' || word === 'never') {
    if (meter.resets !== undefined) throw usage(`--meter ${code}: give one of period and never, once`)
    meter.resets = word
    return
  }
  if (!word.startsWith('offline=')) throw usage(`--meter ${code}: "${part}" is not period, never or offline=<n|default>`)
  if (meter.offline !== undefined) throw usage(`--meter ${code}: offline is given twice`)
  const allowance = part.slice('offline='.length).trim()
  meter.offline = allowance.toLowerCase() === 'default' ? null : wholeNumber(allowance, `the offline allowance of --meter ${code}`, 0, MAX_METER_USES)
}

/**
 * One `--meter` as typed: `code=uses`, then any of `period` or `never` (when it comes back) and `offline=<n|default>`,
 * comma separated (`renders=50,period,offline=5`). Every number is read here, so a bad one is a usage error.
 */
function meterOption(text: string): [string, IssuedMeter] {
  const at = text.indexOf('=')
  const code = at < 0 ? '' : text.slice(0, at).trim()
  const [usesText, ...rest] = text.slice(at + 1).split(',').map((part) => part.trim())
  if (!code || !usesText) throw usage(`--meter takes code=uses, then any of period, never and offline=<n|default>, not "${text}"`)
  const meter: IssuedMeter = { uses: wholeNumber(usesText, `the uses of --meter ${code}`, 0, MAX_METER_USES) }
  for (const part of rest) readPart(meter, code, part)
  return [code, meter]
}

/**
 * The meters an issue gives its key in place of its model's, from `--meter`, or none at all for `--no-meters`.
 * Neither leaves the model's.
 */
export function metersOf(args: Parsed): Record<string, IssuedMeter> | undefined {
  const given = args.values.get('meter') ?? []
  if (args.flags.has('no-meters')) {
    if (given.length) throw usage('--meter and --no-meters cannot be given together')
    return {}
  }
  if (!given.length) return undefined
  const pairs = given.map(meterOption)
  const twice = pairs.find(([code], i) => pairs.findIndex(([other]) => other === code) !== i)
  if (twice) throw usage(`--meter ${twice[0]} is given twice`)
  // Own properties, so a code no object takes as one (`__proto__`) still reaches KeyGrant to judge.
  return Object.fromEntries(pairs)
}
