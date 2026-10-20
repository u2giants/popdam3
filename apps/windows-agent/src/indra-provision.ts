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
 * is missing: fast path if the venv+models are already on disk (just repair the
 * environment), full path otherwise (venv → pip → models → verify). Status is
 * reported on every heartbeat so the admin panel can show it.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

export const INDRA_ROOT = "C:\\ProgramData\\PopDAM\\indra";
export const INDRA_PYTHON = `${INDRA_ROOT}\\Scripts\\python.exe`;
export const INDRA_MODELS = `${INDRA_ROOT}\\models`;
export const INDRA_PACKAGE_SPEC = "indra-ocr==1.1.1";
export const INDRA_MODEL_REVISION = "v1.1.0";

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

export function checkIndra(): IndraStatus {
  const envPython = (process.env.INDRA_OCR_PYTHON || "").trim() || null;
  const models = (process.env.INDRA_OCR_MODEL_DIR || "").trim() || INDRA_MODELS;
  const verdict = evaluateIndra({
    envPython,
    pythonExists: envPython ? existsSync(envPython) : false,
    modelsExists: existsSync(models),
  });
  if (verdict.state === "missing" && !envPython && existsSync(INDRA_PYTHON) && existsSync(INDRA_MODELS)) {
    return {
      state: "missing",
      python: INDRA_PYTHON,
      models_dir: INDRA_MODELS,
      detail: "engine installed but INDRA_OCR_PYTHON is not set",
      checked_at: new Date().toISOString(),
    };
  }
  return {
    state: verdict.state,
    python: envPython,
    models_dir: models,
    detail: verdict.detail,
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
export function provisionPlan(systemPython: string): Array<{ step: string; file: string; args: string[]; timeoutMs: number }> {
  const modelsDownload = [
    "from huggingface_hub import snapshot_download;",
    `snapshot_download('datalab-to/indra-ocr', revision='${INDRA_MODEL_REVISION}',`,
    "allow_patterns=['*.onnx','meta.json','lm.npz','lm_*.npz'],",
    "ignore_patterns=['math*.onnx','math_meta.json','model.safetensors'],",
    `local_dir='${INDRA_MODELS.replace(/\\/g, "/")}')`,
  ].join(" ");
  return [
    { step: "venv", file: systemPython, args: ["-m", "venv", INDRA_ROOT], timeoutMs: 180_000 },
    { step: "package", file: INDRA_PYTHON, args: ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", INDRA_PACKAGE_SPEC], timeoutMs: 420_000 },
    { step: "models", file: INDRA_PYTHON, args: ["-c", modelsDownload], timeoutMs: 900_000 },
    { step: "verify", file: INDRA_PYTHON, args: ["-c", "from indra_ocr import OrtOCR; print('indra-ok')"], timeoutMs: 120_000 },
  ];
}

function failure(step: string, error: unknown): Error {
  const err = error as Error & { stderr?: string };
  const stderr = err.stderr ? `: ${String(err.stderr).slice(-400)}` : "";
  return new Error(`Indra provisioning failed at ${step}: ${err.message}${stderr}`);
}

/** Best-effort persistence so the NEXT service start still finds the engine. */
async function persistMachineEnv(): Promise<void> {
  const command =
    `[Environment]::SetEnvironmentVariable('INDRA_OCR_PYTHON','${INDRA_PYTHON}','Machine'); ` +
    `[Environment]::SetEnvironmentVariable('INDRA_OCR_MODEL_DIR','${INDRA_MODELS}','Machine')`;
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true, timeout: 30_000 });
  } catch (error) {
    // Non-fatal: this process already has the env it needs; a later install or
    // the installer can persist it. Log so the gap is visible in the log tail.
    logger.warn("Indra OCR: could not persist machine environment variables", { error: (error as Error).message });
  }
}

function activateInProcess(): void {
  process.env.INDRA_OCR_PYTHON = INDRA_PYTHON;
  process.env.INDRA_OCR_MODEL_DIR = INDRA_MODELS;
}

async function verifyInstall(): Promise<void> {
  const { stdout } = await execFileAsync(INDRA_PYTHON, ["-c", "from indra_ocr import OrtOCR; print('indra-ok')"], {
    windowsHide: true,
    timeout: 120_000,
  });
  if (!stdout.includes("indra-ok")) throw new Error("Indra import check produced no confirmation");
}

/** Provision (or repair) Indra. Resolves with the resulting status; never throws. */
export async function provisionIndra(): Promise<IndraStatus> {
  const startedAt = Date.now();
  try {
    const installed = existsSync(INDRA_PYTHON) && existsSync(INDRA_MODELS);
    if (installed) {
      logger.info("Indra OCR: engine already on disk — repairing environment only");
      activateInProcess();
      await verifyInstall();
    } else {
      const systemPython = await findSystemPython();
      if (!systemPython) {
        return {
          state: "missing",
          python: null,
          models_dir: INDRA_MODELS,
          detail: "no system Python found (install Python 3.11+ and restart the agent)",
          checked_at: new Date().toISOString(),
        };
      }
      logger.info("Indra OCR: provisioning engine", { systemPython });
      for (const { step, file, args, timeoutMs } of provisionPlan(systemPython)) {
        logger.info(`Indra OCR: ${step}…`);
        try {
          await execFileAsync(file, args, { windowsHide: true, timeout: timeoutMs });
        } catch (error) {
          throw failure(step, error);
        }
      }
      activateInProcess();
      await verifyInstall();
    }
    await persistMachineEnv();
    const status: IndraStatus = {
      state: "ready",
      python: INDRA_PYTHON,
      models_dir: INDRA_MODELS,
      detail: null,
      checked_at: new Date().toISOString(),
    };
    logger.info("Indra OCR: ready", { elapsedMs: Date.now() - startedAt });
    return status;
  } catch (error) {
    const message = (error as Error).message.slice(0, 300);
    logger.error("Indra OCR: provisioning failed — falling back to tesseract.js", { error: message });
    return {
      state: "error",
      python: existsSync(INDRA_PYTHON) ? INDRA_PYTHON : null,
      models_dir: INDRA_MODELS,
      detail: message,
      checked_at: new Date().toISOString(),
    };
  }
}
