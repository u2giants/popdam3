import assert from "node:assert/strict";
import test from "node:test";
import { setBatchPollIntervalForTests, chatCompletion, isToolChoiceCompatibilityError, withExactoRouting } from "./openrouter.js";

test("appends :exacto to a bare model slug", () => {
  assert.equal(withExactoRouting("qwen/qwen3-vl-32b-instruct"), "qwen/qwen3-vl-32b-instruct:exacto");
  assert.equal(withExactoRouting("deepseek/deepseek-v4-pro"), "deepseek/deepseek-v4-pro:exacto");
});

test("leaves a model that already carries an explicit variant untouched", () => {
  assert.equal(withExactoRouting("minimax/minimax-m3:exacto"), "minimax/minimax-m3:exacto");
  assert.equal(withExactoRouting("qwen/qwen3-vl-32b-instruct:nitro"), "qwen/qwen3-vl-32b-instruct:nitro");
  assert.equal(withExactoRouting("some/model:free"), "some/model:free");
});

test("trims surrounding whitespace and no-ops on empty input", () => {
  assert.equal(withExactoRouting("  deepseek/deepseek-v4-flash  "), "deepseek/deepseek-v4-flash:exacto");
  assert.equal(withExactoRouting(""), "");
  assert.equal(withExactoRouting("   "), "");
});

test("tool choice compatibility fallback accepts provider 400 and 404 errors", () => {
  assert.equal(isToolChoiceCompatibilityError(400, 'only "auto" is supported for tool_choice'), true);
  assert.equal(isToolChoiceCompatibilityError(404, "unsupported tool_choice"), true);
  assert.equal(isToolChoiceCompatibilityError(400, "invalid image"), false);
  assert.equal(isToolChoiceCompatibilityError(422, "unsupported tool_choice"), false);
});

test("batch-only models use the Batch API and combine concurrent requests", async () => {
  const original = globalThis.fetch;
  const submissions: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://openrouter.ai/api/beta/batches" && init?.method === "POST") {
      const submission = JSON.parse(String(init.body)) as Record<string, unknown>;
      submissions.push(submission);
      return new Response(JSON.stringify({ id: "batch-1", status: "pending" }), { status: 200 });
    }
    if (url === "https://openrouter.ai/api/beta/batches/batch-1") {
      const requests = submissions[0].requests as Array<{ custom_id: string; body: Record<string, unknown> }>;
      return new Response(JSON.stringify({
        id: "batch-1",
        status: "completed",
        results: requests.map((request, index) => ({
          custom_id: request.custom_id,
          response: {
            status_code: 200,
            body: {
              model: "google/gemini-3.7-flash",
              choices: [{ message: { content: JSON.stringify({ result: index + 1 }) } }],
              usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
            },
          },
        })),
      }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const first = chatCompletion("key", {
      model: "google/gemini-3.7-flash:batch",
      messages: [{ role: "user", content: "first" }],
      response_format: { type: "json_object" },
      temperature: 0,
    });
    const second = chatCompletion("key", {
      model: "google/gemini-3.7-flash:batch",
      messages: [{ role: "user", content: "second" }],
      response_format: { type: "json_object" },
    });
    const results = await Promise.all([first, second]);

    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].endpoint, "/v1/chat/completions");
    assert.equal(submissions[0].model, "google/gemini-3.7-flash");
    const requests = submissions[0].requests as Array<{ body: Record<string, unknown> }>;
    assert.equal(requests.length, 2);
    assert.equal(requests[0].body.model, "google/gemini-3.7-flash");
    assert.equal("temperature" in requests[0].body, false);
    assert.equal(results[0].content, '{"result":1}');
    assert.equal(results[1].content, '{"result":2}');
  } finally {
    globalThis.fetch = original;
  }
});

test("a newly created batch that is not yet visible (404) is polled again, not failed", async () => {
  setBatchPollIntervalForTests(1);
  const original = globalThis.fetch;
  let polls = 0;
  let customId = "";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://openrouter.ai/api/beta/batches" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { requests: Array<{ custom_id: string }> };
      customId = body.requests[0].custom_id;
      return new Response(JSON.stringify({ id: "batch-late", status: "validating" }), { status: 202 });
    }
    if (url === "https://openrouter.ai/api/beta/batches/batch-late") {
      polls += 1;
      // OpenRouter answers 404 for the first seconds after creation.
      if (polls < 3) {
        return new Response(JSON.stringify({ error: { message: "Batch job batch-late not found.", code: 404 } }), { status: 404 });
      }
      return new Response(JSON.stringify({
        id: "batch-late",
        status: "completed",
        results: [{
          custom_id: customId,
          response: { status_code: 200, body: { model: "google/gemini-3.7-flash", choices: [{ message: { content: "ok" } }] } },
        }],
      }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const result = await chatCompletion("key", {
      model: "google/gemini-3.7-flash:batch",
      messages: [{ role: "user", content: "hi" }],
    }, 60_000);
    assert.equal(result.content, "ok");
    assert.ok(polls >= 3, `expected retries through the 404s, saw ${polls} polls`);
  } finally {
    globalThis.fetch = original;
    setBatchPollIntervalForTests(5_000);
  }
});

test("a batch that stays missing past the grace window fails loudly", async () => {
  setBatchPollIntervalForTests(1);
  const original = globalThis.fetch;
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://openrouter.ai/api/beta/batches" && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "batch-gone", status: "validating" }), { status: 202 });
    }
    clock += 60_000; // two polls take us past the 2-minute grace window
    return new Response(JSON.stringify({ error: { message: "Batch job batch-gone not found.", code: 404 } }), { status: 404 });
  };
  try {
    await assert.rejects(
      () => chatCompletion("key", { model: "google/gemini-3.7-flash:batch", messages: [{ role: "user", content: "hi" }] }, 60_000),
      /404/,
    );
  } finally {
    globalThis.fetch = original;
    Date.now = realNow;
    setBatchPollIntervalForTests(5_000);
  }
});
