/**
 * DigitalOcean Spaces thumbnail uploader per PROJECT_BIBLE §6.
 *
 * - Uploads to: {bucket}/thumbnails/{asset_id}.jpg
 * - Sets Cache-Control: public, max-age=31536000, immutable
 * - Returns the CDN-backed public URL
 * - Never uses Supabase Storage
 * - Supports hot-reload of S3 client when DO credentials change via heartbeat config sync
 *
 * The S3 client/credentials/upload core lives in
 * packages/agent-common/src/spaces-uploader.ts (#708). The bridge policy is
 * "eager-if-changed": a config sync that changes nothing is a no-op, and a
 * real change rebuilds the S3Client immediately. The Windows agent uses the
 * same core with an "always-lazy" policy. Key prefixes below are
 * bridge-specific (the Windows agent uses sg-thumbnails/ for style guides).
 */

import { config } from "./config.js";
import { logger } from "./common/logger.js";
import { createSpacesUploader } from "./common/spaces-uploader.js";

const uploader = createSpacesUploader({
  defaults: () => ({
    key: config.doSpacesKey,
    secret: config.doSpacesSecret,
    bucket: config.doSpacesBucket,
    region: config.doSpacesRegion,
    endpoint: config.doSpacesEndpoint,
  }),
  reinitPolicy: "eager-if-changed",
});

/**
 * Re-initialize the S3 client when Spaces config changes via heartbeat.
 * Key/secret are optional — if omitted, preserves existing credentials from .env.
 */
export function reinitializeS3Client(doSpaces: {
  key?: string;
  secret?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
}): boolean {
  const changed = uploader.reinitialize(doSpaces);
  if (changed) {
    logger.info("DO Spaces config changed — reinitializing S3 client", {
      bucket: uploader.getCurrentBucket(),
      region: uploader.getCurrentRegion(),
    });
  }
  return changed;
}

/** Get the current bucket name (may have been updated via config sync) */
export function getCurrentBucket(): string {
  return uploader.getCurrentBucket();
}

/** Get the current region (may have been updated via config sync) */
export function getCurrentRegion(): string {
  return uploader.getCurrentRegion();
}

/**
 * Upload a thumbnail buffer to Spaces.
 * Returns the full public CDN URL.
 */
export async function uploadThumbnail(
  assetId: string,
  buffer: Buffer,
): Promise<string> {
  const key = `thumbnails/${assetId}.jpg`;
  return uploader.uploadToSpaces(key, buffer);
}

/**
 * Upload a sibling image thumbnail to Spaces.
 * Stored under siblings/ prefix to avoid collision with asset thumbnails.
 */
export async function uploadSiblingThumbnail(
  pathHash: string,
  buffer: Buffer,
): Promise<string> {
  const key = `siblings/${pathHash}.jpg`;
  return uploader.uploadToSpaces(key, buffer);
}

/**
 * Upload a style guide thumbnail to Spaces.
 * Stored under styleguides/ prefix to avoid collision with asset thumbnails.
 * pathKey should be a stable hash derived from (root_label + relative_path).
 */
export async function uploadStyleGuideThumbnail(
  pathKey: string,
  buffer: Buffer,
): Promise<string> {
  const key = `styleguides/${pathKey}.jpg`;
  return uploader.uploadToSpaces(key, buffer);
}

/**
 * Upload a PDF page image to Spaces (high-res for AI/OCR).
 * Stored under pdf-pages/ prefix.
 */
export async function uploadPdfPage(
  assetId: string,
  pageNum: number,
  buffer: Buffer,
): Promise<string> {
  const key = `pdf-pages/${assetId}_p${pageNum}.jpg`;
  return uploader.uploadToSpaces(key, buffer);
}
