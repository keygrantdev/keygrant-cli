import { describe, expect, it } from 'vitest'
import { instant, parseArgs, wholeNumber } from '../src/args.js'
import { CliError, EXIT } from '../src/errors.js'

const SPECS = { product: { type: 'value' as const }, all: { type: 'flag' as const }, entitlement: { type: 'value' as const, many: true } }

/** The usage error `work` throws, as its sentence; fails when it throws none. */
function usageOf(work: () => unknown): string {
  try {
    work()
  } catch (error) {
    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).exit).toBe(EXIT.usage)
    return (error as CliError).message
  }
  throw new Error('no usage error')
}

describe('reading a command line', () => {
  it('reads values both ways, flags, repeated values, positionals, and everything after --', () => {
    const parsed = parseArgs(['KEY', '--product', 'sluice', '--all', '--entitlement=edition=pro', '--entitlement', 'seats=5', '--', '--not-an-option'], SPECS)
    expect(parsed.positionals).toEqual(['KEY', '--not-an-option'])
    expect([...parsed.flags]).toEqual(['all'])
    expect(parsed.values.get('product')).toEqual(['sluice'])
    expect(parsed.values.get('entitlement')).toEqual(['edition=pro', 'seats=5'])
  })

  it('takes the options every command takes, -h for --help, - for standard input and a negative number as a positional', () => {
    const parsed = parseArgs(['--json', '--api-url', 'http://localhost:4660', '--no-retry', '-h', '-', '-3'], {})
    expect([...parsed.flags].sort()).toEqual(['help', 'json', 'no-retry'])
    expect(parsed.values.get('api-url')).toEqual(['http://localhost:4660'])
    expect(parsed.positionals).toEqual(['-', '-3'])
  })

  it('refuses an option it does not take, a missing value, a value given twice, and a value given to a flag', () => {
    expect(usageOf(() => parseArgs(['--nope'], SPECS))).toBe('unknown option --nope')
    expect(usageOf(() => parseArgs(['-x'], SPECS))).toBe('unknown option -x')
    expect(usageOf(() => parseArgs(['--product'], SPECS))).toBe('--product needs a value')
    expect(usageOf(() => parseArgs(['--product', 'a', '--product=b'], SPECS))).toBe('--product is given twice')
    expect(usageOf(() => parseArgs(['--all=yes'], SPECS))).toBe('--all takes no value')
    for (const inherited of ['--constructor', '--toString', '--__proto__']) expect(usageOf(() => parseArgs([inherited, 'x'], SPECS))).toBe(`unknown option ${inherited}`)
  })
})

describe('reading a number and an instant', () => {
  it('reads a whole number within its bounds, and refuses anything else', () => {
    expect(wholeNumber(' 5 ', '--count', 1, 100)).toBe(5)
    expect(usageOf(() => wholeNumber('2.5', '--count', 1, 100))).toBe('--count must be a whole number, not "2.5"')
    expect(usageOf(() => wholeNumber('101', '--count', 1, 100))).toBe('--count must be from 1 to 100')
    expect(usageOf(() => wholeNumber('5000', '--limit', 1, 1000))).toBe('--limit must be from 1 to 1,000')
  })

  it('reads a date as the end of that day in UTC, or its start, and an ISO time or milliseconds as given', () => {
    expect(instant('2027-01-31', '--to', true)).toBe(Date.UTC(2027, 0, 31, 23, 59, 59, 999))
    expect(instant('2027-01-31', '--at', false)).toBe(Date.UTC(2027, 0, 31))
    expect(instant('2027-01-31T12:00:00Z', '--to', true)).toBe(Date.UTC(2027, 0, 31, 12))
    expect(instant('1790000000000', '--to', true)).toBe(1_790_000_000_000)
    expect(instant('2027-01-31T12:00:00+02:00', '--to', true)).toBe(Date.UTC(2027, 0, 31, 10))
  })

  it('refuses seconds since the epoch, and a time with no offset, which would mean another instant on another machine', () => {
    expect(usageOf(() => instant('1790000000', '--expires', true))).toBe('--expires "1790000000" looks like seconds since the epoch: give milliseconds (1790000000000), or a date')
    expect(usageOf(() => instant('2027-01-31T12:00', '--to', true))).toContain('a date and time with its offset (2027-01-31T12:00:00Z)')
    expect(usageOf(() => instant('17900000000000', '--to', true))).toContain('--to must be')
  })

  it('refuses a date that is not one, and anything that is no instant', () => {
    expect(usageOf(() => instant('2027-02-30', '--to', true))).toBe('--to is not a date: "2027-02-30"')
    expect(usageOf(() => instant('2027-02-30T12:00:00Z', '--to', true))).toBe('--to is not a date: "2027-02-30T12:00:00Z"')
    expect(usageOf(() => instant('2027-02-31T00:00:00+02:00', '--expires', true))).toBe('--expires is not a date: "2027-02-31T00:00:00+02:00"')
    expect(usageOf(() => instant('next week', '--to', true))).toContain('--to must be a date (2027-01-31)')
    expect(usageOf(() => instant('2027-01-31Tnoon', '--to', true))).toContain('--to must be a date')
  })
})
