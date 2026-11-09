const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Wraps a PNG data URL in a single-image ICO container, which Windows shortcuts accept. */
export function profileShortcutIco(dataUrl: string): Buffer | undefined {
  const match = /^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl)
  if (!match) return undefined
  const png = Buffer.from(match[1], 'base64')
  if (png.length < 24 || !png.subarray(0, 8).equals(pngSignature) || png.toString('latin1', 12, 16) !== 'IHDR') return undefined
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
  if (!width || !height || width > 256 || height > 256) return undefined
  const header = Buffer.alloc(22)
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4)
  header.writeUInt8(width === 256 ? 0 : width, 6); header.writeUInt8(height === 256 ? 0 : height, 7)
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18)
  return Buffer.concat([header, png])
}
