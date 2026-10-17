import { describe, expect, it } from 'vitest'
import { asJson, fields, printable, printableLines, table } from '../src/output.js'
import { harness, license } from './harness.js'

/**
 * What the CLI prints for people never carries a character a terminal acts on rather than shows (src/output.ts):
 * text others write reaches it (a device's name from an activation, a customer's email). Each range is pinned at
 * both ends, and the characters next to it are kept.
 */

const char = (code: number): string => String.fromCodePoint(code)

describe('printable', () => {
  // Each range's first and last code point, and what lies inside.
  const shown: [string, number][] = [
    ['NUL', 0x00],
    ['tab', 0x09],
    ['line feed', 0x0a],
    ['carriage return', 0x0d],
    ['escape', 0x1b],
    ['unit separator', 0x1f],
    ['DEL', 0x7f],
    ['the first C1 control', 0x80],
    ['CSI', 0x9b],
    ['OSC', 0x9d],
    ['the last C1 control', 0x9f],
    ['Arabic letter mark', 0x061c],
    ['left-to-right mark', 0x200e],
    ['right-to-left mark', 0x200f],
    ['line separator', 0x2028],
    ['paragraph separator', 0x2029],
    ['left-to-right embedding', 0x202a],
    ['right-to-left override', 0x202e],
    ['left-to-right isolate', 0x2066],
    ['pop directional isolate', 0x2069],
  ]
  // The characters around each range, and ordinary text, which a person needs to see as it is.
  const kept: [string, number][] = [
    ['space', 0x20],
    ['tilde', 0x7e],
    ['no-break space', 0xa0],
    ['u with umlaut', 0xfc],
    ['Arabic letter before the mark', 0x061b],
    ['Arabic letter after the mark', 0x061d],
    ['zero width joiner (emoji names)', 0x200d],
    ['hyphen', 0x2010],
    ['the character before the separators', 0x2027],
    ['narrow no-break space', 0x202f],
    ['invisible plus', 0x2064],
    ['the character before the isolates', 0x2065],
    ['inhibit symmetric swapping', 0x206a],
    ['an emoji', 0x1f600],
  ]

  it('shows each control and direction character as ?, at both ends of every range', () => {
    for (const [name, code] of shown) expect([name, printable(`a${char(code)}b`)]).toEqual([name, 'a?b'])
  })

  it('keeps the characters next to each range, and ordinary text, as they are', () => {
    for (const [name, code] of kept) expect([name, printable(`a${char(code)}b`)]).toEqual([name, `a${char(code)}b`])
    expect(printable('José Müller, Studio Mac (2)')).toBe('José Müller, Studio Mac (2)')
  })

  it('keeps a text\'s length, so the tables still line up', () => {
    const name = `x${char(0x1b)}[2A${char(0x202e)}`
    expect(printable(name)).toHaveLength(name.length)
    expect(table(['NAME', 'ID'], [[name, 'act_1'], ['Mac', 'act_2']])).toBe('NAME    ID\nx?[2A?  act_1\nMac     act_2')
  })

  it('makes every line of a text printable and keeps the lines', () => {
    expect(printableLines(`one${char(0x1b)}\ntwo${char(0x9b)}`)).toBe('one?\ntwo?')
    expect(fields([['Name', `a${char(0x0a)}b`]])).toBe('Name  a?b')
  })
})

describe('asJson', () => {
  it('writes the characters JSON leaves raw as escapes, so a script parses the same value and a terminal acts on none', () => {
    const value = { name: `a${char(0x7f)}b${char(0x9b)}c${char(0x2028)}d${char(0x202e)}e${char(0x061c)}f${char(0x1b)}`, plain: 'José' }
    const out = asJson(value)
    for (const code of [0x7f, 0x9b, 0x2028, 0x202e, 0x061c, 0x1b]) expect([code, out.includes(char(code))]).toEqual([code, false])
    expect(JSON.parse(out)).toEqual(value)
    // Indentation and ordinary text are untouched.
    expect(asJson({ a: [1, 'José'] })).toBe('{\n  "a": [\n    1,\n    "José"\n  ]\n}')
  })
})

describe('a license printed in full', () => {
  it('shows a customer-typed email printable', async () => {
    const email = `jo${char(0x1b)}]0;x${char(0x07)}@example.com`
    const res = await harness({ answers: [{ status: 200, body: { license: license({ email }) } }] }).run('licenses', 'get', 'SLUICE-AAAA-BBBB-CCCC-DDDD')
    expect(res.out).toMatch(/^Email {13}jo\?\]0;x\?@example\.com$/m)
    expect(res.out).not.toContain(char(0x1b))
  })
})
