/**
 * AWS Sig v4 DELETE for DigitalOcean Spaces objects from Deno edge functions.
 * Credentials are read from admin_config (DO_SPACES_KEY, DO_SPACES_SECRET, SPACES_CONFIG).
 */

export interface SpacesCredentials {
  key: string;
  secret: string;
  bucket: string;
  region: string;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(message: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return toHex(new Uint8Array(hash));
}

async function hmacSha256Bytes(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function hmacSha256Hex(key: Uint8Array, message: string): Promise<string> {
  return toHex(await hmacSha256Bytes(key, message));
}

/**
 * Delete a single object from DigitalOcean Spaces using AWS Sig v4.
 * Returns true if deleted (204/200), false if object not found (404).
 * Throws on other errors.
 */
export async function deleteSpacesObject(
  objectKey: string,
  creds: SpacesCredentials,
): Promise<boolean> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);

  const host = `${creds.bucket}.${creds.region}.digitaloceanspaces.com`;
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
  const url = `https://${host}/${encodedKey}`;

  const payloadHash = await sha256Hex("");
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "DELETE",
    `/${encodedKey}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${creds.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const enc = new TextEncoder();
  const kDate = await hmacSha256Bytes(enc.encode(`AWS4${creds.secret}`), dateStamp);
  const kRegion = await hmacSha256Bytes(kDate, creds.region);
  const kService = await hmacSha256Bytes(kRegion, "s3");
  const kSigning = await hmacSha256Bytes(kService, "aws4_request");
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${creds.key}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      "host": host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "authorization": authorization,
    },
  });

  if (res.status === 204 || res.status === 200) return true;
  if (res.status === 404) return false;

  const body = await res.text();
  throw new Error(`DO Spaces DELETE ${objectKey} failed: HTTP ${res.status} — ${body.slice(0, 300)}`);
}

/** Delete multiple objects. Returns { deleted, notFound, failed } counts. */
export async function deleteSpacesObjects(
  keys: string[],
  creds: SpacesCredentials,
): Promise<{ deleted: number; notFound: number; errors: string[] }> {
  let deleted = 0;
  let notFound = 0;
  const errors: string[] = [];

  for (const key of keys) {
    try {
      const found = await deleteSpacesObject(key, creds);
      if (found) deleted++;
      else notFound++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  return { deleted, notFound, errors };
}

/** Read SpacesCredentials from admin_config rows (DO_SPACES_KEY, DO_SPACES_SECRET, SPACES_CONFIG). */
export function credentialsFromConfig(
  configMap: Record<string, unknown>,
): SpacesCredentials | null {
  const key = configMap.DO_SPACES_KEY as string | null;
  const secret = configMap.DO_SPACES_SECRET as string | null;
  const spaces = (configMap.SPACES_CONFIG as Record<string, string> | null) || {};

  if (!key || !secret) return null;

  return {
    key,
    secret,
    bucket: spaces.bucket_name || spaces.bucket || "popdam",
    region: spaces.region || "nyc3",
  };
}
