import {
  LICENSE_FILE_EXTENSION,
  LICENSE_FILE_TYP,
  OPEN_MAJOR,
  licenseFileToken,
  verifyLicenseFile,
  type LicenseFileClaims,
  type VerifyingKey,
} from '@keygrant/shared'
import { entitlementsText, fields, printable, when } from '../output.js'

/**
 * `keygrant verify` of a license file or a key file (sdk-contract.md section
 * 10): read and verified offline by the strict reader in `shared/`, the rules
 * every SDK follows (the container, the header and its kid, the signature by
 * that key alone, the claims), and printed as people read it.
 */

/**
 * What a file's verification comes to: the reader's verdict (a file of another
 * product, when one was asked for, is `wrong-product` with its claims), and the
 * id of the key its header names.
 */
export type FileVerdict =
  | { valid: true; claims: LicenseFileClaims; kid?: string }
  | { valid: false; reason: string; claims?: LicenseFileClaims; kid?: string }

/** A token's header as JSON, or null when it is not. */
function headerOf(token: string): Record<string, unknown> | null {
  try {
    const part = (token.split('.')[0] ?? '').replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(part + '='.repeat((4 - (part.length % 4)) % 4)), (c) => c.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Whether `bytes` are a license file to verify as one, not a lease: the file
 * they were read from is named `.kglicense`, or a token in it says in its
 * header that it is a license file's (`typ`). A lease, or anything else, is not.
 */
export function isLicenseFile(bytes: Uint8Array, path: string | null): boolean {
  if (path !== null && path.toLowerCase().endsWith(LICENSE_FILE_EXTENSION)) return true
  const token = licenseFileToken(bytes)
  if (token !== null) return headerOf(token)?.typ === LICENSE_FILE_TYP
  // A container the strict reader refuses (not UTF-8, two tokens) is a file all the same when a line of it is a
  // license file's token: it is reported as the damaged file it is, not as a lease that does not verify.
  return new TextDecoder().decode(bytes).split('\n').some((line) => headerOf(line.trim())?.typ === LICENSE_FILE_TYP)
}

/**
 * The verdict on a file's bytes against a key set: the container read strictly
 * (valid UTF-8, one token, `#` notes aside), then the token as the SDKs verify it. A file
 * never expires, so there is no time to judge it at. `kid` is the key its
 * header names, whether or not the set holds it.
 */
export async function verifyFileBytes(bytes: Uint8Array, keys: readonly VerifyingKey[]): Promise<FileVerdict> {
  const token = licenseFileToken(bytes)
  if (token === null) return { valid: false, reason: 'malformed' }
  const kid = headerOf(token)?.kid
  return { ...(await verifyLicenseFile(token, keys)), ...(typeof kid === 'string' ? { kid } : {}) }
}

/** Why a file did not verify, in a sentence. */
export const FILE_REASONS: Record<string, string> = {
  malformed: 'it is not a license file (a text file holding one token, and notes on lines starting with #)',
  'not-a-license-file': 'it holds a token, but not a license file\'s (a lease, say)',
  'unknown-key': 'it names a signing key the key set does not hold: update the key set (`keygrant pubkey`); a key that signed a file stays in the set for good',
  'bad-signature': 'its signature is not by the key it names',
  'bad-claims': 'its claims are not a KeyGrant license file\'s',
  'wrong-product': 'it is for another product',
}

/** The versions an offline file covers, as its own notes say them. */
function versionsOf(c: Extract<LicenseFileClaims, { kind: 'offline' }>): string {
  const low = c.minMajor ?? 1
  if (c.major >= OPEN_MAJOR) return low <= 1 ? 'every version' : `${low} and later`
  return low === c.major ? String(c.major) : `${low} to ${c.major}`
}

/** Who a file is licensed to: its name and address as it says them. */
function licensedTo(c: LicenseFileClaims): string {
  return [c.name, c.email !== undefined ? `<${c.email}>` : undefined].filter((part) => part !== undefined).join(' ')
}

/** What a verified file says: its kind, product, licensee, key, versions, entitlements, id and the key that signed it. */
export function fileFields(c: LicenseFileClaims, kid: string | undefined): string {
  const offline = c.kind === 'offline'
  return fields([
    ['Kind', offline ? 'license file (offline, for good)' : 'key file (activates the key online)'],
    ['Product', c.product],
    ['Licensed to', licensedTo(c)],
    ['License key', c.sub],
    ['Versions', offline ? versionsOf(c) : null],
    ['Entitlements', offline ? entitlementsText(c.ent) : null],
    ['File id', c.fid],
    ['Signed by', kid],
    ['Signed', when(c.iat * 1000)],
    ['Test', c.test ? 'yes: a test license' : null],
  ])
}

/** The line a verdict starts with. */
export function fileHead(verdict: FileVerdict): string {
  if (verdict.valid) return verdict.claims.kind === 'key' ? 'Valid key file.' : 'Valid license file.'
  // The key is what these two are about; for the others it is noise.
  // The key id is the file's own, from its unsigned header: shown printable, so a line break in it cannot add a line.
  const named = verdict.kid !== undefined && ['unknown-key', 'bad-signature'].includes(verdict.reason) ? ` It names the signing key ${printable(verdict.kid)}.` : ''
  return `Not valid: ${verdict.reason}: ${FILE_REASONS[verdict.reason] ?? verdict.reason}.${named}`
}
