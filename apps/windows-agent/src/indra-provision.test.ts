import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INDRA_MODELS,
  INDRA_MODEL_REVISION,
  INDRA_PACKAGE_SPEC,
  INDRA_PYTHON,
  checkIndra,
  engineLooksComplete,
  evaluateIndra,
  hasModelFiles,
  provisionPlan,
} from "./indra-provision";

test("evaluateIndra reports ready only when interpreter and models are both present", () => {
  assert.deepEqual(
    evaluateIndra({ envPython: null, pythonExists: false, modelsExists: false }),
    { state: "missing", detail: "INDRA_OCR_PYTHON is not set" },
  );
  assert.equal(evaluateIndra({ envPython: "C:\\x\\python.exe", pythonExists: false, modelsExists: true }).state, "missing");
  assert.equal(evaluateIndra({ envPython: "C:\\x\\python.exe", pythonExists: true, modelsExists: false }).state, "missing");
  assert.deepEqual(
    evaluateIndra({ envPython: "C:\\x\\python.exe", pythonExists: true, modelsExists: true }),
    { state: "ready", detail: null },
  );
});

test("checkIndra reports missing when the environment variable is cleared", () => {
  const previousPython = process.env.INDRA_OCR_PYTHON;
  const previousModels = process.env.INDRA_OCR_MODEL_DIR;
  delete process.env.INDRA_OCR_PYTHON;
  delete process.env.INDRA_OCR_MODEL_DIR;
  try {
    const status = checkIndra();
    assert.equal(status.state, "missing");
    assert.match(String(status.detail), /not set|not found|missing|installed but/);
    assert.ok(!Number.isNaN(Date.parse(status.checked_at)));
  } finally {
    if (previousPython !== undefined) process.env.INDRA_OCR_PYTHON = previousPython;
    if (previousModels !== undefined) process.env.INDRA_OCR_MODEL_DIR = previousModels;
  }
});

test("provision plan pins the installer's package and model revisions", () => {
  const plan = provisionPlan("C:\\py\\python.exe");
  assert.deepEqual(plan.map((step) => step.step), ["venv", "package", "models", "verify"]);
  assert.equal(plan[0].file, "C:\\py\\python.exe");
  assert.equal(plan[0].args.join(" "), `-m venv ${INDRA_PYTHON.replace("\\Scripts\\python.exe", "")}`);
  assert.ok(plan[1].args.includes(INDRA_PACKAGE_SPEC));
  const modelsStep = plan[2].args.join(" ");
  assert.ok(modelsStep.includes("datalab-to/indra-ocr"));
  assert.ok(modelsStep.includes(INDRA_MODEL_REVISION));
  assert.ok(modelsStep.includes(INDRA_MODELS.replace(/\\/g, "/")));
  assert.equal(plan[3].file, INDRA_PYTHON);
  assert.ok(plan[3].args.join(" ").includes("from indra_ocr import OrtOCR"));
  // Every step must be bounded so a hung pip/download cannot stall startup forever.
  for (const step of plan) assert.ok(step.timeoutMs > 0 && step.timeoutMs <= 900_000);
});

test("an unfinished download never counts as a complete engine", () => {
  const dir = mkdtempSync(join(tmpdir(), "indra-models-"));
  try {
    assert.equal(hasModelFiles(dir), false, "empty directory");
    writeFileSync(join(dir, "meta.json"), "{}");
    assert.equal(hasModelFiles(dir), false, "meta.json without model data");
    writeFileSync(join(dir, "model.onnx"), Buffer.alloc(64));
    assert.equal(hasModelFiles(dir), false, "stub model file under 1MB");
    writeFileSync(join(dir, "model.onnx"), Buffer.alloc(2 * 1024 * 1024));
    assert.equal(hasModelFiles(dir), true, "meta.json plus a real model file");
    // The interpreter lives in the default install path; completeness of a
    // custom models dir therefore hinges on it existing on this machine.
    assert.equal(engineLooksComplete(dir), existsSync(INDRA_PYTHON));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("provision plan honours a custom models directory", () => {
  const plan = provisionPlan("C:\\py\\python.exe", "D:\\models\\indra");
  assert.ok(plan[2].args.join(" ").includes("D:/models/indra"));
});
