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
