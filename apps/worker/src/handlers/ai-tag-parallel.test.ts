import assert from "node:assert/strict";
import test from "node:test";
import { parallelTagRun, parallelModel, parallelTrialOrder } from "./ai-tag-parallel.js";
import { handleBulkAiTag } from "./ai-tagging.js";
import { retryStatementTimeout } from "./ai-tagging.js";
const id = "123e4567-e89b-42d3-a456-426614174000";
const setting = { run_id: "run", models: ["openai/gpt-6-luna", "qwen/qwen3.8-flash", "google/gemini-2.5-flash"], concurrency: 6 };
test("parallel distribution is opt-in and limited to its exact explicit-ID run", () => {
  assert.equal(parallelTagRun(null, "run", [id]), null);
  assert.equal(parallelTagRun(setting, "other", [id]), null);
  assert.throws(() => parallelTagRun(setting, "run", null));
  assert.throws(() => parallelTagRun(setting, "run", [id, id]));
  assert.ok(parallelTagRun(setting, "run", [id]));
});
test("invalid provider routes and concurrency fail closed", () => {
  for (const model of ["meta-direct/muse", "google-direct/gemini:batch", "google/gemini:batch", "", "scaledown/foo"]) assert.throws(() => parallelTagRun({...setting, models: [model, "openai/gpt-6-luna"]}, "run", [id]));
  for (const concurrency of [0, 1, 33, 2.5, "6"]) assert.throws(() => parallelTagRun({...setting, concurrency}, "run", [id]));
});
test("asset assignment is stable across page boundaries and covers every model", () => {
  const run = parallelTagRun(setting, "run", [id])!;
  const ids = Array.from({length: 100}, (_, i) => `123e4567-e89b-42d3-a456-${String(i).padStart(12,"0")}`);
  const assignments = ids.map(id => parallelModel(run, id));
  const reordered = [...ids].reverse().slice(0, 50);
  const otherPage = parallelTagRun({...setting, concurrency: 2, max_cursor: 12}, "run", reordered)!;
  for (const target of reordered) assert.equal(parallelModel(otherPage, target), assignments[ids.indexOf(target)]);
  assert.equal(new Set(assignments).size, 3);
});

test("disabled config is non-null JSON and cannot start a parallel operation", () => {
  assert.equal(parallelTagRun({enabled:false}, "run", [id]), null);
});
test("trial explicitly covers every model and keeps the exact unique full scope", () => {
  const ids=Array.from({length:100}, (_,i)=>`123e4567-e89b-42d3-a456-${String(i).padStart(12,"0")}`);
  const run=parallelTagRun(setting,"run",ids)!;
  const ordered=parallelTrialOrder(run,ids);
  assert.equal(new Set(ordered.slice(0,12).map(id=>parallelModel(run,id))).size,3);
  assert.equal(new Set(ordered).size,ids.length);assert.deepEqual([...ordered].sort(),[...ids].sort());
  assert.throws(()=>parallelTrialOrder(run,[ids[0]],1));
  assert.throws(()=>parallelTrialOrder(run,Array(20).fill(ids[0])));
});

test("single-model forced run is valid and keeps exact-run identity", () => {
  const single = {run_id: "run", models: ["z-ai/glm-5.3-flash"], concurrency: 20, force: true};
  const run = parallelTagRun(single, "run", [id])!;
  assert.equal(run.force, true);
  assert.equal(parallelModel(run, id), "z-ai/glm-5.3-flash");
  assert.equal(parallelTagRun({...single, force: undefined}, "run", [id])!.force, undefined);
  assert.throws(() => parallelTagRun({...single, force: "yes"}, "run", [id]));
  assert.throws(() => parallelTagRun({...single, models: []}, "run", [id]));
});

test("tag save retries only statement timeouts, within its bound", async () => {
  const run = async (codes: Array<string | null>) => {
    let calls = 0;
    const result = await retryStatementTimeout(async () => { const code = codes[Math.min(calls++, codes.length - 1)]; return { error: code ? { code } : null }; }, [0, 0, 0]);
    return { calls, code: result.error?.code ?? null };
  };
  assert.deepEqual(await run(["57014", null]), { calls: 2, code: null });
  assert.deepEqual(await run(["23505"]), { calls: 1, code: "23505" });
  assert.deepEqual(await run(["57014"]), { calls: 4, code: "57014" });
});

test("a whole-library run needs no explicit IDs, only its discover flag", () => {
  const run = parallelTagRun({run_id:"r",models:["z-ai/glm-5.3-flash"],concurrency:8,force:true,discover:true},"r",undefined);
  assert.equal(run?.discover,true);assert.equal(run?.concurrency,8);
  assert.throws(()=>parallelTagRun({run_id:"r",models:["z-ai/glm-5.3-flash"],concurrency:8},"r",undefined));
});

test("a whole-library run tags a candidate page instead of demanding asset IDs", async () => {
  const seen: Array<[string, string | undefined]> = [];
  const rows = Array.from({length: 8}, (_, i) => ({id: `00000000-0000-4000-8000-00000000000${i}`, thumbnail_url: "u", filename: "f", relative_path: "p", style_group_id: null, primary_sort_tier: 1}));
  const limits: number[] = [];
  const result = await handleBulkAiTag({status: "running", run_id: "r", cursor: 0, params: {}} as never, true, {
    parallelConfig: {run_id: "r", models: ["z-ai/glm-5.3-flash"], concurrency: 8, force: true, discover: true},
    client: {rpc: async (_: string, args: {p_limit: number}) => { limits.push(args.p_limit); return {data: rows, error: null}; }} as never,
    tagAsset: async (id: string, _force: boolean, model?: string) => { seen.push([id, model]); return {outcome: "tagged"}; },
  } as never, true, true);
  assert.equal(result.ok, true);
  assert.equal(result.tagged, 8);
  assert.deepEqual(limits, [8]);
  assert.ok(seen.every(([, model]) => model === "z-ai/glm-5.3-flash"));
});
