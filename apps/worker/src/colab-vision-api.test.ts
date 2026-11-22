import assert from "node:assert/strict";
import test from "node:test";
import {
  colabChatCompletion,
  colabModelId,
  ColabVisionApiError,
  getColabVisionApiKey,
  getColabVisionConfig,
  isColabDirectModel,
  isTerminalColabVisionApiError,
  resetColabVisionConfigCacheForTests,
  shutdownColabVisionServer,
  validateColabBaseUrl,
} from "./colab-vision-api.js";

test("isColabDirectModel and colabModelId parse colab-direct prefixes", () => {
  assert.equal(isColabDirectModel("colab-direct/Qwen/Qwen3-VL-32B-Instruct"), true);
  assert.equal(isColabDirectModel("  colab-direct/qwen3-vl-32b  "), true);
  assert.equal(isColabDirectModel("colab-direct/"), false);
  assert.equal(isColabDirectModel("qwen/qwen3-vl-32b-instruct"), false);
  assert.equal(colabModelId("colab-direct/Qwen/Qwen3-VL-32B-Instruct"), "Qwen/Qwen3-VL-32B-Instruct");
});

test("validateColabBaseUrl enforces public HTTPS and normalizes path suffixes", () => {
  assert.equal(
    validateColabBaseUrl("https://bright-fox.trycloudflare.com/"),
    "https://bright-fox.trycloudflare.com",
  );
  assert.equal(
    validateColabBaseUrl("https://bright-fox.trycloudflare.com/v1/chat/completions"),
    "https://bright-fox.trycloudflare.com",
  );
  assert.equal(
    validateColabBaseUrl("https://bright-fox.trycloudflare.com/v1"),
    "https://bright-fox.trycloudflare.com",
  );
  for (const bad of [
    "",
    "http://bright-fox.trycloudflare.com",
    "https://localhost:8000",
    "https://127.0.0.1:8000",
    "https://10.0.0.5",
    "https://192.168.1.10",
    "https://169.254.169.254/latest",
    "https://user:pass@bright-fox.trycloudflare.com",
  ]) {
    assert.throws(() => validateColabBaseUrl(bad), `expected rejection for ${bad}`);
  }
});

test("getColabVisionConfig uses authoritative DB row and caches", async () => {
  resetColabVisionConfigCacheForTests();
  let calls = 0;
  const loader = async () => {
    calls++;
    return { found: true, baseUrl: "https://demo-tunnel.trycloudflare.com/v1", apiKey: "tok_123", autoShutdown: true };
  };
  const first = await getColabVisionConfig(loader);
  const second = await getColabVisionConfig(loader);
  assert.deepEqual(first, { baseUrl: "https://demo-tunnel.trycloudflare.com", apiKey: "tok_123", autoShutdown: true });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);

  resetColabVisionConfigCacheForTests();
  const key = await getColabVisionApiKey(async () => ({ found: true, baseUrl: "", apiKey: "tok_only", autoShutdown: true }));
  assert.equal(key, "");
});

test("colabChatCompletion sends OpenAI chat completions with bearer auth and parses response", async () => {
  let capturedUrl = "";
  let capturedAuth = "";
  let capturedBody: Record<string, unknown> = {};
  const fakeFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    const headers = init?.headers as Record<string, string>;
    capturedAuth = headers.Authorization;
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: "chatcmpl-colab-1",
        model: "Qwen/Qwen3-VL-32B-Instruct",
        choices: [{ message: { content: "{\"ok\":true}" } }],
        usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await colabChatCompletion(
    "secret-token",
    {
      model: "colab-direct/Qwen/Qwen3-VL-32B-Instruct",
      messages: [{ role: "user", content: "Tag this" }],
      response_format: { type: "json_object" },
      max_tokens: 1024,
    },
    10_000,
    { baseUrl: "https://demo-tunnel.trycloudflare.com", fetchImpl: fakeFetch },
  );

  assert.equal(capturedUrl, "https://demo-tunnel.trycloudflare.com/v1/chat/completions");
  assert.equal(capturedAuth, "Bearer secret-token");
  assert.equal(capturedBody.model, "Qwen/Qwen3-VL-32B-Instruct");
  assert.deepEqual(capturedBody.response_format, { type: "json_object" });
  assert.equal(result.content, "{\"ok\":true}");
  assert.equal(result.usage?.total_tokens, 165);
  assert.equal(result.providerInfo?.provider, "google-colab");
});

test("colabChatCompletion classifies terminal HTTP errors", async () => {
  const fakeFetch: typeof fetch = async () => new Response("tunnel offline", { status: 502 });
  await assert.rejects(
    () =>
      colabChatCompletion(
        "secret-token",
        { model: "colab-direct/Qwen/Qwen3-VL-32B-Instruct", messages: [] },
        5_000,
        { baseUrl: "https://demo-tunnel.trycloudflare.com", fetchImpl: fakeFetch },
      ),
    (error: unknown) => {
      assert.ok(error instanceof ColabVisionApiError);
      assert.equal(error.status, 502);
      assert.equal(isTerminalColabVisionApiError(error), true);
      return true;
    },
  );
  assert.equal(isTerminalColabVisionApiError(new ColabVisionApiError(400, "bad request")), false);
  assert.equal(isTerminalColabVisionApiError(new ColabVisionApiError(401, "unauthorized")), true);
});

test("shutdownColabVisionServer sends authenticated instant shutdown by default and respects opt-out", async () => {
  resetColabVisionConfigCacheForTests();
  let capturedUrl = "";
  let capturedAuth = "";
  let capturedReason = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedAuth = (init?.headers as Record<string, string>).Authorization;
    capturedReason = (JSON.parse(String(init?.body)) as { reason?: string }).reason ?? "";
    return new Response(JSON.stringify({ ok: true, shutting_down: true }), { status: 200 });
  };

  const sent = await shutdownColabVisionServer({
    reason: "bulk_ai_tag_completed",
    fetchImpl: fakeFetch,
    loadFromDb: async () => ({
      found: true,
      baseUrl: "https://demo-tunnel.trycloudflare.com",
      apiKey: "tok_shutdown",
      autoShutdown: true,
    }),
  });
  assert.equal(sent, true);
  assert.equal(capturedUrl, "https://demo-tunnel.trycloudflare.com/popdam/shutdown");
  assert.equal(capturedAuth, "Bearer tok_shutdown");
  assert.equal(capturedReason, "bulk_ai_tag_completed");

  // Explicit opt-out skips the HTTP call completely
  resetColabVisionConfigCacheForTests();
  let calledOnOptOut = false;
  const skipped = await shutdownColabVisionServer({
    fetchImpl: async () => { calledOnOptOut = true; return new Response("ok", { status: 200 }); },
    loadFromDb: async () => ({
      found: true,
      baseUrl: "https://demo-tunnel.trycloudflare.com",
      apiKey: "tok_shutdown",
      autoShutdown: false,
    }),
  });
  assert.equal(skipped, false);
  assert.equal(calledOnOptOut, false);

  // Network/HTTP errors are swallowed so completed jobs never fail
  resetColabVisionConfigCacheForTests();
  const failed = await shutdownColabVisionServer({
    baseUrl: "https://demo-tunnel.trycloudflare.com",
    apiKey: "tok_shutdown",
    fetchImpl: async () => { throw new Error("tunnel already closed"); },
  });
  assert.equal(failed, false);
});
