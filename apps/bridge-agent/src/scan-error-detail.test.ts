import { test } from "node:test";
import assert from "node:assert/strict";
import { createErrorCollector } from "./scan-error-detail.js";

test("collects entries and joins them for the summary", () => {
  const c = createErrorCollector();
  c.add("a.psd", "boom");
  c.add("b.ai", "bang");
  assert.equal(c.summary(), "a.psd: boom | b.ai: bang");
});

test("keeps only the newest max entries", () => {
  const c = createErrorCollector(2);
  c.add("1.psd", "one");
  c.add("2.psd", "two");
  c.add("3.psd", "three");
  assert.equal(c.summary(), "2.psd: two | 3.psd: three");
});

test("truncates long messages per entry", () => {
  const c = createErrorCollector(8, 20);
  c.add("x.psd", "m".repeat(50));
  assert.equal(c.summary().length, 20);
});

test("reset clears the buffer for the next scan", () => {
  const c = createErrorCollector();
  c.add("a.psd", "boom");
  c.reset();
  assert.equal(c.summary(), "");
});
