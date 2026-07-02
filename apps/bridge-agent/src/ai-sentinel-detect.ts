/**
 * Shared detection for ".ai sentinel" files — Illustrator files saved WITHOUT
 * "Create PDF Compatible File", whose embedded PDF holds only Adobe's boilerplate
 * warning page instead of real artwork.
 *
 * This is the single source of truth. It previously lived (and drifted) inline in
 * ai-sentinel-scanner.ts, thumbnailer.ts, pdf-text-sampler.ts and the Windows agent.
 *
 * Why a plain text match is NOT enough
 * ------------------------------------
 * The obvious check — "page-0 text contains 'saved without PDF Content'" — produces
 * false positives on REAL artwork. Many fully PDF-compatible .ai files still carry
 * Adobe's CompatibilityAlert text on page 0 (behind/around the artwork), so the phrase
 * is extractable even though the page clearly renders a picture (seamless patterns,
 * character art, etc.). Flagging those as placeholders would delete real art.
 *
 * So we additionally probe the page's DRAW operations: a genuine placeholder paints
 * only the warning text (≈0 non-text paint ops), while real artwork paints images,
 * gradients, and many vector fills/strokes. When the two disagree we err toward
 * "not a sentinel" — the detector never classifies drawn artwork as a placeholder.
 */

import { readFile, open } from "node:fs/promises";
import * as mupdf from "mupdf";

/** Canonical fragment Adobe writes into the placeholder page's text. */
export const AI_SENTINEL_MARKER = "saved without PDF Content";

/**
 * Max non-text paint operations tolerated on a genuine placeholder page.
 * A true sentinel paints only text (0 ops); we allow a small margin for an
 * optional background rectangle. Real artwork paints far more, so this cleanly
 * separates the two while biasing toward "not a sentinel".
 */
const MAX_SENTINEL_PAINT_OPS = 3;

export interface AiPageInfo {
  /** True only for genuine text-only placeholders (safe to clean up). */
  isSentinel: boolean;
  /** Pure-PostScript .ai (old format, no PDF layer). */
  oldFormat: boolean;
  /** Page count of the embedded PDF (1 for old format, 0 if unreadable). */
  pageCount: number;
  /** Extracted page-0 text ("" for old format / no pages). */
  pageText: string;
}

async function readHead(filePath: string, n = 512): Promise<string> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.slice(0, bytesRead).toString("latin1");
  } finally {
    await fh.close();
  }
}

/**
 * Inspect page 0 of an .ai file and decide whether it is a sentinel.
 *
 * A modern-format file is a sentinel only if BOTH:
 *   1. page-0 text contains the canonical warning marker, AND
 *   2. the page paints no real artwork (no images/gradients, and ≤ a couple of
 *      vector ops for an optional background).
 */
export async function inspectAiPage(filePath: string): Promise<AiPageInfo> {
  const head = await readHead(filePath);

  // Old format: pure PostScript, no PDF layer — always a sentinel.
  if (head.startsWith("%!PS-Adobe-") && !head.includes("%PDF-")) {
    return { isSentinel: true, oldFormat: true, pageCount: 1, pageText: "" };
  }

  // Modern format: PDF-wrapped.
  const fileBuffer = await readFile(filePath);
  const doc = mupdf.Document.openDocument(fileBuffer, "application/pdf");
  const pageCount = doc.countPages();
  if (pageCount === 0) {
    return { isSentinel: false, oldFormat: false, pageCount: 0, pageText: "" };
  }

  const page = doc.loadPage(0);
  const pageText = page.toStructuredText("preserve-whitespace").asText();

  // No marker → definitely real content.
  if (!pageText.includes(AI_SENTINEL_MARKER)) {
    return { isSentinel: false, oldFormat: false, pageCount, pageText };
  }

  // Marker present — distinguish a true placeholder (text only) from real
  // artwork that merely embeds the CompatibilityAlert text. Probe draw ops:
  // any image/gradient, or more than a couple of vector ops, means real art.
  let imageOps = 0;
  let pathOps = 0;
  const probe = new mupdf.Device({
    fillImage() { imageOps++; },
    fillImageMask() { imageOps++; },
    fillShade() { imageOps++; },
    fillPath() { pathOps++; },
    strokePath() { pathOps++; },
  });
  page.run(probe, mupdf.Matrix.identity);

  const isSentinel = imageOps === 0 && pathOps <= MAX_SENTINEL_PAINT_OPS;
  return { isSentinel, oldFormat: false, pageCount, pageText };
}

/** Convenience wrapper: true if the .ai file is a placeholder sentinel. */
export async function isAiSentinel(filePath: string): Promise<boolean> {
  return (await inspectAiPage(filePath)).isSentinel;
}
