// Portable reader for GitHub Actions artifact zips. The orchestrator used to
// shell out to `tar`, which reads zips only where tar is bsdtar (Windows,
// macOS); GNU tar on Linux refuses them, so --complete-work/--complete-outcome
// could not open downloaded proof files on Linux. This reads the central
// directory with node:zlib only, so every platform behaves the same.
import { inflateRawSync } from 'node:zlib'

export class ZipError extends Error {}

function findEndOfCentralDirectory(buffer) {
  const floor = Math.max(0, buffer.length - 22 - 0xffff)
  for (let offset = buffer.length - 22; offset >= floor; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new ZipError('not a zip archive: end of central directory not found')
}

// Returns a Map of entry name -> Buffer for every file entry (directories skipped).
export function readZipEntries(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (buffer.length < 22) throw new ZipError('not a zip archive: too short')
  const eocd = findEndOfCentralDirectory(buffer)
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new ZipError('corrupt zip central directory')
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const size = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    offset += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    if (flags & 1) throw new ZipError(`encrypted zip entry is not supported: ${name}`)
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new ZipError(`zip64 entry is not supported: ${name}`)
    if (entries.has(name)) throw new ZipError(`duplicate zip entry: ${name}`)
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new ZipError(`corrupt zip local header: ${name}`)
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28)
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    if (raw.length !== compressedSize) throw new ZipError(`truncated zip entry: ${name}`)
    let data
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = inflateRawSync(raw)
    else throw new ZipError(`unsupported zip compression method ${method}: ${name}`)
    if (data.length !== size) throw new ZipError(`zip entry size mismatch: ${name}`)
    entries.set(name, data)
  }
  return entries
}
