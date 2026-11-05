import { open } from "node:fs/promises";
import sharp from "sharp";
import { isCompatAlertBuffer } from "./compat-audit";
import { longPath } from "./smb-resolve";

// Adobe saves an original-file preview even when its PDF/PS render fails.
// Read bounded metadata/preview ranges, never the whole artwork.
const WINDOW_BYTES = 512 * 1024;
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_PREVIEW_PIXELS = 16 * 1024 * 1024;
const BINARY_EPS_MAGIC = "\xc5\xd0\xd3\xc6";
type Preview = { buffer: Buffer; width: number; height: number };

async function decodeOriginalPreview(bytes: Buffer, format: "jpeg" | "tiff"): Promise<Preview> {
  const meta = await sharp(bytes, { limitInputPixels: MAX_PREVIEW_PIXELS }).metadata();
  if (meta.format !== format || !meta.width || !meta.height ||
      meta.width * meta.height > MAX_PREVIEW_PIXELS) throw new Error("invalid_embedded_ai_preview");
  const buffer = await sharp(bytes, { limitInputPixels: MAX_PREVIEW_PIXELS })
    .flatten({ background: "#ffffff" })
    .resize(800, 800, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 }).toBuffer();
  const stats = await sharp(buffer).stats();
  // Same conservative blank predicate as the bridge thumbnailer; keep the
  // existing compatibility-notice detector for both original preview formats.
  if (stats.channels.every((channel) => channel.mean > 250 && channel.stdev < 6)) {
    throw new Error("blank_embedded_ai_preview");
  }
  if (await isCompatAlertBuffer(buffer)) throw new Error("compat_alert_embedded_ai_preview");
  const result = await sharp(buffer).metadata();
  return { buffer, width: result.width!, height: result.height! };
}

export async function renderEmbeddedAiPreview(filePath: string): Promise<Preview> {
  const fh = await open(longPath(filePath), "r");
  const windows: string[] = [];
  let contiguous = false;
  let tiff: Buffer | null = null;
  try {
    const { size } = await fh.stat();
    contiguous = size <= 2 * WINDOW_BYTES;
    for (const position of size > WINDOW_BYTES ? [0, Math.max(WINDOW_BYTES, size - WINDOW_BYTES)] : [0]) {
      const bytes = Buffer.alloc(Math.min(WINDOW_BYTES, size - position));
      const { bytesRead } = await fh.read(bytes, 0, bytes.length, position);
      windows.push(bytes.subarray(0, bytesRead).toString("latin1"));
    }
    // DOS binary EPS stores its own TIFF preview range in its fixed header.
    // Validate both the byte budget and actual file boundary before any read.
    if (windows[0]?.startsWith(BINARY_EPS_MAGIC) && windows[0].length >= 30) {
      const header = Buffer.from(windows[0].slice(0, 30), "latin1");
      const offset = header.readUInt32LE(20);
      const length = header.readUInt32LE(24);
      if (offset >= 30 && length > 0 && length <= MAX_PREVIEW_BYTES && offset + length <= size) {
        const bytes = Buffer.alloc(length);
        const { bytesRead } = await fh.read(bytes, 0, length, offset);
        if (bytesRead === length) tiff = bytes;
      }
    }
  } finally {
    await fh.close();
  }
  if (!windows[0]?.startsWith("%PDF-") && !windows[0]?.startsWith("%!PS-Adobe-") &&
      !windows[0]?.startsWith(BINARY_EPS_MAGIC)) throw new Error("no_embedded_ai_preview");

  let lastError = "no_embedded_ai_preview";
  if (tiff) {
    try { return await decodeOriginalPreview(tiff, "tiff"); }
    catch (error) { lastError = (error as Error).message; }
  }
  for (const metadata of contiguous ? [windows.join("")] : windows) {
    const images = metadata.matchAll(/<xmpGImg:image(?:\s[^>]*)?>([\s\S]*?)<\/xmpGImg:image>/g);
    for (const [, image] of images) {
      const encoded = image.replace(/&#(?:x0*[aAdD]|0*(?:10|13));/g, "").replace(/\s+/g, "");
      if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) continue;
      try { return await decodeOriginalPreview(Buffer.from(encoded, "base64"), "jpeg"); }
      catch (error) { lastError = (error as Error).message; }
    }
  }
  throw new Error(lastError);
}

/** Last-resort Photoshop RGB thumbnail, even when later layer data is damaged. */
export async function renderEmbeddedPsdPreview(filePath: string): Promise<Preview> {
  const fh = await open(longPath(filePath), "r");
  let resources: Buffer;
  try {
    const { size } = await fh.stat();
    const header = Buffer.alloc(30);
    if ((await fh.read(header, 0, 30, 0)).bytesRead !== 30 ||
        header.toString("ascii", 0, 4) !== "8BPS" ||
        ![1, 2].includes(header.readUInt16BE(4)) ||
        !header.subarray(6, 12).equals(Buffer.alloc(6))) throw new Error("invalid_embedded_psd_header");
    const offset = 30 + header.readUInt32BE(26);
    if (offset + 4 > size) throw new Error("invalid_embedded_psd_resource_extent");
    const lengthBytes = Buffer.alloc(4);
    if ((await fh.read(lengthBytes, 0, 4, offset)).bytesRead !== 4) throw new Error("invalid_embedded_psd_resource_extent");
    const length = lengthBytes.readUInt32BE();
    if (length > MAX_PREVIEW_BYTES || offset + 4 + length > size) throw new Error("invalid_embedded_psd_resource_extent");
    resources = Buffer.alloc(length);
    if ((await fh.read(resources, 0, length, offset + 4)).bytesRead !== length) throw new Error("invalid_embedded_psd_resource_extent");
  } finally { await fh.close(); }
  let position = 0;
  let lastError = "no_embedded_psd_rgb_preview";
  while (position < resources.length) {
    if (position + 7 > resources.length || resources.toString("ascii", position, position + 4) !== "8BIM") {
      throw new Error("invalid_embedded_psd_resource_identity");
    }
    const id = resources.readUInt16BE(position + 4);
    const nameLength = resources[position + 6];
    position += 6 + Math.ceil((nameLength + 1) / 2) * 2;
    if (position + 4 > resources.length) throw new Error("invalid_embedded_psd_resource_extent");
    const length = resources.readUInt32BE(position); position += 4;
    const end = position + length;
    if (end + length % 2 > resources.length) throw new Error("invalid_embedded_psd_resource_extent");
    // 1033 uses BGR ordering. Do not guess a conversion; only native RGB 1036.
    if (id === 1036 && length >= 28) {
      const thumbnail = resources.subarray(position, end);
      const width = thumbnail.readUInt32BE(4), height = thumbnail.readUInt32BE(8);
      if (thumbnail.readUInt32BE(0) === 1 && width > 0 && height > 0 &&
          width * height <= MAX_PREVIEW_PIXELS && thumbnail.readUInt32BE(20) === length - 28 &&
          thumbnail.readUInt16BE(24) === 24 && thumbnail.readUInt16BE(26) === 1) {
        try {
          const jpeg = thumbnail.subarray(28);
          const metadata = await sharp(jpeg, { limitInputPixels: MAX_PREVIEW_PIXELS }).metadata();
          if (metadata.width !== width || metadata.height !== height) throw new Error("invalid_embedded_psd_preview_dimensions");
          return await decodeOriginalPreview(jpeg, "jpeg");
        } catch (error) { lastError = (error as Error).message; }
      }
    }
    position = end + length % 2;
  }
  throw new Error(lastError);
}
