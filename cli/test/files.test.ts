import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readAll, saveFile } from '../src/files.js'

/** The writer `licenses file` saves with, on the real file system: the CLI's other tests run a fake. */

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keygrant-cli-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

/** The file handle's prototype, to watch what a save does to its handle and in what order. */
async function handlePrototype() {
  const probe = await open(join(dir, 'probe'), 'w')
  const proto = Object.getPrototypeOf(probe) as { chmod: (mode: number) => Promise<void>; writeFile: (...a: unknown[]) => Promise<void> }
  await probe.close()
  return proto
}

describe('saveFile', () => {
  it('tightens a replaced file\'s mode BEFORE the new text is written, so the old mode never holds the license', async () => {
    const proto = await handlePrototype()
    const order: string[] = []
    const chmod = proto.chmod
    const write = proto.writeFile
    vi.spyOn(proto, 'chmod').mockImplementation(function (this: unknown, ...a: [number]) {
      order.push('chmod')
      return chmod.apply(this, a)
    })
    vi.spyOn(proto, 'writeFile').mockImplementation(function (this: unknown, ...a: unknown[]) {
      order.push('write')
      return write.apply(this, a)
    })
    const path = join(dir, 'a.kglicense')
    writeFileSync(path, 'OLD')
    await saveFile(path, 'NEW', true)
    expect(order).toEqual(['chmod', 'write'])
    expect(readFileSync(path, 'utf8')).toBe('NEW')
  })

  it('still saves when the file system cannot set the mode: it is left as it is', async () => {
    const proto = await handlePrototype()
    vi.spyOn(proto, 'chmod').mockRejectedValue(Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }))
    const path = join(dir, 'a.kglicense')
    writeFileSync(path, 'OLD')
    await saveFile(path, 'NEW', true)
    expect(readFileSync(path, 'utf8')).toBe('NEW')
  })

  // A link needs privileges to make on Windows, where the owner is: its rule is the same call's.
  it.skipIf(process.platform === 'win32')('refuses a dangling link without overwrite, and writes nothing through it', async () => {
    const target = join(dir, 'nowhere')
    const link = join(dir, 'a.kglicense')
    symlinkSync(target, link)
    await expect(saveFile(link, 'X', false)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(existsSync(target)).toBe(false)
  })

  it('writes a new file as it is given, UTF-8', async () => {
    const path = join(dir, 'a.kglicense')
    await saveFile(path, '# note \u00e9\nTOKEN\n', false)
    expect(readFileSync(path, 'utf8')).toBe('# note \u00e9\nTOKEN\n')
  })

  it('refuses to replace a file without overwrite, with EEXIST, and leaves it as it was', async () => {
    const path = join(dir, 'a.kglicense')
    writeFileSync(path, 'OLD')
    await expect(saveFile(path, 'NEW', false)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(path, 'utf8')).toBe('OLD')
  })

  it('replaces a file with overwrite', async () => {
    const path = join(dir, 'a.kglicense')
    writeFileSync(path, 'OLD, and longer than the new one')
    await saveFile(path, 'NEW', true)
    expect(readFileSync(path, 'utf8')).toBe('NEW')
  })

  it('says a folder that is not there is an error, whatever overwrite says', async () => {
    await expect(saveFile(join(dir, 'missing', 'a.kglicense'), 'X', true)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(saveFile(join(dir, 'missing', 'a.kglicense'), 'X', false)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  // Windows has no owner-only mode bits: the file takes its folder's permissions there.
  it.skipIf(process.platform === 'win32')('makes a file readable by its owner alone, a replaced world-readable one too', async () => {
    const fresh = join(dir, 'fresh.kglicense')
    await saveFile(fresh, 'X', false)
    expect(statSync(fresh).mode & 0o777).toBe(0o600)
    const old = join(dir, 'old.kglicense')
    writeFileSync(old, 'OLD')
    chmodSync(old, 0o644)
    await saveFile(old, 'NEW', true)
    expect(statSync(old).mode & 0o777).toBe(0o600)
  })
})

describe('readAll', () => {
  it('reads a stream as the bytes it sent, a byte that is not UTF-8 included, whole', async () => {
    const bytes = await readAll(Readable.from([Buffer.from([0x23, 0x20]), Buffer.from([0xff, 0x0a]), Buffer.from('TOKEN\n')]))
    expect([...bytes]).toEqual([0x23, 0x20, 0xff, 0x0a, ...Buffer.from('TOKEN\n')])
  })

  it('reads text chunks as UTF-8, and an empty stream as nothing', async () => {
    expect(new TextDecoder().decode(await readAll(Readable.from(['a\u00e9', 'b'])))).toBe('a\u00e9b')
    expect((await readAll(Readable.from([]))).length).toBe(0)
  })
})
