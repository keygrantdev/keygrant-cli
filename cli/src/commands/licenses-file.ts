import { LICENSE_FILE_EXTENSION } from '@keygrant/shared'
import { usage, value, type Parsed } from '../args.js'
import { answers, request, secretKey, type Context } from '../api.js'
import { emit, positionals, segment, type Command } from '../command.js'
import { CliError, EXIT } from '../errors.js'
import { fields, when } from '../output.js'

/** A license file as `POST /v1/licenses/:key/file` answers it. */
interface FileAnswer {
  id: string
  kind: 'key' | 'offline'
  kid: string
  issuedAt: number
  signedAt: number
  filename: string
  mediaType: string
  content: string
}

/**
 * A file name KeyGrant may name the file by: the shape it always uses
 * (`<product>-license[-n].kglicense`), so letters, digits, dots, hyphens and
 * underscores, starting with a letter or digit and ending `.kglicense`: a name
 * in the current folder, never a path, a drive, a hidden file, a switch or
 * another kind of file (`package.json`). A name Windows keeps for a device
 * (`con`, `nul`, `com1`) is refused too. What the API sends is not trusted.
 */
const SAFE_NAME = new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]{0,118}${LICENSE_FILE_EXTENSION.replace('.', '\\.')}$`)
const DEVICE_NAME = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i

const KINDS = { key: 'key file (activates the key online)', offline: 'license file (works offline, for good)' } as const

/** Where the file is saved when no `--out` says: its own name in the current folder. */
function defaultPath(name: string): string {
  if (!SAFE_NAME.test(name) || DEVICE_NAME.test(name)) {
    const why = `KeyGrant named the file ${JSON.stringify(name)}, which is not the name of a license file (letters, digits, dots, hyphens and underscores, ending ${LICENSE_FILE_EXTENSION}): give --out <path> to save it where you choose`
    throw new CliError(EXIT.unavailable, why, { error: 'unsafe-file-name', filename: name })
  }
  return name
}

/** Saves the file's text at `path`; a path that is taken is refused unless `force`. */
async function save(ctx: Context, path: string, content: string, force: boolean): Promise<void> {
  try {
    await ctx.deps.writeFile(path, content, force)
  } catch (error) {
    if ((error as { code?: unknown }).code === 'EEXIST') {
      throw new CliError(EXIT.usage, `${path} already exists: use --force to replace it, or --out to save the file elsewhere`, { error: 'file-exists', path })
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new CliError(EXIT.usage, `cannot write ${path}: ${message}`, { error: 'cannot-write', path, message })
  }
}

/**
 * Where the file went: `--out`, else its own name. A refusal here comes after
 * the request, which recorded the download (and, with `--resign`, signed the
 * file again and kept it), so the error says so.
 */
async function saved(ctx: Context, out: string | undefined, filename: string, content: string, args: Parsed): Promise<string> {
  try {
    const path = out ?? defaultPath(filename)
    await save(ctx, path, content, args.flags.has('force'))
    return path
  } catch (error) {
    if (!(error instanceof CliError)) throw error
    const resigned = args.flags.has('resign')
    // An unsafe name from the API comes again on the next run: only --out gets past it.
    const again = error.json.error === 'unsafe-file-name' ? 'without --resign and with --out <path>' : 'without --resign'
    const note = `the download is already in the license's history${resigned ? `, and the file was signed again and kept: run the command again ${again} to save it` : ''}`
    throw new CliError(error.exit, `${error.message} (${note})`, { ...error.json, downloaded: true, ...(resigned ? { resigned: true } : {}) })
  }
}

export const licenseFile: Command = {
  name: 'licenses file',
  summary: "Save a key's license file or key file, signed by KeyGrant.",
  help: `keygrant licenses file <key> [--out <path>] [--force] [--resign]

For a key whose license model delivers a file: a key file carries the key (an app that takes it
activates the key online, as it would a typed one), and a license file licenses the app offline, for
good. Saves the .kglicense file and prints where. It is the file the buyer was emailed: as kept while
the key says the same, else signed again with the current key; each call is in the license's history.

  --out <path>   where to save it; by default its own name (sluice-license.kglicense) in the current folder
  --force        replace a file that is already there; without it the command refuses
  --resign       sign it again with the key that signs now, keeping its id while it grants the same:
                 the remedy after a signing key leaked, and the file must then be sent to the buyer again

Refused: a key delivered typed (not-a-file-license), with no address (no-licensee), revoked
(license-revoked), or an offline file's key that ends (license-expires). On macOS and Linux the file is
saved readable by you alone. --json prints the API's answer with the file's content left out, and the path it was saved to,
{ "file": { "id", "kind", "kid", "issuedAt", "signedAt", "filename", "mediaType", "path" } }.`,
  options: { out: { type: 'value' }, force: { type: 'flag' }, resign: { type: 'flag' } },
  async run(ctx, args) {
    const [key] = positionals(args, 'the license key')
    const out = value(args, 'out')
    if (out !== undefined && out.trim() === '') throw usage('--out needs a path')
    const body = await request(ctx, 'POST', `/v1/licenses/${segment(key as string)}/file`, {
      key: await secretKey(ctx),
      ...(args.flags.has('resign') ? { body: { resign: true } } : {}),
      expect: answers.file,
    })
    const { content, ...file } = body.file as unknown as FileAnswer
    const path = await saved(ctx, out, file.filename, content, args)
    emit(ctx, { file: { ...file, path } }, () =>
      fields([
        ['Saved', path],
        ['Kind', KINDS[file.kind]],
        ['File id', file.id],
        ['Signed by', file.kid],
        ['Signed', when(file.signedAt)],
      ]),
    )
  },
}
