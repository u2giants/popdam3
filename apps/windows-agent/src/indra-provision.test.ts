import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INDRA_MODELS,
  INDRA_MODEL_REVISION,
  INDRA_PACKAGE_SPEC,
  INDRA_PYTHON,
  acquireProvisionLock,
  defaultPidAlive,
  LOCK_STALE_MS,
  LOCK_WAIT_MS,
  removeLockIfUnchanged,
  beginProvisioningStatus,
  checkIndra,
  deepVerifyScript,
  engineLooksComplete,
  evaluateIndra,
  hasModelFiles,
  isProvisionLockStale,
  parseProvisionLock,
  powerShellString,
  provisionPlan,
  pythonString,
  type IndraStatus,
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

test("the verify step targets the provisioned models directory, not the environment", () => {
  const plan = provisionPlan("C:\\py\\python.exe", "D:\\models\\indra");
  const verifyCommand = plan[3].args.join(" ");
  assert.ok(verifyCommand.includes("from indra_ocr import OrtOCR"));
  assert.ok(verifyCommand.includes("D:/models/indra"), "verify must name the directory it just downloaded");
  assert.ok(!verifyCommand.includes("model_dir()"), "model_dir() reads the environment, which is unset on first install");
});

test("python/PowerShell sources embed paths safely, including quotes", () => {
  // JSON string syntax is valid Python and keeps ', ", and newlines inert.
  assert.equal(pythonString("D:/models/indra"), '"D:/models/indra"');
  assert.equal(pythonString("D:/in'dra"), '"D:/in\'dra"');
  assert.equal(pythonString('D:/in"dra'), '"D:/in\\"dra"');
  const script = deepVerifyScript("D:\\models\\in'dra");
  assert.ok(script.includes(`"D:/models/in'dra"`), `verify script must quote the path as a Python string: ${script}`);
  assert.ok(!script.includes("r'"), "raw single-quoted interpolation must not be used");
  // PowerShell single-quoted strings escape ' by doubling.
  assert.equal(powerShellString("C:\\in'dra"), "'C:\\in''dra'");
  const plan = provisionPlan("C:\\py\\python.exe", "D:\\in'dra");
  assert.ok(plan[2].args.join(" ").includes(`"D:/in'dra"`), "models step must embed the path as a Python string");
});

test("beginProvisioningStatus reports installing for the whole provisioning window", () => {
  const ready: IndraStatus = {
    state: "ready",
    python: "C:\\py\\python.exe",
    models_dir: "D:\\models",
    detail: null,
    checked_at: "2026-01-01T00:00:00.000Z",
  };
  const fromReady = beginProvisioningStatus(ready);
  assert.equal(fromReady.state, "installing");
  assert.equal(fromReady.detail, "verifying", "a ready-looking engine is still under verification");
  assert.notEqual(fromReady.checked_at, ready.checked_at);

  const missing: IndraStatus = {
    state: "missing",
    python: null,
    models_dir: "D:\\models",
    detail: "models directory is missing",
    checked_at: "2026-01-01T00:00:00.000Z",
  };
  const fromMissing = beginProvisioningStatus(missing);
  assert.equal(fromMissing.state, "installing");
  assert.equal(fromMissing.detail, "models directory is missing", "keeps the reason provisioning started");
});

test("provision lock is exclusive and releaseable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "indra-lock-"));
  const lockPath = join(dir, "indra.provision.lock");
  try {
    const release = await acquireProvisionLock({ lockPath, waitMs: 500, pollMs: 10 });
    assert.ok(existsSync(lockPath), "lock file must exist while held");
    const info = parseProvisionLock(readFileSync(lockPath, "utf8"));
    assert.equal(info?.pid, process.pid);
    release();
    assert.ok(!existsSync(lockPath), "release must remove the lock file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a live holder is respected; a stale holder is stolen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "indra-lock-"));
  const lockPath = join(dir, "indra.provision.lock");
  try {
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }));
    await assert.rejects(
      () => acquireProvisionLock({ lockPath, waitMs: 100, pollMs: 10, staleMs: 60_000, pidAlive: () => true }),
      /lock is held/i,
      "a live lock must not be taken over",
    );

    writeFileSync(lockPath, JSON.stringify({ pid: 999_999, at: Date.now() - 10 * 60_000 }));
    const release = await acquireProvisionLock({ lockPath, waitMs: 200, pollMs: 10, staleMs: 60_000, pidAlive: () => false });
    assert.ok(existsSync(lockPath), "steal must leave this process as holder");
    const info = parseProvisionLock(readFileSync(lockPath, "utf8"));
    assert.equal(info?.pid, process.pid);
    release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lock staleness: age beats a live pid, a dead pid beats the grace window", () => {
  const now = 1_000_000_000_000;
  assert.equal(isProvisionLockStale(null, now, { pidAlive: () => true }), true, "unparseable lock is stale");
  assert.equal(isProvisionLockStale({ pid: 1, at: now }, now, { staleMs: 1000, pidAlive: () => true }), false);
  assert.equal(isProvisionLockStale({ pid: 1, at: now - 2000 }, now, { staleMs: 1000, pidAlive: () => true }), true, "older than staleMs");
  assert.equal(
    isProvisionLockStale({ pid: 1, at: now - 60_000 }, now, { staleMs: 45 * 60_000, pidAlive: () => false }),
    true,
    "dead pid past the grace window",
  );
  assert.equal(
    isProvisionLockStale({ pid: 1, at: now - 1000 }, now, { staleMs: 45 * 60_000, pidAlive: () => false }),
    false,
    "dead pid inside the grace window is left alone (holder may be starting up)",
  );
});

test("stale-steal never destroys a lock that changed after it was read (TOCTOU)", () => {
  const dir = mkdtempSync(join(tmpdir(), "indra-lock-"));
  const lockPath = join(dir, "indra.provision.lock");
  try {
    const staleRaw = JSON.stringify({ pid: 1, at: 0 });
    const freshRaw = JSON.stringify({ pid: 2, at: Date.now(), token: "fresh" });
    writeFileSync(lockPath, freshRaw); // another process stole and re-created it
    assert.equal(removeLockIfUnchanged(lockPath, staleRaw), false);
    assert.equal(readFileSync(lockPath, "utf8"), freshRaw, "the fresh lock must survive");
    assert.equal(removeLockIfUnchanged(lockPath, freshRaw), true);
    assert.ok(!existsSync(lockPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release does not remove a lock now held by someone else", async () => {
  const dir = mkdtempSync(join(tmpdir(), "indra-lock-"));
  const lockPath = join(dir, "indra.provision.lock");
  try {
    const release = await acquireProvisionLock({ lockPath, waitMs: 200, pollMs: 10 });
    const other = JSON.stringify({ pid: 2, at: Date.now(), token: "other" });
    writeFileSync(lockPath, other);
    release();
    assert.equal(readFileSync(lockPath, "utf8"), other);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("EPERM from kill(pid, 0) means a live foreign-user process", (t) => {
  t.mock.method(process, "kill", () => {
    throw Object.assign(new Error("EPERM"), { code: "EPERM" });
  });
  assert.equal(defaultPidAlive(4242), true);
  t.mock.method(process, "kill", () => {
    throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
  });
  assert.equal(defaultPidAlive(4242), false);
});

test("a waiter outlasts the stale window", () => {
  assert.ok(LOCK_WAIT_MS > LOCK_STALE_MS);
});
