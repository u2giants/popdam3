/**
 * SeaDrive installer mirror.
 *
 * Periodically (weekly) scrapes the official Seafile download page for the latest
 * SeaDrive (virtual-drive) client version, and — if it's newer than what we've
 * mirrored — downloads the macOS .pkg and Windows .msi and uploads them to our
 * DigitalOcean Spaces bucket. The pinned result is written to
 * admin_config.SEADRIVE_LATEST, which the PopDAM Downloads page reads so it only
 * ever offers the latest version, hosted by us.
 *
 * Spaces credentials are read from admin_config (DO_SPACES_*) — same source the
 * bridge agent uses — so no extra worker env vars are required.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../supabase.js";
import { logger } from "../logger.js";

const STORE_KEY = "SEADRIVE_LATEST";
const DOWNLOAD_PAGE = "https://www.seafile.com/en/download/";
const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // weekly
const SPACES_PREFIX = "seadrive";

interface SeaDriveLatest {
  version: string;
  mac_url: string | null;
  win_url: string | null;
  source: { mac: string | null; win: string | null };
  mirrored: boolean;
  checked_at: string;
}

interface SpacesCfg {
  key: string;
  secret: string;
  region: string;
  bucket: string;
  baseUrl: string;
}

async function readConfig<T = unknown>(keys: string[]): Promise<Record<string, T>> {
  const { data } = await db().from("admin_config").select("key, value").in("key", keys);
  const out: Record<string, T> = {};
  for (const row of data ?? []) out[row.key as string] = row.value as T;
  return out;
}

async function loadSpacesCfg(): Promise<SpacesCfg | null> {
  const c = await readConfig<string>([
    "DO_SPACES_KEY", "DO_SPACES_SECRET", "DO_SPACES_REGION", "DO_SPACES_BUCKET", "DO_SPACES_BASE_URL",
  ]);
  if (!c.DO_SPACES_KEY || !c.DO_SPACES_SECRET || !c.DO_SPACES_BUCKET) return null;
  return {
    key: c.DO_SPACES_KEY,
    secret: c.DO_SPACES_SECRET,
    region: c.DO_SPACES_REGION || "nyc3",
    bucket: c.DO_SPACES_BUCKET,
    baseUrl: (c.DO_SPACES_BASE_URL || `https://${c.DO_SPACES_BUCKET}.${c.DO_SPACES_REGION}.digitaloceanspaces.com`).replace(/\/$/, ""),
  };
}

/** Parse the download page for the newest SeaDrive version + installer URLs. */
function parseDownloadPage(html: string): { version: string; mac: string | null; win: string | null } | null {
  const urls = Array.from(
    html.matchAll(/https?:\/\/[^\s"'<>]*\/seadrive-(\d+\.\d+\.\d+)[^\s"'<>]*\.(pkg|msi)/gi),
  ).map((m) => ({ url: m[0], version: m[1], ext: m[2].toLowerCase() }));
  if (urls.length === 0) return null;

  // Highest semver wins.
  const cmp = (a: string, b: string) => {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  };
  const version = urls.map((u) => u.version).sort(cmp).at(-1)!;
  const forVersion = urls.filter((u) => u.version === version);
  return {
    version,
    mac: forVersion.find((u) => u.ext === "pkg")?.url ?? null,
    win: forVersion.find((u) => u.ext === "msi")?.url ?? null,
  };
}

async function mirrorOne(
  s3: S3Client,
  cfg: SpacesCfg,
  sourceUrl: string,
  ext: string,
  version: string,
): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`download ${sourceUrl} failed (${res.status})`);
  const body = Buffer.from(await res.arrayBuffer());
  const objectKey = `${SPACES_PREFIX}/seadrive-${version}.${ext}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey,
      Body: body,
      ACL: "public-read",
      ContentType: ext === "pkg" ? "application/octet-stream" : "application/x-msi",
    }),
  );
  logger.info("seadrive-mirror: uploaded", { objectKey, bytes: body.length });
  return `${cfg.baseUrl}/${objectKey}`;
}

/**
 * Run at most weekly. Returns silently on any error — this is best-effort and
 * must never disrupt the bulk-operation loop.
 */
export async function maybeMirrorSeaDrive(): Promise<void> {
  try {
    const existingMap = await readConfig<SeaDriveLatest>([STORE_KEY]);
    const existing = existingMap[STORE_KEY];
    if (existing?.checked_at) {
      const age = Date.now() - new Date(existing.checked_at).getTime();
      if (age >= 0 && age < CHECK_INTERVAL_MS) return; // throttled
    }

    const pageRes = await fetch(DOWNLOAD_PAGE);
    if (!pageRes.ok) {
      logger.warn("seadrive-mirror: download page fetch failed", { status: pageRes.status });
      return;
    }
    const parsed = parseDownloadPage(await pageRes.text());
    if (!parsed) {
      logger.warn("seadrive-mirror: could not parse a SeaDrive version from the page");
      return;
    }

    const now = new Date().toISOString();
    const alreadyCurrent = existing?.version === parsed.version && existing?.mirrored;
    if (alreadyCurrent) {
      // Same version already mirrored — just bump checked_at.
      await db().from("admin_config").upsert(
        { key: STORE_KEY, value: { ...existing, checked_at: now }, updated_at: now },
        { onConflict: "key" },
      );
      return;
    }

    const cfg = await loadSpacesCfg();
    let macUrl: string | null = parsed.mac;
    let winUrl: string | null = parsed.win;
    let mirrored = false;

    if (cfg) {
      const s3 = new S3Client({
        region: cfg.region,
        endpoint: `https://${cfg.region}.digitaloceanspaces.com`,
        credentials: { accessKeyId: cfg.key, secretAccessKey: cfg.secret },
        forcePathStyle: false,
      });
      try {
        if (parsed.mac) macUrl = await mirrorOne(s3, cfg, parsed.mac, "pkg", parsed.version);
        if (parsed.win) winUrl = await mirrorOne(s3, cfg, parsed.win, "msi", parsed.version);
        mirrored = true;
      } catch (e) {
        // Fall back to the official source URLs if the mirror fails.
        logger.error("seadrive-mirror: upload failed; falling back to official URLs", {
          error: e instanceof Error ? e.message : String(e),
        });
        macUrl = parsed.mac;
        winUrl = parsed.win;
        mirrored = false;
      }
    } else {
      logger.warn("seadrive-mirror: Spaces config missing; recording official URLs only");
    }

    const value: SeaDriveLatest = {
      version: parsed.version,
      mac_url: macUrl,
      win_url: winUrl,
      source: { mac: parsed.mac, win: parsed.win },
      mirrored,
      checked_at: now,
    };
    await db().from("admin_config").upsert(
      { key: STORE_KEY, value, updated_at: now },
      { onConflict: "key" },
    );
    logger.info("seadrive-mirror: recorded latest", { version: parsed.version, mirrored });
  } catch (e) {
    logger.error("seadrive-mirror: unexpected error", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
