/**
 * DigitalOcean Spaces thumbnail uploader for Windows Render Agent.
 * Same logic as bridge-agent uploader — uploads JPG thumbnails.
 * Supports hot-reloading credentials from heartbeat config sync.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "./config";
import { logger } from "./logger";

let s3Client: S3Client | null = null;

// ── Mutable credentials state (updated from heartbeat) ──────────

let currentCredentials = {
  key: config.doSpacesKey,
  secret: config.doSpacesSecret,
  bucket: config.doSpacesBucket,
  region: config.doSpacesRegion,
  endpoint: config.doSpacesEndpoint,
};

function getClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: currentCredentials.region,
      endpoint: currentCredentials.endpoint,
      credentials: {
        accessKeyId: currentCredentials.key,
        secretAccessKey: currentCredentials.secret,
      },
      forcePathStyle: false,
    });
  }
  return s3Client;
}

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
  const effectiveKey = doSpaces.key || currentCredentials.key;
  const effectiveSecret = doSpaces.secret || currentCredentials.secret;
  const effectiveBucket = doSpaces.bucket || currentCredentials.bucket;
  const effectiveRegion = doSpaces.region || currentCredentials.region;
  const effectiveEndpoint = doSpaces.endpoint || currentCredentials.endpoint;

  currentCredentials = {
    key: effectiveKey,
    secret: effectiveSecret,
    bucket: effectiveBucket,
    region: effectiveRegion,
    endpoint: effectiveEndpoint,
  };

  s3Client = null; // force reinit on next upload
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

  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: currentCredentials.bucket,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
      ACL: "public-read",
    }),
  );

  const url = `https://${currentCredentials.bucket}.${currentCredentials.region}.digitaloceanspaces.com/${key}`;
  logger.info("Thumbnail uploaded", { assetId, url });
  return url;
}