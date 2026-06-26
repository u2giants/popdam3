/**
 * Validates that a chosen local folder is the correct root for a given root_id.
 *
 * Rules:
 *  1. Path must not be in the forbidden list (C:\, /Users, etc.)
 *  2. Path must contain a .pop-root.json marker file
 *  3. Marker root_id must match expected root_id
 *  4. If marker is found in a subfolder, suggest the correct root
 */

import { join, dirname, sep } from "path";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import {
  FORBIDDEN_ROOT_PREFIXES_WIN,
  FORBIDDEN_ROOT_PREFIXES_MAC,
  ROOT_MARKER_FILENAME,
} from "@shared/constants";

export interface MarkerFile {
  type: string;
  root_id: string;
  company?: string;
  canonical_server_path?: string;
  schema_version?: number;
}

export type ValidationResult =
  | { ok: true; resolvedPath: string }
  | { ok: false; reason: "forbidden"; message: string }
  | { ok: false; reason: "no_marker"; message: string }
  | { ok: false; reason: "wrong_root_id"; expected: string; actual: string; message: string }
  | { ok: false; reason: "too_deep"; suggestedPath: string; message: string }
  | { ok: false; reason: "too_shallow"; suggestedPath: string; message: string };

function isForbidden(p: string): boolean {
  const prefixes =
    process.platform === "win32"
      ? FORBIDDEN_ROOT_PREFIXES_WIN
      : FORBIDDEN_ROOT_PREFIXES_MAC;
  // Normalize to lowercase on Windows
  const norm = process.platform === "win32" ? p.toLowerCase() : p;
  return prefixes.some((prefix) => {
    const normPrefix = process.platform === "win32" ? prefix.toLowerCase() : prefix;
    return norm === normPrefix || norm === normPrefix + sep;
  });
}

function readMarker(dir: string): MarkerFile | null {
  const markerPath = join(dir, ROOT_MARKER_FILENAME);
  if (!existsSync(markerPath)) return null;
  try {
    return JSON.parse(readFileSync(markerPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Search up to 4 levels up and 5 levels down for a marker file.
 * Used to auto-correct if the user selected a subfolder or parent folder.
 *
 * SeaDrive often nests libraries under account/category/group folders such as:
 *   C:\seadrive\<acct>\Shared with groups\<group>\<library>
 * so two levels is not enough from the account root. Prefer a marker matching
 * the expected root_id, but keep the first mismatched marker so we can return a
 * useful wrong-root error when no matching marker exists nearby.
 */
function findMarkerNearby(
  startPath: string,
  expectedRootId: string,
): { path: string; marker: MarkerFile } | null {
  let firstMismatch: { path: string; marker: MarkerFile } | null = null;
  const consider = (path: string, marker: MarkerFile | null) => {
    if (!marker) return null;
    if (marker.root_id === expectedRootId) return { path, marker };
    firstMismatch ??= { path, marker };
    return null;
  };

  // Check the path itself first
  const direct = consider(startPath, readMarker(startPath));
  if (direct) return direct;

  // Check up to 4 levels up
  let current = startPath;
  for (let i = 0; i < 4; i++) {
    const parent = dirname(current);
    if (parent === current) break; // reached fs root
    const found = consider(parent, readMarker(parent));
    if (found) return found;
    current = parent;
  }

  // Check up to 5 levels down, bounded so a virtual drive cannot hang Settings.
  function searchDown(
    dir: string,
    maxDepth: number,
    maxNodes: number,
  ): { path: string; marker: MarkerFile } | null {
    const queue: Array<{ dir: string; depth: number }> = [{ dir, depth: 0 }];
    let visited = 0;
    while (queue.length && visited < maxNodes) {
      const currentDir = queue.shift()!;
      visited++;
      if (currentDir.depth >= maxDepth) continue;

      let entries: string[];
      try {
        entries = readdirSync(currentDir.dir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const child = join(currentDir.dir, entry);
        try {
          if (!statSync(child).isDirectory()) continue;
          const found = consider(child, readMarker(child));
          if (found) return found;
          queue.push({ dir: child, depth: currentDir.depth + 1 });
        } catch {
          /* skip */
        }
      }
    }
    return null;
  }
  const down = searchDown(startPath, 5, 1200);
  if (down) return down;

  return firstMismatch;
}

function markerDepth(fromPath: string, markerPath: string): number {
  const from = fromPath.split(/[\\/]+/).filter(Boolean).length;
  const marker = markerPath.split(/[\\/]+/).filter(Boolean).length;
  return from - marker;
}

function isLikelySeaDriveAccountRoot(chosenPath: string): boolean {
  try {
    const entries = readdirSync(chosenPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name.toLowerCase());
    return entries.some((name) =>
      ["my libraries", "shared with all", "shared with me", "shared with groups"].includes(name),
    );
  } catch {
    return false;
  }
}

export function validateRoot(chosenPath: string, expectedRootId: string): ValidationResult {
  if (isForbidden(chosenPath)) {
    return {
      ok: false,
      reason: "forbidden",
      message: `"${chosenPath}" is too broad. Please choose a dedicated folder like C:\\POP-Files or ~/POP-Files.`,
    };
  }

  const directMarker = readMarker(chosenPath);

  if (directMarker) {
    if (directMarker.root_id !== expectedRootId) {
      return {
        ok: false,
        reason: "wrong_root_id",
        expected: expectedRootId,
        actual: directMarker.root_id,
        message: `This folder is marked as "${directMarker.root_id}", but "${expectedRootId}" is expected.`,
      };
    }
    return { ok: true, resolvedPath: chosenPath };
  }

  // No direct marker — search nearby
  const nearby = findMarkerNearby(chosenPath, expectedRootId);

  if (!nearby) {
    if (isLikelySeaDriveAccountRoot(chosenPath)) {
      return {
        ok: false,
        reason: "no_marker",
        message:
          `"${chosenPath}" looks like a SeaDrive account folder, not a NAS root folder. ` +
          `Use it in Settings → Seafile / SeaDrive → SeaDrive mount folder. ` +
          `Leave NAS folder mappings blank unless you also need Synology fallback.`,
      };
    }
    return {
      ok: false,
      reason: "no_marker",
      message: `No POP root marker found in or near "${chosenPath}". Contact your IT admin to set up the root.`,
    };
  }

  if (nearby.marker.root_id !== expectedRootId) {
    return {
      ok: false,
      reason: "wrong_root_id",
      expected: expectedRootId,
      actual: nearby.marker.root_id,
      message: `The nearest POP root marker is for "${nearby.marker.root_id}", but "${expectedRootId}" is expected.`,
    };
  }

  if (nearby.path !== chosenPath) {
    // Marker found in a parent or child — the user picked the wrong level
    const depth = markerDepth(chosenPath, nearby.path);
    if (depth > 0) {
      // User picked a subfolder
      return {
        ok: false,
        reason: "too_deep",
        suggestedPath: nearby.path,
        message: `You selected a subfolder inside the root. The correct root appears to be:\n${nearby.path}`,
      };
    } else {
      // User picked a parent folder
      return {
        ok: false,
        reason: "too_shallow",
        suggestedPath: nearby.path,
        message: `You selected a parent folder. The correct root appears to be:\n${nearby.path}`,
      };
    }
  }

  return {
    ok: false,
    reason: "no_marker",
    message: `No POP root marker found in "${chosenPath}".`,
  };
}

export function writeMarker(rootPath: string, rootId: string, company = "POP Creations"): void {
  const marker: MarkerFile = {
    type: "pop-dam-root",
    root_id: rootId,
    company,
    created_by: "POP DAM Helper",
    do_not_move: true,
    schema_version: 1,
  } as MarkerFile & { created_by: string; do_not_move: boolean };
  writeFileSync(
    join(rootPath, ROOT_MARKER_FILENAME),
    JSON.stringify(marker, null, 2),
    "utf-8",
  );
}
