import { open } from 'node:fs/promises'

/**
 * Saves `text` at `path`: a license file is a license, so owner-only, and never
 * over a file already there unless told (without `overwrite` the open
 * rejects, with the error code `EEXIST`, whatever is there, a dangling link
 * included). The mode is for a file made here: one replaced keeps its own, so
 * it is set again BEFORE the new text is written (Windows has no such bits, and
 * a file system with none says so by failing: it is left as it is).
 */
export async function saveFile(path: string, text: string, overwrite: boolean): Promise<void> {
  const handle = await open(path, overwrite ? 'w' : 'wx', 0o600)
  try {
    if (overwrite) await handle.chmod(0o600).catch(() => {})
    await handle.writeFile(text, 'utf8')
  } finally {
    await handle.close()
  }
}

/**
 * A stream's bytes, whole: raw, never decoded here, since a license file is
 * judged by its bytes (valid UTF-8 or not a license file). Standard input is
 * read through this.
 */
export async function readAll(stream: AsyncIterable<Uint8Array | string>): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk))
  return Buffer.concat(chunks)
}
