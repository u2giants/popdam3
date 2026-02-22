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
  // Ensure client is initialized so currentCredentials is populated
  getClient();

  const effectiveKey = doSpaces.key || currentCredentials.key;
  const effectiveSecret = doSpaces.secret || currentCredentials.secret;
  const effectiveBucket = doSpaces.bucket || currentCredentials.bucket;
  const effectiveRegion = doSpaces.region || currentCredentials.region;
  const effectiveEndpoint = doSpaces.endpoint || currentCredentials.endpoint;

  // Check if anything actually changed
  if (
    effectiveKey === currentCredentials.key &&
    effectiveSecret === currentCredentials.secret &&
    effectiveBucket === currentCredentials.bucket &&
    effectiveRegion === currentCredentials.region &&
    effectiveEndpoint === currentCredentials.endpoint
  ) {
    return false;
  }

  logger.info("DO Spaces config changed — reinitializing S3 client", {
    bucket: effectiveBucket,
    region: effectiveRegion,
  });

  currentCredentials = {
    key: effectiveKey,
    secret: effectiveSecret,
    bucket: effectiveBucket,
    region: effectiveRegion,
    endpoint: effectiveEndpoint,
  };
  s3Client = new S3Client({
    region: effectiveRegion,
    endpoint: effectiveEndpoint,
    credentials: {
      accessKeyId: effectiveKey,
      secretAccessKey: effectiveSecret,
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
