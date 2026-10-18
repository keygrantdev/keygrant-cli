/**
 * Takes a Windows executable's Authenticode signature off, as `signtool remove /s` does: the certificate table at the
 * end of the file goes, and the optional header's security directory and checksum are zeroed. Node's documentation
 * ("Single executable applications") has the signature removed before the blob is injected: Node.js's own signature
 * left in place is corrupted by the injection (postject warns "The signature seems corrupted!"), and signtool then
 * refuses the file as not a valid Win32 application (0x800700C1), so the release could not sign it.
 *
 * Answers the bytes unchanged when the file carries no signature.
 *
 * @param {Buffer} file
 * @returns {Buffer}
 */
export function stripAuthenticode(file) {
  if (file.length < 0x40 || file.toString('latin1', 0, 2) !== 'MZ') throw new Error('not a Windows executable (no MZ header)')
  const pe = file.readUInt32LE(0x3c)
  if (pe + 24 > file.length || file.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('not a Windows executable (no PE header)')
  const optional = pe + 24
  const magic = file.readUInt16LE(optional)
  // The data directories follow the PE32 (0x10b) or PE32+ (0x20b) fields; the security directory is the fifth.
  const directories = { 0x10b: optional + 96, 0x20b: optional + 112 }[magic]
  if (directories === undefined) throw new Error(`not a Windows executable (optional header magic 0x${magic.toString(16)})`)
  const count = file.readUInt32LE(directories - 4)
  if (count < 5) return file
  const security = directories + 4 * 8
  const at = file.readUInt32LE(security)
  const size = file.readUInt32LE(security + 4)
  if (at === 0 && size === 0) return file
  // The table's address is a file offset, and Authenticode puts the table last (padded to eight bytes).
  if (at + size > file.length || file.length - (at + size) >= 8) throw new Error(`the certificate table (${at}, ${size} bytes) is not at the end of the ${file.length}-byte file`)
  const out = Buffer.from(file.subarray(0, at))
  out.writeUInt32LE(0, security)
  out.writeUInt32LE(0, security + 4)
  out.writeUInt32LE(0, optional + 64)
  return out
}
