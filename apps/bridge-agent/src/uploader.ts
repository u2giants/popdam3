/**
 * DigitalOcean Spaces thumbnail uploader per PROJECT_BIBLE §6.
 *
 * - Uploads to: {bucket}/thumbnails/{asset_id}.jpg
 * - Sets Cache-Control: public, max-age=31536000, immutable
 * - Returns the CDN-backed public URL
 * - Never uses Supabase Storage
 * - Supports hot-reload of S3 client when DO credentials change via heartbeat config sync
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "./config.js";
import { logger } from "./logger.js";

let s3Client: S3Client | null = null;
let currentCredentials = { key: "", secret: "", bucket: "", region: "", endpoint: "" };

function getClient(): S3Client {
  if (!s3Client) {
    currentCredentials = {
      key: config.doSpacesKey,
      secret: config.doSpacesSecret,
      bucket: config.doSpacesBucket,
      region: config.doSpacesRegion,
      endpoint: config.doSpacesEndpoint,
    };
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
 * Re-initialize the S3 client with new credentials from heartbeat config sync.
 * Only recreates if credentials actually changed.
 */
export function reinitializeS3Client(doSpaces: {
  key: string;
  secret: string;
  bucket: string;
  region: string;
  endpoint: string;
}): boolean {
  // Skip if no key provided (empty = use env fallback)
  if (!doSpaces.key || !doSpaces.secret) return false;

  // Check if anything actually changed
  if (
    doSpaces.key === currentCredentials.key &&
    doSpaces.secret === currentCredentials.secret &&
    doSpaces.bucket === currentCredentials.bucket &&
    doSpaces.region === currentCredentials.region &&
    doSpaces.endpoint === currentCredentials.endpoint
  ) {
    return false;
  }

  logger.info("DO Spaces credentials changed — reinitializing S3 client", {
    bucket: doSpaces.bucket,
    region: doSpaces.region,
  });

  currentCredentials = { ...doSpaces };
  s3Client = new S3Client({
    region: doSpaces.region,
    endpoint: doSpaces.endpoint,
    credentials: {
      accessKeyId: doSpaces.key,
      secretAccessKey: doSpaces.secret,
    },
    forcePathStyle: false,
  });

  return true;
}

/** Get the current bucket name (may have been updated via config sync) */
export function getCurrentBucket(): string {
  return currentCredentials.bucket || config.doSpacesBucket;
}

/** Get the current region (may have been updated via config sync) */
export function getCurrentRegion(): string {
  return currentCredentials.region || config.doSpacesRegion;
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
  const bucket = getCurrentBucket();
  const region = getCurrentRegion();

  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
      ACL: "public-read",
    }),
  );

  const url = `https://${bucket}.${region}.digitaloceanspaces.com/${key}`;
  logger.info("Thumbnail uploaded", { assetId, url });
  return url;
}
