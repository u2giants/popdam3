import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Exercise the production predicate without loading the worker's external services
// or requiring a TypeScript toolkit in the offline fixer environment.
const source = readFileSync(new URL("./ai-tagging.ts", import.meta.url), "utf8");
const predicate = source.match(/export function isModelOutageError\(msg: string\): boolean \{[\s\S]*?\n\}/)?.[0];
assert.ok(predicate, "production outage predicate exists");
const { isModelOutageError } = await import(`data:text/javascript,${encodeURIComponent(
  predicate.replace("msg: string", "msg").replace("): boolean", ")"),
)}`);

test("catalog removal selects the backup even before a completion is made", () => {
  assert.equal(isModelOutageError("Model retired/vision is not available in the OpenRouter account catalog"), true);
});

test("structured-output wrappers preserve model outage detection", () => {
  for (const error of [
    "OpenRouter 408: Request expired",
    "OpenRouter 425: Too early",
    'OpenRouter 400: {"error":{"message":"x/y is not a valid model ID"}}',
    "OpenRouter 404: Model x/y does not exist",
    "OpenRouter 429: Rate limited after retries",
    "OpenRouter 502: bad gateway",
  ]) {
    assert.equal(isModelOutageError(error), true, error);
    assert.equal(isModelOutageError(`Structured output failed: json_schema: ${error}; json_object: ${error}`), true, error);
  }
});

test("transport failures qualify, incidental policy wording does not", () => {
  for (const error of [
    "AbortError: This operation was aborted",
    "The operation was aborted due to timeout",
    "request aborted", "fetch failed", "network error", "network connection lost",
    "ECONNRESET", "socket hang up",
  ]) assert.equal(isModelOutageError(error), true, error);
  for (const error of [
    "OpenRouter 400: network policy rejected this image",
    "OpenRouter 400: generation aborted by content policy",
    "OpenRouter 401: User not found",
    "OpenRouter 402: Insufficient credits",
    "OpenRouter 400: invalid image",
    "No parsable JSON",
  ]) {
    assert.equal(isModelOutageError(error), false, error);
    assert.equal(isModelOutageError(`Structured output failed: json_object: ${error}`), false, error);
  }
});
