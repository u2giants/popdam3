#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  COLDLION_BASE_URL,
  readColdlionApiKey,
} from "./coldlion-sync-common.mjs";

export const COMPANY_CODE = "EDGEHOME";
export const PROD_STAGES = Object.freeze(["ISS", "INTRAN", "REC"]);
export const PAGE_SIZE = 200;
export const REQUEST_TIMEOUT_MS = 120_000;
export const REQUEST_PAUSE_MS = 3_000;
export const EMPTY_WINDOW_STOP = 52;

const DAY_MS = 86_400_000;
const PRIVATE_MARKER = ".coldlion-private-capture";

export function parseIsoDate(value, name = "date") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    throw new Error(`${name} must be YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a real calendar date`);
  }
  return date;
}

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function* backwardWindows(toDate, maxWindows = 2_000) {
  let to = parseIsoDate(toDate, "to");
  for (let number = 0; number < maxWindows; number += 1) {
    const from = new Date(to.valueOf() - 6 * DAY_MS);
    yield { number, from: isoDate(from), to: isoDate(to) };
    to = new Date(from.valueOf() - DAY_MS);
  }
}

export function historyScopes() {
  return [
    { endpoint: "orderHistory", stage: null },
    ...PROD_STAGES.map((stage) => ({ endpoint: "prodHistory", stage })),
  ];
}

export function buildPageUrl({ endpoint, stage }, window, page) {
  const url = new URL(`${COLDLION_BASE_URL}/${endpoint}`);
  url.searchParams.set("companyCode", COMPANY_CODE);
  url.searchParams.set("fromDate", window.from);
  url.searchParams.set("toDate", window.to);
  if (stage) url.searchParams.set("stageCode", stage);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(PAGE_SIZE));
  return url;
}

export function validatePage(payload, requestedPage, scope) {
  if (!payload || Array.isArray(payload) || !Array.isArray(payload.content)) {
    throw new Error(`${scope.endpoint} did not return the required paged envelope`);
  }
  for (const field of ["number", "numberOfElements", "totalElements", "totalPages", "last"]) {
    if (!(field in payload)) throw new Error(`${scope.endpoint} page is missing ${field}`);
  }
  if (payload.number !== requestedPage) {
    throw new Error(`${scope.endpoint} returned page ${payload.number} for requested page ${requestedPage}`);
  }
  if (payload.numberOfElements !== payload.content.length) {
    throw new Error(`${scope.endpoint} page count disagrees with content length`);
  }
  if (payload.size > PAGE_SIZE) {
    throw new Error(`${scope.endpoint} returned an impossible page size ${payload.size}`);
  }
  if (scope.stage) {
    const mismatch = payload.content.find((row) => String(row?.stageCode ?? "").toUpperCase() !== scope.stage);
    if (mismatch) throw new Error(`${scope.endpoint} returned a stage other than requested ${scope.stage}`);
  }
  return payload;
}

export function verifyCompletePages(pages, scope) {
  if (pages.length === 0) throw new Error(`${scope.endpoint} has no page evidence`);
  pages.forEach((page, index) => validatePage(page, index, scope));
  const lastPages = pages.filter((page) => page.last === true);
  if (lastPages.length !== 1 || pages.at(-1).last !== true) {
    throw new Error(`${scope.endpoint} does not have exactly one terminal page`);
  }
  const total = pages.reduce((sum, page) => sum + page.content.length, 0);
  const reported = pages[0].totalElements;
  if (pages.some((page) => page.totalElements !== reported)) {
    throw new Error(`${scope.endpoint} totalElements changed during one window`);
  }
  const expectedPages = Math.max(1, pages[0].totalPages);
  if (pages.length !== expectedPages || total !== reported) {
    throw new Error(`${scope.endpoint} pages are incomplete: fetched ${pages.length}/${pages[0].totalPages}, rows ${total}/${reported}`);
  }
  return { rows: total, pages: pages.length };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function withoutLastFields(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("last")));
}

export function productionDuplicateTripwire(rows) {
  const groups = new Map();
  for (const row of rows) {
    const component = row.prepackItemNo || row.itemNo || "";
    const key = `${row.prodOrderNo ?? ""}\u001f${row.prodLineSeq ?? ""}\u001f${component}`;
    const projection = canonical(withoutLastFields(row));
    const values = groups.get(key) ?? new Set();
    values.add(projection);
    groups.set(key, values);
  }
  const ambiguousGroups = [...groups.values()].filter((values) => values.size > 1).length;
  return { ambiguousGroups };
}

export function pageRelativePath(scope, window, page) {
  const scopeName = scope.stage ? `${scope.endpoint}-${scope.stage}` : scope.endpoint;
  return join(scopeName, `${window.from}_${window.to}`, `page-${String(page).padStart(5, "0")}.json`);
}

async function atomicJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, file);
}

async function readSavedPage(file, page, scope) {
  try {
    const payload = JSON.parse(await readFile(file, "utf8"));
    return validatePage(payload, page, scope);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Saved page is not valid (${file}): ${error.message}`);
  }
}

export async function fetchPage(url, apiKey, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { "X-API-Key": apiKey },
        signal: controller.signal,
      });
      const text = await response.text();
      let payload;
      try { payload = JSON.parse(text); }
      catch { throw new Error(`${url.pathname} returned non-JSON HTTP ${response.status}`); }
      if (!response.ok) {
        const message = typeof payload?.message === "string" ? `: ${payload.message}` : "";
        const error = new Error(`${url.pathname} returned wire HTTP ${response.status}${message}`);
        error.status = response.status;
        error.permanent = response.status >= 400 && response.status < 500;
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (error.permanent || attempt === 3) throw error;
      await delay(REQUEST_PAUSE_MS);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function delay(ms) {
  if (ms > 0) await new Promise((done) => setTimeout(done, ms));
}

export async function captureScope({ outputDir, scope, window, apiKey, fetchImpl = fetch, requestGate = async () => {} }) {
  const pages = [];
  for (let page = 0; ; page += 1) {
    const file = join(outputDir, pageRelativePath(scope, window, page));
    let payload = await readSavedPage(file, page, scope);
    if (!payload) {
      await requestGate();
      const url = buildPageUrl(scope, window, page);
      payload = validatePage(await fetchPage(url, apiKey, fetchImpl), page, scope);
      await atomicJson(file, payload);
    }
    pages.push(payload);
    if (payload.last === true) break;
    if (page + 1 >= payload.totalPages) {
      throw new Error(`${scope.endpoint} claimed no terminal page within totalPages`);
    }
  }
  const complete = verifyCompletePages(pages, scope);
  if (scope.endpoint === "prodHistory") {
    const tripwire = productionDuplicateTripwire(pages.flatMap((page) => page.content));
    const stageCaseMismatches = pages.flatMap((page) => page.content)
      .filter((row) => row.stageCode !== scope.stage).length;
    if (tripwire.ambiguousGroups > 0) {
      process.stderr.write(`ALERT: ${scope.endpoint} ${scope.stage} ${window.from}..${window.to} has ${tripwire.ambiguousGroups} identity group(s) differing outside last* fields; raw rows were preserved without collapse.\n`);
    }
    if (stageCaseMismatches > 0) {
      process.stderr.write(`ALERT: ${scope.endpoint} ${scope.stage} ${window.from}..${window.to} returned ${stageCaseMismatches} row(s) with non-canonical stage casing; raw values were preserved.\n`);
    }
    return { ...complete, ...tripwire, stageCaseMismatches };
  }
  return complete;
}

async function ensurePrivateOutput(outputDir, repoRoot) {
  const target = resolve(outputDir);
  const repo = resolve(repoRoot);
  if (!isAbsolute(outputDir)) throw new Error("--output-dir must be an absolute path outside the repository");
  if (target === repo || target.startsWith(`${repo}\\`) || target.startsWith(`${repo}/`)) {
    throw new Error("ColdLion row data is private; --output-dir must be outside the public repository");
  }
  await mkdir(target, { recursive: true, mode: 0o700 });
  await writeFile(join(target, PRIVATE_MARKER), "Private ColdLion source capture. Do not commit or upload.\n", { flag: "a", mode: 0o600 });
  return target;
}

export async function runCapture(options) {
  const {
    outputDir, to = isoDate(new Date()), maxWindows = 2_000,
    stopAfterEmpty = EMPTY_WINDOW_STOP, apiKey = readColdlionApiKey(),
    fetchImpl = fetch, pauseMs = REQUEST_PAUSE_MS,
    repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  } = options;
  if (!Number.isInteger(maxWindows) || maxWindows < 1) throw new Error("--max-windows must be a positive integer");
  if (!Number.isInteger(stopAfterEmpty) || stopAfterEmpty < 1) throw new Error("--stop-after-empty must be a positive integer");
  const target = await ensurePrivateOutput(outputDir, repoRoot);
  let lastRequestAt = 0;
  const requestGate = async () => {
    const remaining = pauseMs - (Date.now() - lastRequestAt);
    if (lastRequestAt && remaining > 0) await delay(remaining);
    lastRequestAt = Date.now();
  };
  let emptyWindows = 0;
  let completedWindows = 0;
  let requests = 0;
  let rows = 0;
  for (const window of backwardWindows(to, maxWindows)) {
    const scopes = [];
    for (const scope of historyScopes()) {
      const result = await captureScope({ outputDir: target, scope, window, apiKey, fetchImpl, requestGate });
      scopes.push({ ...scope, ...result });
      requests += result.pages;
      rows += result.rows;
    }
    const summary = { window, scopes, rows: scopes.reduce((sum, item) => sum + item.rows, 0), completedAt: new Date().toISOString() };
    await atomicJson(join(target, "windows", `${window.from}_${window.to}.json`), summary);
    completedWindows += 1;
    emptyWindows = summary.rows === 0 ? emptyWindows + 1 : 0;
    process.stdout.write(`${JSON.stringify({ window: `${window.from}..${window.to}`, rows: summary.rows, emptyWindows })}\n`);
    if (emptyWindows >= stopAfterEmpty) {
      const result = { completedWindows, requests, rows, stoppedAfterEmptyWindows: emptyWindows, oldestWindow: window.from };
      await atomicJson(join(target, "capture-summary.json"), result);
      return result;
    }
  }
  throw new Error(`Safety limit reached after ${maxWindows} windows before ${stopAfterEmpty} consecutive empty windows`);
}

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!["--output-dir", "--to", "--max-windows", "--stop-after-empty"].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (!argv[i + 1]) throw new Error(`${arg} requires a value`);
    values[arg.slice(2)] = argv[++i];
  }
  if (!values["output-dir"]) throw new Error("--output-dir is required");
  return {
    outputDir: values["output-dir"],
    to: values.to,
    maxWindows: values["max-windows"] ? Number(values["max-windows"]) : undefined,
    stopAfterEmpty: values["stop-after-empty"] ? Number(values["stop-after-empty"]) : undefined,
  };
}

async function main() {
  const result = await runCapture(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ complete: true, ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`ColdLion history capture failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
