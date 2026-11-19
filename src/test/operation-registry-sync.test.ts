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

import {
  OP_CONFLICTS as workerConflicts,
  OP_LANES as workerLanes,
} from "../../apps/worker/vendor/operation-policy.js";

const workerSource = readFileSync("apps/worker/src/operation-loop.ts", "utf8").replace(/\r\n/g, "\n");

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

  it("the packaged shared maps agree with the backend", () => {
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

describe("parallel file tagging dynamic conflicts", () => {
  const single = "ai-tag-single-123e4567-e89b-42d3-a456-426614174000";
  it("prevents manual retag overlap in both native start directions", () => {
    expect(findRunningConflict("ai-tag-parallel", {[single]: {status:"running"}})).toBe(single);
    expect(findRunningConflict(single, {"ai-tag-parallel": {status:"running"}})).toBe("ai-tag-parallel");
    expect(findRunningConflict("ai-tag-parallel", {"ai-tag-bakeoff": {status:"running"}})).toBeNull();
  });
});
