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
import { existsSync, readFileSync } from "fs";
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
 * Search up to 3 levels up and 1 level down for a marker file.
 * Used to auto-correct if the user selected a subfolder or parent folder.
 */
function findMarkerNearby(startPath: string): { path: string; marker: MarkerFile } | null {
  // Check the path itself first
  const direct = readMarker(startPath);
  if (direct) return { path: startPath, marker: direct };

  // Check up to 2 levels up
  let current = startPath;
  for (let i = 0; i < 2; i++) {
    const parent = dirname(current);
    if (parent === current) break; // reached fs root
    const m = readMarker(parent);
    if (m) return { path: parent, marker: m };
    current = parent;
  }

  // Check immediate children (1 level down)
  try {
    const { readdirSync, statSync } = require("fs");
    const entries = readdirSync(startPath);
    for (const entry of entries) {
      const child = join(startPath, entry);
      try {
        if (statSync(child).isDirectory()) {
          const m = readMarker(child);
          if (m) return { path: child, marker: m };
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return null;
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
  const nearby = findMarkerNearby(chosenPath);

  if (!nearby) {
    return {
      ok: false,
      reason: "no_marker",
      message: `No POP root marker found in or near "${chosenPath}". Contact your IT admin to set up the root.`,
    };
  }

  if (nearby.path !== chosenPath) {
    // Marker found in a parent or child — the user picked the wrong level
    const depth = chosenPath.split(sep).length - nearby.path.split(sep).length;
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
  const { writeFileSync } = require("fs");
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
