import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, findDuplicate, parsePaginated, dedupeKey, marker, ALERT_SQL } from "./report-coldlion-property-skip-alert.mjs";

test("no open alert means nothing to deliver", () => {
  assert.deepEqual(buildPlan({ alerts: [] }), { ok: true, deliver: false });
});

test("unreadable probe fails closed", () => {
  assert.equal(buildPlan(null).ok, false);
  assert.equal(buildPlan({}).ok, false);
});

test("plan names the codes and the reason, newest alert wins", () => {
  const p = buildPlan({ alerts: [
    { id: "a2", codes: ["SBR", "PF"], fired_at: "t2", sync_run_id: 9 },
    { id: "a1", codes: ["PF"], fired_at: "t1", sync_run_id: 8 },
  ] });
  assert.equal(p.deliver, true);
  assert.deepEqual(p.codes, ["PF", "SBR"]);
  assert.match(p.body, /`PF`, `SBR`/);
  assert.match(p.body, /unresolved_licensor/);
  assert.ok(p.body.startsWith(marker(dedupeKey(["SBR", "PF"]))));
});

test("dedupe key ignores order, changes with the code set", () => {
  assert.equal(dedupeKey(["A", "B"]), dedupeKey(["B", "A"]));
  assert.notEqual(dedupeKey(["A"]), dedupeKey(["A", "B"]));
});

test("an open issue with the same marker is a duplicate; PRs and other keys are not", () => {
  const k = dedupeKey(["PF"]);
  assert.equal(findDuplicate([{ number: 5, body: marker(k) }], k), 5);
  assert.equal(findDuplicate([{ number: 6, body: marker(k), pull_request: {} }], k), null);
  assert.equal(findDuplicate([{ number: 7, body: marker(dedupeKey(["X"])) }], k), null);
});

test("probe is a single read-only SELECT", () => {
  assert.match(ALERT_SQL, /^select /);
  assert.doesNotMatch(ALERT_SQL, /\b(insert|update|delete|alter|create|drop)\b/i);
});

test("paginated gh output joins pages", () => {
  assert.deepEqual(parsePaginated('[{"number":1}]\n[{"number":2}]'), [{ number: 1 }, { number: 2 }]);
  assert.deepEqual(parsePaginated("[]"), []);
  assert.deepEqual(parsePaginated(""), []);
  assert.deepEqual(parsePaginated('[{"b":"a]b"}][]'), [{ b: "a]b" }]);
});
