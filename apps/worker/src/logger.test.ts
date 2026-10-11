import test from "node:test";
import assert from "node:assert/strict";
import { resolveLogLevel, shouldLog } from "./logger.js";

test("LOG_LEVEL defaults to info and ignores unknown values", () => {
  assert.equal(resolveLogLevel(undefined), "info");
  assert.equal(resolveLogLevel("verbose"), "info");
  assert.equal(resolveLogLevel(" DEBUG "), "debug");
  assert.equal(resolveLogLevel("error"), "error");
});

test("debug is suppressed at the default level and shown at debug", () => {
  assert.equal(shouldLog("debug", "info"), false);
  assert.equal(shouldLog("info", "info"), true);
  assert.equal(shouldLog("debug", "debug"), true);
  assert.equal(shouldLog("warn", "error"), false);
  assert.equal(shouldLog("error", "warn"), true);
});
