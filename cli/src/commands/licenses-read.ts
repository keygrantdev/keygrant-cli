import { usage, value, wholeNumber } from '../args.js'
import { answers, request, secretKey } from '../api.js'
import { emit, positionals, segment, type Command } from '../command.js'
import { table, when } from '../output.js'
import { licenseBlock, licenseTable, type License } from './license-view.js'

const STATUSES = ['all', 'active', 'trial', 'expired', 'revoked']

export const get: Command = {
  name: 'licenses get',
  summary: 'Show one license by its key.',
  help: `keygrant licenses get <key>

Prints the license: its model, state, expiry, devices, versions and entitlements.
--json prints the API's answer, { "license": { ... } }.`,
  options: {},
  async run(ctx, args) {
    const [key] = positionals(args, 'the license key')
    const body = await request(ctx, 'GET', `/v1/licenses/${segment(key as string)}`, { key: await secretKey(ctx), expect: answers.license })
    emit(ctx, body, () => licenseBlock(body.license as License, ctx.deps.now()))
  },
}

/** One device a license is active on, as `GET /v1/licenses/:key/activations` answers it (only what the CLI prints is named). */
interface Device {
  id: string
  name?: string | null
  platform?: string | null
  appVersion?: string | null
  lastSeen?: number | null
  createdAt: number
  releaseAt?: number | null
}

export const devices: Command = {
  name: 'licenses devices',
  summary: "List the devices a license is active on, with each one's activation id.",
  help: `keygrant licenses devices <key>

Prints a table of the devices the license is active on, the most recently seen first: each one's
activation id (what licenses free-device takes), its name, platform and app version as the app
reported them (control characters shown as ?), when it last checked in and when it activated, and,
when the key frees unused seats, the time after which the first nightly pass frees its seat unless it
checks in first (FREED AFTER). --json prints the API's answer, { "key", "activations": [ ... ] },
each with the device's fingerprint too.`,
  options: {},
  async run(ctx, args) {
    const [key] = positionals(args, 'the license key')
    const body = await request(ctx, 'GET', `/v1/licenses/${segment(key as string)}/activations`, { key: await secretKey(ctx), expect: answers.devices })
    emit(ctx, body, () => devicesTable(body.activations as Device[]))
  },
}

/** The devices as a table, the FREED AFTER column there when a seat of them may be freed for going unseen. */
function devicesTable(list: readonly Device[]): string {
  if (list.length === 0) return 'No devices: the license is active on none.'
  const freed = list.some((d) => typeof d.releaseAt === 'number')
  return table(
    ['ID', 'NAME', 'PLATFORM', 'APP', 'LAST SEEN', 'ACTIVATED', ...(freed ? ['FREED AFTER'] : [])],
    list.map((d) => [
      d.id,
      d.name ?? '',
      d.platform ?? '',
      d.appVersion ?? '',
      when(d.lastSeen),
      when(d.createdAt),
      ...(freed ? [typeof d.releaseAt === 'number' ? when(d.releaseAt) : ''] : []),
    ]),
  )
}

export const list: Command = {
  name: 'licenses list',
  summary: 'List licenses, newest first: by product, customer or state.',
  help: `keygrant licenses list [--product <id>] [--email <address>] [--status <state>] [--limit <n>] [--cursor <c>] [--all]

  --product <id>      one product's, by its API ID
  --email <address>   one customer's, by their whole address
  --status <state>    all (the default), active, trial, expired or revoked
  --limit <n>         licenses a page, 1 to 100 (25 by default)
  --cursor <c>        the page after the one that printed it
  --all               every page, one after another

Prints a table, and the cursor of the next page when there is one. --json prints the
API's answer, { "licenses": [ ... ], "nextCursor": ... }; with --all, every license and
a nextCursor of null.`,
  options: {
    product: { type: 'value' },
    email: { type: 'value' },
    status: { type: 'value' },
    limit: { type: 'value' },
    cursor: { type: 'value' },
    all: { type: 'flag' },
  },
  async run(ctx, args) {
    positionals(args)
    const status = value(args, 'status')
    if (status !== undefined && !STATUSES.includes(status)) throw usage(`--status must be one of ${STATUSES.join(', ')}`)
    const limit = value(args, 'limit')
    const query = new URLSearchParams()
    for (const name of ['product', 'email', 'status'] as const) {
      const v = value(args, name)
      if (v !== undefined) query.set(name, v)
    }
    if (limit !== undefined) query.set('limit', String(wholeNumber(limit, '--limit', 1, 100)))
    let cursor = value(args, 'cursor') ?? null
    const key = await secretKey(ctx)
    const licenses: License[] = []
    for (;;) {
      if (cursor !== null) query.set('cursor', cursor)
      const qs = query.toString()
      const page = await request(ctx, 'GET', `/v1/licenses${qs ? `?${qs}` : ''}`, { key, expect: answers.page })
      licenses.push(...(page.licenses as License[]))
      cursor = (page.nextCursor as string | null) ?? null
      if (!args.flags.has('all') || cursor === null) break
    }
    emit(ctx, { licenses: licenses, nextCursor: cursor }, () => {
      const shown = licenses.length ? licenseTable(licenses) : 'No licenses.'
      return cursor === null ? shown : `${shown}\n\nMore: --cursor ${cursor} (or --all for every page)`
    })
  },
}

export const checkout: Command = {
  name: 'licenses checkout',
  summary: 'Show the license a Stripe checkout made, by its session id.',
  help: `keygrant licenses checkout <cs_...>

Prints the license a Stripe Checkout Session minted (every key, for a sale of several),
or why there is none: not yet (the webhook that makes it can take a few seconds), or a
checkout that upgraded a key, was held, or was refunded. --json prints the API's answer.`,
  options: {},
  async run(ctx, args) {
    const [session] = positionals(args, 'the Checkout Session id (cs_...)')
    const body = await request(ctx, 'GET', `/v1/checkouts/${segment(session as string)}/license`, { key: await secretKey(ctx), expect: answers.checkout })
    emit(ctx, body, () => {
      const all = (body.licenses as License[] | undefined) ?? [body.license as License]
      return all.length > 1 ? licenseTable(all) : licenseBlock(all[0] as License, ctx.deps.now())
    })
  },
}
