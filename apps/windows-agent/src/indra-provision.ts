/**
 * Indra OCR provisioning for the Windows agent.
 *
 * Indra is a Python engine plus ONNX models installed OUTSIDE the shipped code
 * (same pins as scripts/windows-agent/install-service.ps1: indra-ocr 1.1.1,
 * models revision v1.1.0). The installer sets it once — OTA updates only swap
 * code — so a box installed before Indra existed, or one where the install
 * step could not run, silently degrades to tesseract.js forever.
 *
 * The agent therefore checks at startup and provisions itself when the engine
 * is missing or broken: fast path if the venv + models verify (model load),
 * full path otherwise (venv → pip → models → verify). The models directory is
 * passed to every verification process explicitly — a subprocess must never
 * depend on environment variables that only exist after it succeeds. Status is
 * reported on every heartbeat so the admin panel can show it.
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

export const INDRA_ROOT = "C:\\ProgramData\\PopDAM\\indra";
export const INDRA_PYTHON = `${INDRA_ROOT}\\Scripts\\python.exe`;
export const INDRA_MODELS = `${INDRA_ROOT}\\models`;
export const INDRA_PACKAGE_SPEC = "indra-ocr==1.1.1";
export const INDRA_MODEL_REVISION = "v1.1.0";

/** Long outputs (pip/tqdm) — execFile's default 1 MiB buffer is too small. */
const STEP_MAX_BUFFER = 32 * 1024 * 1024;

export type IndraState = "ready" | "installing" | "missing" | "error";

export interface IndraStatus {
  state: IndraState;
  python: string | null;
  models_dir: string | null;
  detail: string | null;
  checked_at: string;
}

/** Pure decision used by checkIndra() and the tests. */
export function evaluateIndra(input: {
  envPython: string | null;
  pythonExists: boolean;
  modelsExists: boolean;
}): { state: "ready" | "missing"; detail: string | null } {
  if (!input.envPython) return { state: "missing", detail: "INDRA_OCR_PYTHON is not set" };
  if (!input.pythonExists) return { state: "missing", detail: `interpreter not found: ${input.envPython}` };
  if (!input.modelsExists) return { state: "missing", detail: "models directory is missing" };
  return { state: "ready", detail: null };
}

/** Model dir: a custom INDRA_OCR_MODEL_DIR wins; otherwise the default install path. */
export function resolveModelsDir(): string {
  return (process.env.INDRA_OCR_MODEL_DIR || "").trim() || INDRA_MODELS;
}

/** Interpreter: whatever the environment already points at, else the default install path. */
export function resolvePythonPath(): string {
  return (process.env.INDRA_OCR_PYTHON || "").trim() || INDRA_PYTHON;
}

/**
 * A finished install carries meta.json and at least one real model file — a
 * directory alone proves nothing, because snapshot_download creates it before
 * the first file lands and a timed-out download would otherwise look installed.
 */
export function hasModelFiles(modelsDir: string): boolean {
  if (!existsSync(join(modelsDir, "meta.json"))) return false;
  try {
    return readdirSync(modelsDir).some(
      (name) => name.endsWith(".onnx") && statSync(join(modelsDir, name)).size > 1_000_000,
    );
  } catch {
    return false;
  }
}

export function engineLooksComplete(
  modelsDir: string = resolveModelsDir(),
  pythonPath: string = resolvePythonPath(),
): boolean {
  return existsSync(pythonPath) && hasModelFiles(modelsDir);
}

/**
 * Import AND load the model from an explicit directory. `model_dir()` alone
 * reads the environment (or the Hugging Face cache), which a fresh box does
 * not have yet — the directory must travel with the command itself.
 */
export function deepVerifyScript(modelsDir: string): string {
  return `from indra_ocr import OrtOCR; OrtOCR(r'${modelsDir.replace(/\\/g, "/")}'); print('indra-ok')`;
}

export function checkIndra(): IndraStatus {
  const envPython = (process.env.INDRA_OCR_PYTHON || "").trim() || null;
  const models = resolveModelsDir();
  const modelsComplete = hasModelFiles(models);
  const verdict = evaluateIndra({
    envPython,
    pythonExists: envPython ? existsSync(envPython) : false,
    modelsExists: modelsComplete,
  });
  const detail =
    verdict.detail === "models directory is missing" && existsSync(models)
      ? "models are incomplete (partial download)"
      : verdict.detail;
  if (!envPython && existsSync(INDRA_PYTHON) && modelsComplete) {
    return {
      state: "missing",
      python: INDRA_PYTHON,
      models_dir: models,
      detail: "engine installed but INDRA_OCR_PYTHON is not set",
      checked_at: new Date().toISOString(),
    };
  }
  return {
    state: verdict.state,
    python: envPython,
    models_dir: models,
    detail,
    checked_at: new Date().toISOString(),
  };
}

/** System python for provisioning: PATH first (skipping the Store alias stub), then common locations. */
export async function findSystemPython(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("where", ["python"], { windowsHide: true, timeout: 15_000 });
    const onPath = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !/WindowsApps/i.test(line))
      .find((line) => existsSync(line));
    if (onPath) return onPath;
  } catch {
    // `where` missing or no python on PATH — fall through to known locations.
  }
  const candidates = [
    "C:\\Program Files\\Python313\\python.exe",
    "C:\\Program Files\\Python312\\python.exe",
    "C:\\Program Files\\Python311\\python.exe",
    "C:\\Program Files (x86)\\Python311\\python.exe",
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

/** Ordered provisioning steps — pure so tests can assert the pins without touching the network. */
export function provisionPlan(
  systemPython: string,
  modelsDir: string = INDRA_MODELS,
): Array<{ step: string; file: string; args: string[]; timeoutMs: number }> {
  const modelsDownload = [
    "from huggingface_hub import snapshot_download;",
    `snapshot_download('datalab-to/indra-ocr', revision='${INDRA_MODEL_REVISION}',`,
    "allow_patterns=['*.onnx','meta.json','lm.npz','lm_*.npz'],",
    "ignore_patterns=['math*.onnx','math_meta.json','model.safetensors'],",
    `local_dir='${modelsDir.replace(/\\/g, "/")}')`,
  ].join(" ");
  return [
    { step: "venv", file: systemPython, args: ["-m", "venv", INDRA_ROOT], timeoutMs: 180_000 },
    { step: "package", file: INDRA_PYTHON, args: ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", INDRA_PACKAGE_SPEC], timeoutMs: 420_000 },
    { step: "models", file: INDRA_PYTHON, args: ["-c", modelsDownload], timeoutMs: 900_000 },
    { step: "verify", file: INDRA_PYTHON, args: ["-c", deepVerifyScript(modelsDir)], timeoutMs: 180_000 },
  ];
}

function failure(step: string, error: unknown): Error {
  const err = error as { message?: string; stderr?: unknown };
  const message = String(err?.message ?? error);
  const stderr = err?.stderr ? `: ${String(err.stderr).slice(-400)}` : "";
  return new Error(`Indra provisioning failed at ${step}: ${message}${stderr}`);
}

/** Best-effort persistence so the NEXT service start still finds the engine. */
async function persistMachineEnv(modelsDir: string): Promise<void> {
  const psString = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const command =
    `[Environment]::SetEnvironmentVariable('INDRA_OCR_PYTHON',${psString(INDRA_PYTHON)},'Machine'); ` +
    `[Environment]::SetEnvironmentVariable('INDRA_OCR_MODEL_DIR',${psString(modelsDir)},'Machine')`;
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true, timeout: 30_000 });
  } catch (error) {
    // Non-fatal: this process already has the env it needs; a later install or
    // the installer can persist it. Log so the gap is visible in the log tail.
    logger.warn("Indra OCR: could not persist machine environment variables", { error: String((error as Error)?.message ?? error) });
  }
}

/** Point the running process at an engine. `force` overwrites a stale custom path (after a full install). */
function activateInProcess(modelsDir: string, pythonPath: string, force: boolean): void {
  if (force || !process.env.INDRA_OCR_PYTHON?.trim()) process.env.INDRA_OCR_PYTHON = pythonPath;
  process.env.INDRA_OCR_MODEL_DIR = modelsDir;
}

async function verifyInstall(modelsDir: string, pythonPath: string): Promise<void> {
  if (!existsSync(pythonPath)) throw new Error(`interpreter not found: ${pythonPath}`);
  if (!hasModelFiles(modelsDir)) {
    throw new Error("Indra models are incomplete (meta.json/model files missing)");
  }
  const { stdout } = await execFileAsync(pythonPath, ["-c", deepVerifyScript(modelsDir)], {
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: STEP_MAX_BUFFER,
  });
  if (!stdout.includes("indra-ok")) throw new Error("Indra model load check produced no confirmation");
}

function errorMessage(error: unknown): string {
  return String((error as Error)?.message ?? error).slice(0, 300);
}

/** Provision (or repair) Indra. Resolves with the resulting status; never rejects. */
export async function provisionIndra(): Promise<IndraStatus> {
  const startedAt = Date.now();
  const modelsDir = resolveModelsDir();
  try {
    let needsFullInstall = !engineLooksComplete(modelsDir);
    if (!needsFullInstall) {
      try {
        const pythonPath = resolvePythonPath();
        logger.info("Indra OCR: engine already on disk — verifying before reuse", { pythonPath, modelsDir });
        activateInProcess(modelsDir, pythonPath, false);
        await verifyInstall(modelsDir, pythonPath);
      } catch (error) {
        // Present but broken (e.g. an interrupted download): reprovision —
        // snapshot_download re-fetches files whose size/hash does not match.
        logger.warn("Indra OCR: installed engine failed verification — reprovisioning", {
          error: errorMessage(error),
        });
        needsFullInstall = true;
      }
    }
    if (needsFullInstall) {
      const systemPython = await findSystemPython();
      if (!systemPython) {
        return {
          state: "missing",
          python: null,
          models_dir: modelsDir,
          detail: "no system Python found (install Python 3.11+ and restart the agent)",
          checked_at: new Date().toISOString(),
        };
      }
      logger.info("Indra OCR: provisioning engine", { systemPython, modelsDir });
      for (const { step, file, args, timeoutMs } of provisionPlan(systemPython, modelsDir)) {
        logger.info(`Indra OCR: ${step}…`);
        try {
          await execFileAsync(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: STEP_MAX_BUFFER });
        } catch (error) {
          throw failure(step, error);
        }
      }
      // Full install owns the default paths — overwrite whatever pointed at the broken engine.
      activateInProcess(modelsDir, INDRA_PYTHON, true);
      await verifyInstall(modelsDir, INDRA_PYTHON);
    }
    await persistMachineEnv(modelsDir);
    const status: IndraStatus = {
      state: "ready",
      python: resolvePythonPath(),
      models_dir: modelsDir,
      detail: null,
      checked_at: new Date().toISOString(),
    };
    logger.info("Indra OCR: ready", { elapsedMs: Date.now() - startedAt });
    return status;
  } catch (error) {
    const message = errorMessage(error);
    logger.error("Indra OCR: provisioning failed — falling back to tesseract.js", { error: message });
    return {
      state: "error",
      python: existsSync(resolvePythonPath()) ? resolvePythonPath() : null,
      models_dir: modelsDir,
      detail: message,
      checked_at: new Date().toISOString(),
    };
  }
}
