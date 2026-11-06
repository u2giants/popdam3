import test from "node:test";
import assert from "node:assert/strict";

// Pins the two deployment policies of the shared agent-api transport (#708):
// single-shot for the Windows render agent, 5-attempt retry with backoff for
// the bridge agent. 4xx never retries on either policy.
//
// No top-level await here: agent-common has no "type": "module", so tsx runs
// this file as CommonJS under both agents' test scripts.

import test from "node:test";
import assert from "node:assert/strict";
import { createAgentApiTransport } from "./agent-api-transport.js";

function withMockedFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  fn: (calls: Array<{ url: string; init?: RequestInit }>) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as typeof fetch;
  return fn(calls).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status });

test("single-shot policy (Windows) does not retry 5xx and passes no signal when no timeout is given", async () => {
  const transport = createAgentApiTransport({
    getUrl: () => "https://fixture-agent-api",
    getKey: () => "fixture-key",
    maxAttempts: 1,
    defaultTimeoutMs: undefined,
  });

  await withMockedFetch(
    () => json({ ok: false, error: "boom" }, 500),
    async (calls) => {
      await assert.rejects(transport.callApi("claim-render"), /returned 500/);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].init?.signal, undefined);
    },
  );
});

test("single-shot policy applies an AbortSignal only when the call site passes a timeout", async () => {
  const transport = createAgentApiTransport({
    getUrl: () => "https://fixture-agent-api",
    getKey: () => "fixture-key",
    maxAttempts: 1,
    defaultTimeoutMs: undefined,
  });

  await withMockedFetch(
    () => json({ ok: true, job: null }),
    async (calls) => {
      await transport.callApi("claim-render", {}, 5_000);
      assert.equal(calls.length, 1);
      assert.ok(calls[0].init?.signal instanceof AbortSignal);
    },
  );
});

test("retry policy (bridge) retries 5xx with backoff until success", async () => {
  const transport = createAgentApiTransport({
    getUrl: () => "https://fixture-agent-api",
    getKey: () => "fixture-key",
    maxAttempts: 5,
    defaultTimeoutMs: 30_000,
    retryBaseDelayMs: 1,
  });

  let n = 0;
  await withMockedFetch(
    () => {
      n += 1;
      return n < 3 ? json({ ok: false, error: "cold start" }, 502) : json({ ok: true, value: n });
    },
    async (calls) => {
      const data = await transport.callApi("heartbeat", {}, 60_000);
      assert.equal(data.value, 3);
      assert.equal(calls.length, 3);
      assert.ok(calls[0].init?.signal instanceof AbortSignal);
    },
  );
});

test("401 records an auth failure and throws on both policies; a later success clears it", async () => {
  const transport = createAgentApiTransport({
    getUrl: () => "https://fixture-agent-api",
    getKey: () => "fixture-key",
    maxAttempts: 5,
    defaultTimeoutMs: 30_000,
    retryBaseDelayMs: 1,
  });

  await withMockedFetch(
    () => json({ ok: false, error: "bad key" }, 401),
    async (calls) => {
      await assert.rejects(transport.callApi("heartbeat"), /returned 401/);
      assert.equal(calls.length, 1); // 401 is permanent — never retried
      assert.equal(transport.isAuthFailure(), true);
      assert.equal(transport.suggestedHeartbeatDelayMs(), 30_000);
    },
  );

  await withMockedFetch(
    () => json({ ok: true }),
    async () => {
      await transport.callApi("heartbeat");
      assert.equal(transport.isAuthFailure(), false);
    },
  );
});

test("data.ok === false is an error, not a retryable response", async () => {
  const transport = createAgentApiTransport({
    getUrl: () => "https://fixture-agent-api",
    getKey: () => "fixture-key",
    maxAttempts: 5,
    defaultTimeoutMs: 30_000,
    retryBaseDelayMs: 1,
  });

  await withMockedFetch(
    () => json({ ok: false, error: "no work" }),
    async (calls) => {
      await assert.rejects(transport.callApi("claim-render"), /no work/);
      assert.equal(calls.length, 1);
    },
  );
});

test("network errors retry on the retry policy and propagate on the single-shot policy", async () => {
  const retrying = createAgentApiTransport({
    getUrl: () => "https://fixture-agent-api",
    getKey: () => "fixture-key",
    maxAttempts: 2,
    defaultTimeoutMs: 30_000,
    retryBaseDelayMs: 1,
  });
  await withMockedFetch(
    () => {
      throw new Error("ECONNRESET fixture");
    },
    async (calls) => {
      await assert.rejects(retrying.callApi("heartbeat"), /ECONNRESET/);
      assert.equal(calls.length, 2);
    },
  );

  const single = createAgentApiTransport({
    getUrl: () => "https://fixture-agent-api",
    getKey: () => "fixture-key",
    maxAttempts: 1,
  });
  await withMockedFetch(
    () => {
      throw new Error("ECONNRESET fixture");
    },
    async (calls) => {
      await assert.rejects(single.callApi("heartbeat"), /ECONNRESET/);
      assert.equal(calls.length, 1);
    },
  );
});
