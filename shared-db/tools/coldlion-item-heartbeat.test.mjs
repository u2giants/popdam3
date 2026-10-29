import test from "node:test";
import assert from "node:assert/strict";

import {
  HEARTBEAT_WINDOW_MINUTES,
  buildHeartbeatUrl,
  classifyHeartbeat,
  runProbe,
  vendorTimeToUtc,
} from "./coldlion-item-heartbeat.mjs";

// The recorded live envelope for sort=createdTime,desc (issue #5011, 2026-10-29):
// the two newest items at probe time, echo key "sort".
const RECORDED = {
  totalElements: 19_862,
  sort: [{ direction: "DESC", property: "createdTime", ignoreCase: false, nullHandling: "NATIVE", ascending: false, descending: true }],
  content: [
    { itemNo: "NKR82HDWAN02", createdTime: "2026-10-28 17:27:39.668", modTime: "2026-10-28 17:27:39.668" },
    { itemNo: "AA020NDCST02", createdTime: "2026-10-28 17:09:06.250", modTime: "2026-10-28 17:09:06.250" },
  ],
};

test("one GET, two rows, newest first", () => {
  assert.equal(String(buildHeartbeatUrl({ baseUrl: "https://coldlion.example" })), "https://coldlion.example/items?companyCode=EDGEHOME&sort=createdTime%2Cdesc&size=2&page=0");
  assert.equal(HEARTBEAT_WINDOW_MINUTES, 10, "two intervals of the cadence survive one skipped run");
});

test("vendor wall time is America/New_York (recorded correlation evidence)", () => {
  assert.equal(vendorTimeToUtc("2026-10-28 17:27:39.668").toISOString().slice(0, 16), "2026-10-28T21:27", "EDT = UTC-4 on the recorded date");
  assert.equal(vendorTimeToUtc("2026-01-15 09:00:00").toISOString().slice(0, 16), "2026-01-15T14:00", "EST = UTC-5 in winter");
  assert.equal(vendorTimeToUtc("not a time"), null);
});

test("the recorded newest item triggers only inside the window", () => {
  const trigger = classifyHeartbeat(RECORDED, { now: new Date("2026-10-28T21:30:00.000Z") });
  assert.equal(trigger.outcome, "trigger");
  assert.equal(trigger.newestItemNo, "NKR82HDWAN02");
  const quiet = classifyHeartbeat(RECORDED, { now: new Date("2026-10-28T23:30:00.000Z") });
  assert.equal(quiet.outcome, "quiet");
  assert.ok(quiet.ageMinutes > 100);
});

test("the workflow contract end to end: the dispatch gate key exists and exit codes are right (round-5 C1/M2)", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => RECORDED });
  const triggered = await runProbe("test-key", fetchImpl, { now: new Date("2026-10-28T21:30:00.000Z") });
  assert.equal(triggered.report.trigger, true, "the jq gate reads .trigger");
  assert.equal(triggered.exitCode, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(triggered.report)).trigger, true, "the report is JSON-serializable with the gate key");
  const quiet = await runProbe("test-key", fetchImpl, { now: new Date("2026-10-28T23:30:00.000Z") });
  assert.equal(quiet.report.trigger, false);
  assert.equal(quiet.exitCode, 0);
  const lies = await runProbe("test-key", async () => ({ ok: true, json: async () => ({ ...RECORDED, content: [...RECORDED.content].reverse() }) }), { now: new Date("2026-10-28T21:30:00.000Z") });
  assert.equal(lies.exitCode, 1);
  assert.equal(lies.report.trigger, false);
});

test("a vendor sort change fails loudly — the recorded unsorted default echo", () => {
  const unsorted = { ...RECORDED, sort: [{ direction: "ASC", property: "ItemNo", ignoreCase: false, nullHandling: "NATIVE", ascending: true, descending: false }], content: [{ itemNo: "01", createdTime: "2022-07-21 13:38:41.992" }] };
  const result = classifyHeartbeat(unsorted, { now: new Date("2026-10-29T04:00:00.000Z") });
  assert.equal(result.outcome, "malformed");
  assert.match(result.message, /sort echo/);
  // The alias key is accepted if the vendor renames.
  const aliased = classifyHeartbeat({ ...RECORDED, sortField: RECORDED.sort, sort: undefined }, { now: new Date("2026-10-28T21:30:00.000Z") });
  assert.equal(aliased.outcome, "trigger");
});

test("metadata lies fail loudly: echo says DESC but the data ascends (/seasons defect class, round-5 H2)", () => {
  const lying = classifyHeartbeat({ ...RECORDED, content: [...RECORDED.content].reverse() }, { now: new Date("2026-10-28T21:30:00.000Z") });
  assert.equal(lying.outcome, "malformed");
  assert.match(lying.message, /not in createdTime-descending order/);
});

test("shape failures are loud, never a quiet pass", () => {
  assert.equal(classifyHeartbeat([{ itemNo: "A1" }]).outcome, "malformed");
  assert.equal(classifyHeartbeat({ content: [] }).outcome, "malformed");
  const noTime = classifyHeartbeat({ ...RECORDED, content: [{ itemNo: "X1", createdTime: null }, RECORDED.content[1]] });
  assert.equal(noTime.outcome, "malformed");
  assert.match(noTime.message, /parseable createdTime/);
  const future = classifyHeartbeat(RECORDED, { now: new Date("2026-10-28T12:00:00.000Z") });
  assert.equal(future.outcome, "malformed");
  assert.match(future.message, /timezone contract/);
});
