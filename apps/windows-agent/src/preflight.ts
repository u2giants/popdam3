/**
 * Preflight health checks for the Windows Render Agent.
 *
 * Checks NAS accessibility (with drive mapping) before allowing
 * the agent to claim render jobs.
 */

import { logger } from "./logger";
import { ensureNasMapped } from "./nas-mapper";

// ── Types ───────────────────────────────────────────────────────

export interface HealthStatus {
  healthy: boolean;
  nasHealthy: boolean;
  lastPreflightError: string | null;
  lastPreflightAt: string | null;
}

// ── Main preflight ──────────────────────────────────────────────

export async function runPreflight(opts: {
  mountPath?: string;
  nasHost: string;
  nasShare: string;
  nasUsername: string;
  nasPassword: string;
}): Promise<HealthStatus> {
  logger.info("Running preflight health checks...");

  // NAS check — map drive (or authenticate UNC) then verify
  const nasResult = await ensureNasMapped(opts.mountPath, {
    host: opts.nasHost,
    share: opts.nasShare,
    username: opts.nasUsername,
    password: opts.nasPassword,
  });
  if (nasResult.ok) {
    logger.info("  ✓ NAS access OK");
  } else {
    logger.error("  ✗ NAS access FAILED", { error: nasResult.error });
  }

  // Optional tool availability info (not required for health)
  const { existsSync } = await import("node:fs");
  const inkscapePath = process.env.INKSCAPE_PATH || "C:\\Program Files\\Inkscape\\bin\\inkscape.exe";
  const inkscapeAvailable = existsSync(inkscapePath);
  if (inkscapeAvailable) {
    logger.info("  ✓ Inkscape available for AI fallback rendering");
  } else {
    logger.info("  ⓘ Inkscape not found — AI fallback chain will skip Inkscape step (optional)");
  }

  const healthy = nasResult.ok;

  const status: HealthStatus = {
    healthy,
    nasHealthy: nasResult.ok,
    lastPreflightError: nasResult.error || null,
    lastPreflightAt: new Date().toISOString(),
  };

  if (healthy) {
    logger.info("Preflight PASSED — agent is healthy");
  } else {
    logger.warn("Preflight FAILED — agent will NOT claim render jobs", {
      nasHealthy: nasResult.ok,
    });
  }

  return status;
}
