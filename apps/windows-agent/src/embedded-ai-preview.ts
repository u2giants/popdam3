import { open } from "node:fs/promises";
import sharp from "sharp";
import { isCompatAlertBuffer } from "./compat-audit";
import { longPath } from "./smb-resolve";

// Adobe saves an original-file JPEG preview in XMP even when its PDF page is
// only the compatibility notice. Read bounded metadata, never the whole artwork.
const WINDOW_BYTES = 512 * 1024;
const MAX_PREVIEW_PIXELS = 16 * 1024 * 1024;

export async function renderEmbeddedAiPreview(filePath: string): Promise<{ buffer: Buffer; width: number; height: number }> {
  const fh = await open(longPath(filePath), "r");
  const windows: string[] = [];
  let contiguous = false;
  try {
    const { size } = await fh.stat();
    contiguous = size <= 2 * WINDOW_BYTES;
    for (const position of size > WINDOW_BYTES ? [0, Math.max(WINDOW_BYTES, size - WINDOW_BYTES)] : [0]) {
      const bytes = Buffer.alloc(Math.min(WINDOW_BYTES, size - position));
      const { bytesRead } = await fh.read(bytes, 0, bytes.length, position);
      windows.push(bytes.subarray(0, bytesRead).toString("latin1"));
    }
  } finally {
    await fh.close();
  }
  if (!windows[0]?.startsWith("%PDF-") && !windows[0]?.startsWith("%!PS-Adobe-")) {
    throw new Error("no_embedded_ai_preview");
  }

  let lastError = "no_embedded_ai_preview";
  for (const metadata of contiguous ? [windows.join("")] : windows) {
    const images = metadata.matchAll(/<xmpGImg:image(?:\s[^>]*)?>([\s\S]*?)<\/xmpGImg:image>/g);
    for (const [, image] of images) {
      const encoded = image.replace(/&#(?:x0*[aAdD]|0*(?:10|13));/g, "").replace(/\s+/g, "");
      if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) continue;
      try {
        const bytes = Buffer.from(encoded, "base64");
        // XMP declares JPEG; verify actual content and bounds before pixel decode.
        const meta = await sharp(bytes, { limitInputPixels: MAX_PREVIEW_PIXELS }).metadata();
        if (meta.format !== "jpeg" || !meta.width || !meta.height ||
            meta.width * meta.height > MAX_PREVIEW_PIXELS) throw new Error("invalid_embedded_ai_preview");
        const buffer = await sharp(bytes, { limitInputPixels: MAX_PREVIEW_PIXELS })
          .flatten({ background: "#ffffff" })
          .resize(800, 800, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 }).toBuffer();
        const stats = await sharp(buffer).stats();
        // Same conservative blank predicate as the bridge thumbnailer. Also keep
        // the existing compatibility-notice detector; metadata can contain either.
        if (stats.channels.every((channel) => channel.mean > 250 && channel.stdev < 6)) {
          throw new Error("blank_embedded_ai_preview");
        }
        if (await isCompatAlertBuffer(buffer)) throw new Error("compat_alert_embedded_ai_preview");
        const result = await sharp(buffer).metadata();
        return { buffer, width: result.width!, height: result.height! };
      } catch (error) {
        lastError = (error as Error).message;
      }
    }
  }
  throw new Error(lastError);
}
