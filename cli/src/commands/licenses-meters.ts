import { MAX_METER_USES } from '@keygrant/shared'
import { usage, value, wholeNumber, type Parsed } from '../args.js'
import { answers, request, secretKey, type Context } from '../api.js'
import { emit, positionals, segment, type Command } from '../command.js'
import { fields } from '../output.js'
import { licenseBlock, type License } from './license-view.js'
import { idempotencyKeyOf, minting, type Retry } from './licenses-write.js'
import { leftOf, metersTable, n, usesText, type Meter } from './meter-view.js'

/** What a failure of each kind of request that carries a key says it may have done (`minting`). */
const ADDED: Retry = {
  may: 'the uses may have been added all the same',
  rather: 'to get the license as it stands rather than add them again',
  flag: '--idempotency-key',
  field: 'idempotencyKey',
}
const RESET: Retry = {
  may: 'the period may have been reset all the same',
  rather: 'to get the license as it stands rather than reset it again',
  flag: '--idempotency-key',
  field: 'idempotencyKey',
}
const SPENT: Retry = { may: 'the spend may have been made all the same', rather: 'to answer as that spend did rather than spend again', flag: '--id', field: 'id' }

/** The path of a license's meter, from what a person typed: the key and the meter's code, each as a path step. */
function meterPath(licenseKey: string, code: string): string {
  return `/v1/licenses/${segment(licenseKey)}/meters/${segment(code)}`
}

/** The license's own meter of this code, by an own property only (a code is whatever a person types). */
function meterOf(license: License, code: string): Meter | undefined {
  const held = license.meters
  return held !== undefined && Object.hasOwn(held, code) ? held[code] : undefined
}

export const meters: Command = {
  name: 'licenses meters',
  summary: 'Show what a license counts: each meter and its uses left.',
  help: `keygrant licenses meters <key>

Prints the license's meters, one a row: what is left of each, its total (the uses it holds, added
ones included), what is used, what was added on top, the offline allowance a device may spend
while KeyGrant cannot be reached (marked default when the key sets none of its own), when it
resets (never, or each billing period, and where this one ends), and the overage (spent past the
total, which only reports from offline can make) when any meter has some. --json prints the API's
answer, { "license": { ..., "meters": { ... } } }.`,
  options: {},
  async run(ctx, args) {
    const [licenseKey] = positionals(args, 'the license key')
    const body = await request(ctx, 'GET', `/v1/licenses/${segment(licenseKey as string)}`, { key: await secretKey(ctx), expect: answers.license })
    emit(ctx, body, () => {
      const held = (body.license as License).meters ?? {}
      return Object.keys(held).length > 0 ? metersTable(held) : 'No meters.'
    })
  },
}

/** What `licenses uses` does to the meter: one of four. */
type Edit = { kind: 'add'; uses: number } | { kind: 'set'; uses: number } | { kind: 'offline'; offline: number | null } | { kind: 'reset' }

/** The one change asked for, its numbers read before anything is sent. */
function editOf(args: Parsed): Edit {
  const add = value(args, 'add')
  const set = value(args, 'set')
  const offline = value(args, 'offline')
  const reset = args.flags.has('reset')
  if ([add !== undefined, set !== undefined, offline !== undefined, reset].filter(Boolean).length !== 1) {
    throw usage('give one of --add <n>, --set <n>, --offline <n|default> and --reset')
  }
  if (add !== undefined) return { kind: 'add', uses: wholeNumber(add, '--add', 1, MAX_METER_USES) }
  if (set !== undefined) return { kind: 'set', uses: wholeNumber(set, '--set', 0, MAX_METER_USES) }
  if (offline !== undefined) return { kind: 'offline', offline: offline.trim().toLowerCase() === 'default' ? null : wholeNumber(offline, '--offline', 0, MAX_METER_USES) }
  return { kind: 'reset' }
}

/** The license key, the meter's code and, if given, a third argument; any other count is a usage error. */
function keyCodeAndAmount(args: Parsed): [string, string, string | undefined] {
  const given = args.positionals
  if (given.length > 3) throw usage(`unexpected argument "${given[3]}"`)
  const [licenseKey, code] = positionals({ ...args, positionals: given.slice(0, 2) }, 'the license key', 'the meter code')
  return [licenseKey as string, code as string, given[2]]
}

/** Sends the edit; an add and a reset carry the idempotency key the API requires, a set is its own retry. */
async function send(ctx: Context, key: string, base: string, edit: Edit, token: string | undefined): Promise<Record<string, unknown>> {
  const expect = answers.license
  if (edit.kind === 'set') return request(ctx, 'POST', base, { key, body: { uses: edit.uses }, expect })
  if (edit.kind === 'offline') return request(ctx, 'POST', base, { key, body: { offline: edit.offline }, expect })
  if (edit.kind === 'add') {
    return minting(ctx, token, (idempotency) => request(ctx, 'POST', `${base}/add`, { key, body: { uses: edit.uses }, headers: { 'idempotency-key': idempotency }, expect }), ADDED)
  }
  return minting(ctx, token, (idempotency) => request(ctx, 'POST', `${base}/reset`, { key, headers: { 'idempotency-key': idempotency }, expect }), RESET)
}

/** What was done, in a line: what the meter has left after it, when the answer names the meter. */
function done(edit: Edit, code: string, m: Meter | undefined): string {
  const after = m ? `: ${leftOf(m)} left.` : '.'
  if (edit.kind === 'add') return `Added ${usesText(edit.uses)} to ${code}${after}`
  if (edit.kind === 'set') return `Set ${code} to ${usesText(edit.uses)}${after}`
  if (edit.kind === 'reset') return `Reset ${code}, a new period begins${after}`
  if (edit.offline === null) return `Set the offline allowance of ${code} to the default${m ? `, ${n(m.offline)} a device` : ''}.`
  return `Set the offline allowance of ${code} to ${n(edit.offline)} a device.`
}

export const uses: Command = {
  name: 'licenses uses',
  summary: "Change a license's meter: add or set uses, set its offline allowance, or reset it.",
  help: `keygrant licenses uses <key> <meter> (--add <n> | --set <n> | --offline <n|default> | --reset) [--idempotency-key <key>]

  --add <n>               add n uses, 1 to 1,000,000,000, on top of the key's own (a top-up by hand)
  --set <n>               set the key's own uses to n, 0 to 1,000,000,000 (what was added stays); a meter
                          the key lacks, but its product has, is added with them
  --offline <n|default>   the most uses a device may spend while KeyGrant cannot be reached: n, or default
                          (a tenth of the meter's total); on a meter the key holds (--set adds one)
  --reset                 start a new period now, on a meter that comes back each billing period
  --idempotency-key <key> for --add and --reset: the same key on a retry changes nothing twice (one is
                          made for each run otherwise)

Exactly one of the four. A set is its own retry. The app sees a change at its next check-in. Prints what
was done and the license as it now stands; --json prints the API's answer, { "license": { ... } }.`,
  options: {
    add: { type: 'value' },
    set: { type: 'value' },
    offline: { type: 'value' },
    reset: { type: 'flag' },
    'idempotency-key': { type: 'value' },
  },
  async run(ctx, args) {
    const [licenseKey, code] = positionals(args, 'the license key', 'the meter code') as [string, string]
    const token = idempotencyKeyOf(args)
    const edit = editOf(args)
    if (token !== undefined && edit.kind !== 'add' && edit.kind !== 'reset') throw usage('--idempotency-key applies to --add and --reset: --set and --offline can simply be run again')
    const answer = await send(ctx, await secretKey(ctx), meterPath(licenseKey, code), edit, token)
    const license = answer.license as License
    emit(ctx, answer, () => `${done(edit, code, meterOf(license, code))}\n\n${licenseBlock(license, ctx.deps.now())}`)
  },
}

/** A spend id: what the API takes, 16 to 64 letters, digits, hyphens and underscores. */
const SPEND_ID = /^[A-Za-z0-9_-]{16,64}$/

export const use: Command = {
  name: 'licenses use',
  summary: "Spend a license's meter from your backend.",
  help: `keygrant licenses use <key> <meter> [n] [--id <id>]

  n          how many uses to spend, 1 to 1,000,000,000 (1 by default): whole or none
  --id <id>  the spend's id, 16 to 64 letters, digits, hyphens and underscores: the same id on a retry
             answers as the first spend did and spends nothing more (one is made for each run otherwise)

A spend made by your backend, a cloud render the key pays for: your secret API key is the proof, so no
device is asked, and it is exact (used-up, with how many are left, when fewer are). Refused for a revoked
key (license-revoked) and an expired one (license-expired). Prints what it spent, what is left and the
spend's id. --json prints the API's answer, { "meter": { ... } }.`,
  options: { id: { type: 'value' } },
  async run(ctx, args) {
    const [licenseKey, code, amount] = keyCodeAndAmount(args)
    const id = value(args, 'id')
    if (id !== undefined && !SPEND_ID.test(id)) throw usage('--id must be 16 to 64 letters, digits, hyphens and underscores')
    const count = amount === undefined ? 1 : wholeNumber(amount, 'the amount', 1, MAX_METER_USES)
    const key = await secretKey(ctx)
    let spendId: string | undefined = id
    const answer = await minting(
      ctx,
      id,
      (made) => {
        spendId = made
        return request(ctx, 'POST', `${meterPath(licenseKey, code)}/use`, { key, body: { n: count, id: made }, expect: answers.spent })
      },
      SPENT,
    )
    emit(ctx, answer, () =>
      fields([
        ['Spent', `${n(count)} of ${code}`],
        ['Left', leftOf(answer.meter as Meter)],
        ['Spend id', spendId],
      ]),
    )
  },
}
