import assert from "node:assert/strict";
import test from "node:test";
import { parallelTagRun, parallelModel, parallelTrialOrder } from "./ai-tag-parallel.js";
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
  for (const concurrency of [0, 1, 9, 2.5, "6"]) assert.throws(() => parallelTagRun({...setting, concurrency}, "run", [id]));
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
