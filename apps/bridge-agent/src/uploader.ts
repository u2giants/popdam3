/**
 * DigitalOcean Spaces thumbnail uploader per PROJECT_BIBLE §6.
 *
 * - Uploads to: {bucket}/thumbnails/{asset_id}.jpg
 * - Sets Cache-Control: public, max-age=31536000, immutable
 * - Returns the CDN-backed public URL
 * - Never uses Supabase Storage
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "./config.js";
import { logger } from "./logger.js";

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.doSpacesRegion,
      endpoint: config.doSpacesEndpoint,
      credentials: {
        accessKeyId: config.doSpacesKey,
        secretAccessKey: config.doSpacesSecret,
      },
      forcePathStyle: false,
    });
  }
  return s3Client;
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
      Bucket: config.doSpacesBucket,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
      ACL: "public-read",
    }),
  );

  // Construct CDN URL: {bucket}.{region}.digitaloceanspaces.com/{key}
  const url = `https://${config.doSpacesBucket}.${config.doSpacesRegion}.digitaloceanspaces.com/${key}`;
  logger.info("Thumbnail uploaded", { assetId, url });
  return url;
}
