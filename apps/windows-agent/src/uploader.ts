/**
 * DigitalOcean Spaces thumbnail uploader for Windows Render Agent.
 * Same logic as bridge-agent uploader — uploads JPG thumbnails.
 * Supports hot-reloading credentials from heartbeat config sync.
 *
 * The S3 client/credentials/upload core lives in
 * packages/agent-common/src/spaces-uploader.ts (#708). The Windows policy is
 * "always-lazy": every config sync adopts the merged credentials and drops
 * the client, which is rebuilt on the next upload (the bridge instead
 * rebuilds only when something changed). Key prefixes below are
 * Windows-specific (style-guide thumbnails use sg-thumbnails/, not the
 * bridge's styleguides/).
 */

import { config } from "./config";
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
  reinitPolicy: "always-lazy",
});

/**
 * Reinitialize the S3 client with new credentials from cloud config.
 * Merges provided values with current credentials (non-empty values win).
 */
export function reinitializeS3Client(doSpaces: {
  key?: string;
  secret?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
}): void {
  uploader.reinitialize(doSpaces);
  logger.info("S3 client credentials updated from cloud config");
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
 * Upload a style-guide page thumbnail to Spaces.
 * Stored under sg-thumbnails/ prefix.
 */
export async function uploadSgThumbnail(
  fileId: string,
  buffer: Buffer,
): Promise<string> {
  const key = `sg-thumbnails/${fileId}.jpg`;
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
