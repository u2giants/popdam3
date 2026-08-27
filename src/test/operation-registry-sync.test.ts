import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OP_CONFLICTS as BACKEND_CONFLICTS,
  OP_LANES as BACKEND_LANES,
  OP_NAMES as BACKEND_NAMES,
  findRunningConflict,
  getLane,
} from "../../supabase/functions/_shared/operation-constants.js";
import {
  OP_CONFLICTS as UI_CONFLICTS,
  OP_LANES as UI_LANES,
  OP_NAMES as UI_NAMES,
} from "@/components/settings/diagnostics/types";

/**
 * Operation definitions are intentionally duplicated across the Railway worker,
 * the edge-function backend, and the admin UI. They must never disagree — a
 * split map means the UI lets a user start a job the worker will refuse (or
 * worse, one the worker will run concurrently with a conflicting job).
 */
const workerSource = readFileSync("apps/worker/src/operation-loop.ts", "utf8");

function parseWorkerMap(header: string): Record<string, string[] | string> {
  const start = workerSource.indexOf(header);
  expect(start, `${header} must exist in the worker`).toBeGreaterThan(-1);
  const body = workerSource.slice(start + header.length);
  const end = body.indexOf("\n};");
  const entries: Record<string, string[] | string> = {};
  for (const line of body.slice(0, end).split("\n")) {
    const listMatch = line.match(/^\s*"([^"]+)":\s*\[([^\]]*)\]/);
    if (listMatch) {
      entries[listMatch[1]] = listMatch[2]
        .split(",")
        .map((value) => value.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
      continue;
    }
    const valueMatch = line.match(/^\s*"([^"]+)":\s*"([^"]+)"/);
    if (valueMatch) entries[valueMatch[1]] = valueMatch[2];
  }
  return entries;
}

const workerLanes = parseWorkerMap("const OP_LANES: Record<string, string> = {") as Record<string, string>;
const workerConflicts = parseWorkerMap(
  "const OP_CONFLICTS: Readonly<Record<string, readonly string[]>> = {",
) as Record<string, string[]>;

describe("operation registry symmetry", () => {
  it("every conflict entry is symmetric in all three registries", () => {
    for (const [label, map] of [
      ["backend", BACKEND_CONFLICTS as Record<string, readonly string[]>],
      ["ui", UI_CONFLICTS as Record<string, readonly string[]>],
      ["worker", workerConflicts as Record<string, readonly string[]>],
    ] as const) {
      for (const [op, conflicts] of Object.entries(map)) {
        for (const other of conflicts) {
          expect(map[other] ?? [], `${label}: ${other} must also block ${op}`).toContain(op);
        }
      }
    }
  });

  it("the backend and the UI agree on names, lanes, and conflicts", () => {
    for (const key of Object.keys(BACKEND_NAMES)) {
      expect(UI_NAMES[key], `UI is missing a name for ${key}`).toBe(BACKEND_NAMES[key]);
      expect(UI_LANES[key], `UI lane drift for ${key}`).toBe(BACKEND_LANES[key]);
      expect([...(UI_CONFLICTS[key] ?? [])].sort()).toEqual([...(BACKEND_CONFLICTS[key] ?? [])].sort());
    }
  });

  it("the worker agrees with the backend on every operation it dispatches", () => {
    for (const key of Object.keys(workerLanes)) {
      if (!(key in BACKEND_LANES)) continue;
      expect(workerLanes[key], `worker lane drift for ${key}`).toBe(BACKEND_LANES[key]);
    }
    for (const key of Object.keys(workerConflicts)) {
      if (!(key in BACKEND_CONFLICTS)) continue;
      expect([...workerConflicts[key]].sort()).toEqual([...(BACKEND_CONFLICTS[key] ?? [])].sort());
    }
  });
});

describe("ai-tag-group-profiles registration", () => {
  const KEY = "ai-tag-group-profiles";

  it("is registered in the worker, the backend, and the UI", () => {
    expect(BACKEND_NAMES[KEY]).toBe("Profile Style Groups");
    expect(UI_NAMES[KEY]).toBe("Profile Style Groups");
    expect(workerLanes[KEY]).toBe("ai-tagging");
    expect(workerSource).toContain('case "ai-tag-group-profiles":\n      return handleStyleGroupProfiles(opState);');
  });

  it("does not change the meaning of the existing ai-tag-groups operation", () => {
    expect(BACKEND_NAMES["ai-tag-groups"]).toBe("AI Tag Groups");
    expect(getLane("ai-tag-groups")).toBe("ai-tagging");
  });

  it("conflicts with rebuild, legacy propagation, and every asset AI-tagging operation", () => {
    for (const other of [
      "rebuild-style-groups",
      "reprocess-metadata",
      "propagate-group-tags",
      "ai-tag-untagged",
      "ai-tag-all",
      "ai-tag-groups",
      "ai-tag-bakeoff",
    ]) {
      expect(BACKEND_CONFLICTS[KEY]).toContain(other);
      expect(UI_CONFLICTS[KEY]).toContain(other);
      expect(workerConflicts[KEY]).toContain(other);
      expect(findRunningConflict(KEY, { [other]: { status: "running" } })).toBe(other);
      expect(findRunningConflict(other, { [KEY]: { status: "running" } })).toBe(KEY);
    }
  });
});
