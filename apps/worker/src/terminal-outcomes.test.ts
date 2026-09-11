import assert from "node:assert/strict";
import test from "node:test";
import { alertTerminalFailure, appendTerminalRun, type TerminalRun, type TerminalRunStore } from "./terminal-outcomes.js";

const failedRun: TerminalRun = {
  operation: "rebuild-style-groups",
  run_id: "failed-run-1",
  status: "failed",
  source_status: "failed",
  stage: "clear_assets",
  error: "Deliberate failure",
  reason_code: "deliberate_test",
  progress: { total_processed: 0 },
  started_at: "2026-09-09T06:00:00.000Z",
  ended_at: "2026-09-09T06:00:01.000Z",
};

test("a later success does not overwrite a recorded failed run", async () => {
  const rows: TerminalRun[] = [];
  const store: TerminalRunStore = {
    from: () => ({
      insert: async (row) => {
        if (rows.some((existing) => existing.operation === row.operation && existing.run_id === row.run_id)) {
          return { error: { code: "23505", message: "duplicate key" } };
        }
        rows.push(row);
        return { error: null };
      },
    }),
  };

  assert.equal(await appendTerminalRun(store, failedRun), true);
  assert.equal(await appendTerminalRun(store, {
    ...failedRun,
    run_id: "successful-run-2",
    status: "completed",
    source_status: "completed",
    progress: { total_processed: 135_300, failed: 0 },
    error: undefined,
    reason_code: undefined,
  }), true);
  assert.deepEqual(rows.map((row) => [row.run_id, row.status]), [["failed-run-1", "failed"], ["successful-run-2", "completed"]]);
});

test("retrying the same terminal run is idempotent", async () => {
  const store: TerminalRunStore = {
    from: () => ({ insert: async () => ({ error: { code: "23505", message: "duplicate key" } }) }),
  };
  assert.equal(await appendTerminalRun(store, failedRun), true);
});

test("a failed terminal outcome posts a deliberate failure signal to the configured destination", async () => {
  let request: Request | undefined;
  const delivery = await alertTerminalFailure(
    failedRun,
    async (input, init) => {
      request = new Request(input, init);
      return new Response(null, { status: 202 });
    },
    "https://alerts.example.test/nightly",
  );
  assert.equal(delivery, "delivered");
  assert.equal(request?.method, "POST");
  assert.deepEqual(await request?.json(), { type: "bulk_operation_failed", ...failedRun });
});

test("a missing owner-selected destination is a visible non-delivery", async () => {
  assert.equal(await alertTerminalFailure(failedRun, fetch, ""), "destination_unconfigured");
});
