const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { build, SOURCE_SHA } = require("./popsg-property-psg4-decision-package.cjs");

const root = path.resolve(__dirname, "..");
const out = path.join(
  root,
  "docs/verification/popsg-property-reconciliation-20260728-psg4"
);
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const lf = (value) => value.replace(/\r\n/g, "\n");

const built = build();
for (const [name, expected] of Object.entries(built)) {
  assert.equal(lf(fs.readFileSync(path.join(out, name), "utf8")), expected, name);
}

const manifest = JSON.parse(built["manifest.json"]);
const decisions = built["decisions.csv"].trimEnd().split("\n");
assert.equal(decisions.length, 52);
assert.equal(manifest.source.sha256, SOURCE_SHA);
assert.equal(manifest.source.rows, 51);
assert.equal(manifest.source.active_files, 44331);
assert.equal(manifest.status, "pending_explicit_owner_approval");
assert.equal(sha(built["decisions.csv"]), manifest.files["decisions.csv"].sha256);
assert.equal(
  sha(built["approval-language.txt"].trimEnd()),
  manifest.files["approval-language.txt"].sha256
);
assert.match(built["approval-language.txt"], new RegExp(manifest.package_sha256));
assert.match(built["README.md"], /Canonical create \| 0 \| 0/);
assert.match(built["README.md"], /6,961 at-risk removals/);
assert.match(built["approval-language.txt"], /I do not approve Batch 02/);
assert.match(built["approval-language.txt"], /PSG-5/);

const approval = JSON.parse(
  fs.readFileSync(path.join(out, "owner-approval.json"), "utf8")
);
assert.equal(approval.phase, "PSG-4");
assert.equal(approval.status, "approved");
assert.equal(approval.decision_owner, "Albert Hazan");
assert.equal(approval.owner_message_verbatim, "Approves");
assert.equal(approval.approved_package_sha256, manifest.package_sha256);
assert.equal(approval.approved_source_sha256, SOURCE_SHA);
assert.equal(approval.approved_scope.batch_id, "batch-01-exact-existing");
assert.equal(approval.approved_scope.rows, 51);
assert.equal(approval.approved_scope.active_files, 44331);
assert.equal(approval.approved_scope.same_parent_targets_only, true);
assert.deepEqual(approval.explicitly_not_approved, manifest.exclusions);
assert.equal(approval.technical_review.reviewer, "GLM 5.2");
assert.equal(approval.technical_review.verdict, "APPROVE");

console.log("PSG-4 decision package: PASS");
console.log(`source=${SOURCE_SHA}`);
console.log(`package=${manifest.package_sha256}`);
console.log("rows=51 active_files=44331 parent_edges=51/51 exclusions=11 approval=recorded");
