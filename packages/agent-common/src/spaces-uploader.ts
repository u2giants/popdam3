/**
 * Shared DigitalOcean Spaces upload core (PROJECT_BIBLE §6).
 *
 * - Uploads JPEG objects with Cache-Control: public, max-age=31536000, immutable
 * - Returns the CDN-backed public URL (https://{bucket}.{region}.digitaloceanspaces.com/{key})
 * - Never uses Supabase Storage
 * - Supports hot-reload of the S3 client when DO credentials change via heartbeat config sync
 *
 * One engine, two reinit policies (#708), matching each agent's behavior
 * before the modules were shared:
 *   - "eager-if-changed" (bridge): compares merged credentials with the current
 *     ones; when nothing changed this is a no-op returning false. On change it
 *     rebuilds the S3Client immediately and returns true.
 *   - "always-lazy" (Windows): unconditionally adopts the merged credentials,
 *     drops the client (rebuilt on next upload) and returns true.
 *
 * Object-key prefixes (thumbnails/, siblings/, styleguides/, sg-thumbnails/,
 * pdf-pages/) and log lines stay per-agent in apps/<agent>/src/uploader.ts.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { logger } from "./logger.js";

export interface SpacesConfig {
  key: string;
  secret: string;
  bucket: string;
  region: string;
  endpoint: string;
}

export interface SpacesUploaderOptions {
  /** Credentials from the agent's static env config; the merge fallback. */
  defaults(): SpacesConfig;
  reinitPolicy: "eager-if-changed" | "always-lazy";
}

export interface SpacesUploader {
  /** PUT the buffer as image/jpeg and return the public URL. */
  uploadToSpaces(key: string, buffer: Buffer): Promise<string>;
  /**
   * Apply a heartbeat config-sync update (missing fields keep current values).
   * Returns whether a change was applied — "always-lazy" always does.
   */
  reinitialize(doSpaces: Partial<SpacesConfig>): boolean;
  /** Current bucket name (config value until a sync overrides it). */
  getCurrentBucket(): string;
  /** Current region (config value until a sync overrides it). */
  getCurrentRegion(): string;
}

export function createSpacesUploader(options: SpacesUploaderOptions): SpacesUploader {
  let s3Client: S3Client | null = null;
  let current: SpacesConfig | null = null;

  function currentConfig(): SpacesConfig {
    if (!current) current = options.defaults();
    return current;
  }

  function buildClient(c: SpacesConfig): S3Client {
    return new S3Client({
      region: c.region,
      endpoint: c.endpoint,
      credentials: {
        accessKeyId: c.key,
        secretAccessKey: c.secret,
      },
      forcePathStyle: false,
    });
  }

  function getClient(): S3Client {
    if (!s3Client) s3Client = buildClient(currentConfig());
    return s3Client;
  }

  async function uploadToSpaces(key: string, buffer: Buffer): Promise<string> {
    const c = currentConfig();
    const client = getClient();
    await client.send(
      new PutObjectCommand({
        Bucket: c.bucket,
        Key: key,
        Body: buffer,
        ContentType: "image/jpeg",
        CacheControl: "public, max-age=31536000, immutable",
        ACL: "public-read",
      }),
    );

    const url = `https://${c.bucket}.${c.region}.digitaloceanspaces.com/${key}`;
    logger.info("Thumbnail uploaded", { key, url });
    return url;
  }

  function reinitialize(doSpaces: Partial<SpacesConfig>): boolean {
    const base = currentConfig();
    const effective: SpacesConfig = {
      key: doSpaces.key || base.key,
      secret: doSpaces.secret || base.secret,
      bucket: doSpaces.bucket || base.bucket,
      region: doSpaces.region || base.region,
      endpoint: doSpaces.endpoint || base.endpoint,
    };

    if (options.reinitPolicy === "eager-if-changed") {
      // Check if anything actually changed
      if (
        effective.key === base.key &&
        effective.secret === base.secret &&
        effective.bucket === base.bucket &&
        effective.region === base.region &&
        effective.endpoint === base.endpoint
      ) {
        return false;
      }
      current = effective;
      s3Client = buildClient(effective);
      return true;
    }

    // "always-lazy": adopt merged values and force reinit on next upload.
    current = effective;
    s3Client = null;
    return true;
  }

  function getCurrentBucket(): string {
    return currentConfig().bucket;
  }

  function getCurrentRegion(): string {
    return currentConfig().region;
  }

  return { uploadToSpaces, reinitialize, getCurrentBucket, getCurrentRegion };
}
