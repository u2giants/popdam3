import assert from "node:assert/strict";
import test from "node:test";
import { buildMetaResponsesBody, isMetaDirectModel, metaChatCompletion, metaModelId } from "./meta-model-api.js";
import { metaDispatcher } from "./meta-connection.js";

test("Meta's canonical authorization, billing and rate refusals consume no generation", async () => {
  const { classifyMetaSubmissionFailure } = await import("./meta-model-api.js");
  for (const [status, type, code] of [
    [401, "authentication_error", "invalid_api_key"],
    [402, "billing_error", "billing_not_configured"],
    [403, "permission_error", null],
    [429, "rate_limit_error", "rate_limit_exceeded"],
  ] as const) {
    const error = classifyMetaSubmissionFailure(status, JSON.stringify({ error: { type, code, message: "Refused" } }));
    assert.equal(error.name, "DefinitiveBatchRejectionError");
    assert.equal(error.status, status);
  }
  assert.equal(classifyMetaSubmissionFailure(503, JSON.stringify({ error: { message: "Unknown" } })).name, "AmbiguousBatchSubmissionError");
  assert.equal(classifyMetaSubmissionFailure(401, JSON.stringify({ error: { type: "billing_error", message: "Mismatch" } })).name, "AmbiguousBatchSubmissionError");
});

test("recognizes and unwraps explicit direct Meta model IDs", () => {
  assert.equal(isMetaDirectModel("meta-direct/muse-spark-1.3-contributor"), true);
  assert.equal(isMetaDirectModel("meta/muse-spark-1.3"), false);
  assert.equal(metaModelId("meta-direct/muse-spark-1.3-contributor"), "muse-spark-1.3-contributor");
});

test("calls Meta directly and parses tool arguments", async () => {
  const original = globalThis.fetch;
  let sent: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.meta.ai/v1/responses");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-meta-key");
    assert.equal((init as RequestInit & { dispatcher: unknown }).dispatcher, metaDispatcher);
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "meta-generation-1",
      model: "muse-spark-1.3-contributor",
      status: "completed",
      output: [{ type: "reasoning" }, { type: "function_call", name: "tag_asset", arguments: '{"tags":["art"]}' }],
      usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
    }));
  };
  try {
    const result = await metaChatCompletion("test-meta-key", {
      model: "meta-direct/muse-spark-1.3-contributor",
      messages: [{ role: "user", content: "tag it" }],
      provider: { only: ["ignored-openrouter-pin"] },
      tool_choice: "auto",
    });
    const requestBody = sent as Record<string, unknown> | null;
    assert.equal(requestBody?.model, "muse-spark-1.3-contributor");
    assert.equal("provider" in (requestBody ?? {}), false);
    assert.deepEqual(result.toolCalls, [{ name: "tag_asset", arguments: { tags: ["art"] } }]);
    assert.equal(result.providerInfo?.provider, "meta-model-api");
    assert.equal(result.usage?.prompt_tokens, 10);
  } finally {
    globalThis.fetch = original;
  }
});

test("maps chat requests onto the Responses API shape", () => {
  const body = buildMetaResponsesBody({
    model: "meta-direct/muse-spark-1.3-contributor",
    messages: [
      { role: "system", content: "rules" },
      { role: "user", content: [{ type: "text", text: "tag" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] },
    ],
    response_format: { type: "json_schema", json_schema: { name: "tag", strict: true, schema: { type: "object" } } },
    tools: [{ type: "function", function: { name: "tag_asset", parameters: { type: "object" } } }],
    tool_choice: { type: "function", function: { name: "tag_asset" } },
    max_tokens: 1000,
  });
  assert.equal(body.model, "muse-spark-1.3-contributor");
  assert.deepEqual(body.input, [
    { role: "system", content: "rules" },
    { role: "user", content: [{ type: "input_text", text: "tag" }, { type: "input_image", image_url: "data:image/png;base64,AA" }] },
  ]);
  assert.deepEqual(body.text, { format: { type: "json_schema", name: "tag", strict: true, schema: { type: "object" } } });
  assert.deepEqual(body.tools, [{ type: "function", name: "tag_asset", description: undefined, parameters: { type: "object" } }]);
  assert.deepEqual(body.tool_choice, { type: "function", name: "tag_asset" });
  assert.ok((body.max_output_tokens as number) > 1000);
});

test("parses structured text and rejects incomplete responses", async () => {
  const original = globalThis.fetch;
  const request = { model: "meta-direct/muse-spark-1.3-contributor", messages: [{ role: "user" as const, content: "x" }] };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: '{"a":1}' }] }],
    }));
    assert.equal((await metaChatCompletion("k", request)).content, '{"a":1}');
    globalThis.fetch = async () => new Response(JSON.stringify({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }));
    await assert.rejects(metaChatCompletion("k", request), /incomplete: max_output_tokens/);
  } finally {
    globalThis.fetch = original;
  }
});

test("retries intermittent model_not_found, then gives up with a named error", async () => {
  const original = globalThis.fetch;
  const request = { model: "meta-direct/muse-spark-1.3-contributor", messages: [{ role: "user" as const, content: "x" }] };
  const notFound = () => new Response('{"error":{"code":"model_not_found"}}', { status: 404 });
  const ok = () => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] }));
  try {
    let calls = 0;
    globalThis.fetch = async () => (++calls < 3 ? notFound() : ok());
    assert.equal((await metaChatCompletion("k", request, 1000, [0, 0, 0])).content, "ok");
    assert.equal(calls, 3);
    calls = 0;
    globalThis.fetch = async () => { calls++; return notFound(); };
    await assert.rejects(metaChatCompletion("k", request, 1000, [0, 0]), /unavailable after 3 attempts/);
    assert.equal(calls, 3);
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("bad", { status: 400 }); };
    await assert.rejects(metaChatCompletion("k", request, 1000, [0, 0]), /400/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("contributor calls are capped at two in flight within this worker", async () => {
  const original = globalThis.fetch;
  let inFlight = 0, peak = 0;
  globalThis.fetch = async () => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 10));
    inFlight--;
    return new Response(JSON.stringify({ status: "completed", output: [] }));
  };
  try {
    const request = { model: "meta-direct/muse-spark-1.3-contributor", messages: [{ role: "user" as const, content: "x" }] };
    await Promise.all([1, 2, 3, 4].map(() => metaChatCompletion("k", request)));
    assert.equal(peak, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("stream creation extracts chunked creation ID and stops stream; same ID retrieval works", async () => {
  const { createStoredMetaResponse, retrieveStoredMetaResponse } = await import("./meta-model-api.js");
  const original = globalThis.fetch; let posts = 0, gets = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") {
      posts++; const body = JSON.parse(String(init.body)); assert.equal(body.stream,true);assert.equal(body.store,true);assert.equal(body.background,undefined);
      const pieces=['event: response.created\r\ndata: {"type":"response.created","response":{"id":"resp_', 'test"}}\r\n\r\n'];
      return new Response(new ReadableStream({ start(controller) { for(const piece of pieces) controller.enqueue(new TextEncoder().encode(piece)); }}));
    }
    gets++;return new Response('{"id":"resp_test","status":"completed"}');
  };
  try {
    assert.equal(await createStoredMetaResponse("test",{model:"meta-direct/muse-spark-1.3-contributor",messages:[]}),"resp_test");
    assert.equal((await retrieveStoredMetaResponse("test","resp_test")).id,"resp_test");assert.equal(posts,1);assert.equal(gets,1);
  } finally {globalThis.fetch=original;}
});
test("stream lost before creation ID is ambiguous and never internally re-POSTs", async()=>{
 const {createStoredMetaResponse}=await import("./meta-model-api.js");const original=globalThis.fetch;let posts=0;
 globalThis.fetch=async()=>{posts++;throw new DOMException("timed out","TimeoutError");};
 try{await assert.rejects(createStoredMetaResponse("test",{model:"meta-direct/muse-spark-1.3-contributor",messages:[]}),/ambiguous/);assert.equal(posts,1);}finally{globalThis.fetch=original;}
});

test("creation accepts multiline LF SSE with split UTF8 and an opaque stored ID",async()=>{
 const {createStoredMetaResponse}=await import("./meta-model-api.js");const original=globalThis.fetch;
 const bytes=new TextEncoder().encode(': café\n\nevent: response.created\ndata: {"type":"response.created",\ndata: "response":{"id":"opaque-response-id"}}\n\n');
 globalThis.fetch=async()=>new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i++)c.enqueue(bytes.slice(i,i+1));}}));
 try{assert.equal(await createStoredMetaResponse("test",{model:"meta-direct/muse-spark-1.3-contributor",messages:[]}),"opaque-response-id");}finally{globalThis.fetch=original;}
});

test("pending asynchronous generation reserves capacity across restart and terminal proof releases it",async()=>{
 const {synchronizeMetaReservations,metaAsyncBusy,retrieveStoredMetaResponse}=await import("./meta-model-api.js");
 const original=globalThis.fetch;
 synchronizeMetaReservations({a:{status:"failed",run_id:"owner-a",external_job:{provider:"meta-responses",phase:"pending",provider_batch_id:"opaque-response-id"}}});
 assert.equal(metaAsyncBusy("owner-b"),true);assert.equal(metaAsyncBusy("owner-a"),true);
 globalThis.fetch=async()=>new Response('{"id":"opaque-response-id","status":"completed"}');
 try{await retrieveStoredMetaResponse("test","opaque-response-id");synchronizeMetaReservations({});assert.equal(metaAsyncBusy("owner-b"),false);}finally{globalThis.fetch=original;}
 synchronizeMetaReservations({a:{status:"failed",run_id:"owner-a",external_job:{provider:"meta-responses",phase:"ambiguous_submission"}}});assert.equal(metaAsyncBusy("owner-b"),true);assert.equal(metaAsyncBusy("owner-a"),false);synchronizeMetaReservations({});
});
test("Meta typed output-format rejection is definitive; HTML,404,5xx and safety are never alternate authorization",async()=>{
 const {classifyMetaSubmissionFailure,MetaCapabilityRejectionError}=await import("./meta-model-api.js");
 const body=JSON.stringify({error:{type:"invalid_request_error",code:null,param:"text.format",message:"Unsupported schema"}});
 assert.ok(classifyMetaSubmissionFailure(400,body) instanceof MetaCapabilityRejectionError);
 for(const status of [404,500,503])assert.equal(classifyMetaSubmissionFailure(status,body).name,"AmbiguousBatchSubmissionError");
 assert.equal(classifyMetaSubmissionFailure(400,"<html>no</html>").name,"AmbiguousBatchSubmissionError");
 assert.equal(classifyMetaSubmissionFailure(400,JSON.stringify({error:{type:"invalid_request_error",code:"safety",param:"text.format",message:"Blocked"}})).name,"AmbiguousBatchSubmissionError");
});

test("only canonical typed Meta capacity envelopes authorize bounded capacity retry",async()=>{
 const {classifyMetaSubmissionFailure,MetaCapacityRejectionError}=await import("./meta-model-api.js");
 assert.ok(classifyMetaSubmissionFailure(404,JSON.stringify({error:{type:"invalid_request_error",code:"model_not_found"}})) instanceof MetaCapacityRejectionError);
 for(const code of ["server_shutting_down","service_overloaded","backend_unavailable"])assert.ok(classifyMetaSubmissionFailure(503,JSON.stringify({error:{type:"server_error",code}})) instanceof MetaCapacityRejectionError);
 for(const body of ["<html>overload</html>",JSON.stringify({error:{type:"server_error",code:"unknown"}}),JSON.stringify({error:{type:"invalid_request_error",code:"service_overloaded"}})])assert.equal(classifyMetaSubmissionFailure(503,body).name,"AmbiguousBatchSubmissionError");
});

test("pending async generation leaves exactly one synchronous Contributor slot and blocks second async creation",async()=>{
 const {synchronizeMetaReservations,createStoredMetaResponse,retrieveStoredMetaResponse}=await import("./meta-model-api.js");const original=globalThis.fetch;
 synchronizeMetaReservations({a:{status:"running",run_id:"pending-owner",external_job:{provider:"meta-responses",phase:"pending",provider_batch_id:"reserved-id"}}});
 let active=0,peak=0,posts=0;
 globalThis.fetch=async(_url,init)=>{if(init?.method==="POST"){posts++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,3));active--;return new Response('{"status":"completed","output":[]}');}return new Response('{"id":"reserved-id","status":"completed"}');};
 try{
  await assert.rejects(createStoredMetaResponse("test",{model:"meta-direct/muse-spark-1.3-contributor",messages:[]},60_000,"another-owner"),/pending/);assert.equal(posts,0);
  await Promise.all(Array.from({length:3},()=>metaChatCompletion("test",{model:"meta-direct/muse-spark-1.3-contributor",messages:[]})));assert.equal(peak,1);
  await retrieveStoredMetaResponse("test","reserved-id");synchronizeMetaReservations({});
 }finally{globalThis.fetch=original;}
});

test("paused matching-account response observation frees terminal capacity without changing operation; other cases remain held",async()=>{
 const {observePausedMetaResponse,synchronizeMetaReservations,metaAsyncBusy}=await import("./meta-model-api.js");const {accountFingerprint}=await import("./batch-provider.js");
 const paused={paused:{status:"failed" as const,run_id:"observer-owner",external_job:{provider:"meta-responses" as const,phase:"pending" as const,model:"meta-direct/muse-spark-1.3-contributor",provider_batch_id:"paused-observe-id",account_fingerprint:accountFingerprint("test")}}};
 const before=JSON.stringify(paused);synchronizeMetaReservations(paused);let gets=0;
 const live=async()=>{gets++;return {id:"paused-observe-id",status:"in_progress"};};
 assert.equal(await observePausedMetaResponse(paused,"test",live,100_000),false);assert.equal(metaAsyncBusy("another-owner"),true);
 assert.equal(await observePausedMetaResponse(paused,"test",live,100_100),false);assert.equal(gets,1);
 const unknown=async()=>({id:"paused-observe-id",status:"unknown"});assert.equal(await observePausedMetaResponse(paused,"test",unknown,130_001),false);assert.equal(metaAsyncBusy("another-owner"),true);
 const refused=async()=>{throw new Error("refused");};assert.equal(await observePausedMetaResponse(paused,"test",refused,160_002),false);assert.equal(metaAsyncBusy("another-owner"),true);
 const terminal=async()=>({id:"paused-observe-id",status:"completed"});assert.equal(await observePausedMetaResponse(paused,"wrong-account",terminal,190_003),false);assert.equal(metaAsyncBusy("another-owner"),true);
 assert.equal(await observePausedMetaResponse(paused,"test",terminal,190_003),true);synchronizeMetaReservations(paused);assert.equal(metaAsyncBusy("another-owner"),false);assert.equal(JSON.stringify(paused),before);
 const other={other:{status:"failed" as const,external_job:{provider:"openrouter" as const,phase:"pending" as const,provider_batch_id:"other-id",account_fingerprint:accountFingerprint("test")}}};assert.equal(await observePausedMetaResponse(other,"test",terminal,220_004),false);
});
test("ephemeral acknowledged ID survives unbound snapshot downgrade and can be terminally released",async()=>{
 const {createStoredMetaResponse,synchronizeMetaReservations,metaAsyncBusy,retrieveStoredMetaResponse}=await import("./meta-model-api.js");const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>init?.method==="POST"?new Response('data: {"type":"response.created","response":{"id":"ephemeral-id"}}\n\n'):new Response('{"id":"ephemeral-id","status":"completed"}');
 try{
  await createStoredMetaResponse("test",{model:"meta-direct/muse-spark-1.3-contributor",messages:[]},60_000,"ephemeral-owner");
  synchronizeMetaReservations({x:{status:"failed",run_id:"ephemeral-owner",external_job:{provider:"meta-responses",phase:"ambiguous_submission"}}});
  assert.equal(metaAsyncBusy("ephemeral-owner"),true,"must retain actual ID rather than own unbound-null reservation");
  await retrieveStoredMetaResponse("test","ephemeral-id");synchronizeMetaReservations({});assert.equal(metaAsyncBusy("another-owner"),false);
 }finally{globalThis.fetch=original;}
});
test("busy create and expired actual pre-POST lease guard are never ambiguous and issue zero POSTs",async()=>{
 const {createStoredMetaResponse,synchronizeMetaReservations}=await import("./meta-model-api.js");const {PreSubmissionError}=await import("./batch-submission-error.js");const original=globalThis.fetch;let posts=0;globalThis.fetch=async()=>{posts++;throw new Error("must not fetch");};
 try{
  synchronizeMetaReservations({x:{status:"failed",run_id:"busy-owner",external_job:{provider:"meta-responses",phase:"ambiguous_submission"}}});
  await assert.rejects(createStoredMetaResponse("test",{model:"meta-direct/muse-spark-1.3-contributor",messages:[]},60_000,"blocked-owner"),PreSubmissionError);synchronizeMetaReservations({});
  await assert.rejects(createStoredMetaResponse("test",{model:"meta-direct/muse-spark-1.3-contributor",messages:[]},60_000,"expired-owner",()=>{throw new PreSubmissionError("lease expired");}),/lease expired/);assert.equal(posts,0);
 }finally{globalThis.fetch=original;synchronizeMetaReservations({});}
});

test("healthy Meta request is byte-identical; the one internal budget override changes only the output limit", () => {
  const request = { model: "meta-direct/muse-spark-1.3-contributor", messages: [{ role: "user" as const, content: "full original image analysis" }], max_tokens: 4000 };
  const healthy = buildMetaResponsesBody(request);
  assert.equal(JSON.stringify(healthy), JSON.stringify({ model: "muse-spark-1.3-contributor", input: [{ role: "user", content: "full original image analysis" }], max_output_tokens: 20384 }));
  assert.deepEqual(buildMetaResponsesBody({ ...request, meta_max_output_tokens: 32768 }), { ...healthy, max_output_tokens: 32768 });
});
test("Meta retry budget rejects nonliteral overrides, other models, and reduction of a caller's budget before POST", () => {
  const request = { model: "meta-direct/muse-spark-1.3-contributor", messages: [], max_tokens: 4000 };
  for (const limit of [0, 20384, 32769, NaN, null, "32768"]) {
    assert.throws(() => buildMetaResponsesBody({ ...request, meta_max_output_tokens: limit } as unknown as import("./openrouter.js").ChatCompletionRequest), /Invalid Meta output-exhaustion retry budget/);
  }
  assert.throws(() => buildMetaResponsesBody({ ...request, model: "meta-direct/other", meta_max_output_tokens: 32768 }), /Invalid Meta/);
  assert.throws(() => buildMetaResponsesBody({ ...request, max_tokens: 20000, meta_max_output_tokens: 32768 }), /Invalid Meta/);
  assert.throws(() => buildMetaResponsesBody({ ...request, max_tokens: NaN, meta_max_output_tokens: 32768 }), /Invalid Meta/);
});

test("invalid stored-response budget makes zero POSTs and leaves no phantom capacity reservation", async()=>{
 const {createStoredMetaResponse,metaAsyncBusy,synchronizeMetaReservations}=await import("./meta-model-api.js");synchronizeMetaReservations({});const original=globalThis.fetch;let posts=0;
 try{globalThis.fetch=async()=>{posts++;throw new Error("Unexpected POST");};await assert.rejects(createStoredMetaResponse("fixture-key",{model:"meta-direct/muse-spark-1.3-contributor",messages:[],max_tokens:20000,meta_max_output_tokens:32768},60000,"budget-owner"),/Invalid Meta/);assert.equal(posts,0);assert.equal(metaAsyncBusy("other-owner"),false);}finally{globalThis.fetch=original;synchronizeMetaReservations({});}
});
