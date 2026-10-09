import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  BASELINE_EVIDENCE,
  createGeneratedTypesProof,
  createLiveProof,
  FRONTEND_BUILD_PATHS,
  PRODUCTION_ORIGIN,
  PRODUCTION_PROJECT,
  selectAuthenticatedReadHeaders,
  shouldBlockSupabaseRequest,
  validateFindCandidate,
  validateCommitInputs,
  validateBaselineEvidence,
  validateBuildBinding,
} from "./orderlist-integration-proof-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = process.env.ORDERLIST_PROOF_OUTPUT_DIR;
const productionUrl = PRODUCTION_ORIGIN;
const projectHost = `${PRODUCTION_PROJECT}.supabase.co`;
const watchedEndpoints = new Set([
  "dam_order_list", "get_dam_order_tracking", "dam_order_sample_depth",
  "dam_order_customer_settings", "dam_order_vendor_statistics",
  "style_tracker_rows_with_bridge", "get_dam_style_tracker_license_status",
  "find_dam_order_list_row",
]);
const checkLabels = [];
let stage = "startup";

function assert(condition, label) {
  checkLabels.push(label);
  if (!condition) throw new Error(`acceptance check failed: ${label}`);
}

function runGitBoolean(args) {
  try {
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch (error) {
    if (error?.status === 1) return false;
    throw new Error("git build-source validation failed unexpectedly");
  }
}

function preflight() {
  const workflowSha = process.env.GITHUB_SHA ?? "";
  const deployedFrontendSha = process.env.DEPLOYED_FRONTEND_SHA ?? "";
  const ref = process.env.GITHUB_REF ?? "";
  validateCommitInputs({ ref, workflowSha, deployedFrontendSha });
  const isAncestor = runGitBoolean(["merge-base", "--is-ancestor", deployedFrontendSha, workflowSha]);
  const frontendTreeEqual = runGitBoolean(["diff", "--quiet", deployedFrontendSha, workflowSha, "--", ...FRONTEND_BUILD_PATHS]);
  const binding = validateBuildBinding({ ref, workflowSha, deployedFrontendSha, isAncestor, frontendTreeEqual });
  process.stdout.write(`PROOF_WORKFLOW_SHA=${binding.workflowSha}\nPROOF_FRONTEND_SHA=${binding.deployedFrontendSha}\nPROOF_BUILD_TOKEN=${binding.buildToken}\n`);
}

function validateDatabaseTarget() {
  if (process.env.SUPABASE_PROJECT_ID !== PRODUCTION_PROJECT) throw new Error("configured Supabase project is not the required production project");
  if (process.env.SUPABASE_URL && process.env.SUPABASE_URL.replace(/\/$/, "") !== `https://${projectHost}`) throw new Error("configured Supabase URL is not the required production project");
}

function verifyProject() {
  validateDatabaseTarget();
  process.stdout.write("PRODUCTION_PROJECT_VERIFIED\n");
}

async function verifyTypes() {
  validateDatabaseTarget();
  const typePath = process.env.GENERATED_TYPES_PATH;
  const proofPath = process.env.GENERATED_TYPES_PROOF_PATH;
  const sha = process.env.GITHUB_SHA ?? "";
  if (!typePath || !proofPath || !/^[0-9a-f]{40}$/i.test(sha)) throw new Error("generated-types proof paths or exact workflow SHA are missing");
  const source = await readFile(typePath, "utf8");
  const proof = createGeneratedTypesProof({ source, applicationCommitSha: sha });
  await mkdir(dirname(proofPath), { recursive: true, mode: 0o700 });
  await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`PASS: production generated types verified; sha256=${proof.generated_types_sha256}\n`);
}

async function verifyBaselineEvidence() {
  const evidencePath = process.env.BASELINE_EVIDENCE_PATH;
  if (!evidencePath) throw new Error("baseline evidence output path is missing");
  const apiBase = process.env.GITHUB_API_URL ?? "https://api.github.com";
  if (apiBase !== "https://api.github.com") throw new Error("GitHub baseline evidence must use the verified public API origin");
  // popcre/shared-db and these immutable Actions records are public; anonymous access avoids relying on a cross-repository token.
  const request = async (path) => {
    const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
    const response = await fetch(`${apiBase}${path}`, { headers });
    if (!response.ok) throw new Error(`GitHub baseline evidence lookup failed (${response.status})`);
    return response.json();
  };
  const repository = BASELINE_EVIDENCE.repository;
  const lookup = async (kind) => {
    const expected = BASELINE_EVIDENCE[kind];
    const [run, artifact, comment] = await Promise.all([
      request(`/repos/${repository}/actions/runs/${expected.runId}`),
      request(`/repos/${repository}/actions/artifacts/${expected.artifactId}`),
      request(`/repos/${repository}/issues/comments/${expected.commentId}`),
    ]);
    return { run, artifact, comment };
  };
  const [preview, production] = await Promise.all([lookup("preview"), lookup("production")]);
  const evidence = { repository, head_sha: BASELINE_EVIDENCE.headSha, preview, production };
  const proofFields = validateBaselineEvidence(evidence);
  await mkdir(dirname(evidencePath), { recursive: true, mode: 0o700 });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`PASS: immutable preview/production evidence verified; preview_run=${proofFields.preview_run_id}; production_run=${proofFields.production_run_id}\n`);
}

function rows(value) { return Array.isArray(value) ? value : []; }
function shown(value) { return value == null || value === "" ? "Unknown" : String(value); }
function dataCellValue(value) { return value == null || value === "" ? "Unknown" : String(value); }

function watchApi(page) {
  const events = [];
  page.on("response", (response) => {
    let url;
    try { url = new URL(response.url()); } catch { return; }
    if (url.hostname !== projectHost || !url.pathname.startsWith("/rest/v1/")) return;
    const endpoint = url.pathname.split("/").at(-1);
    if (!watchedEndpoints.has(endpoint)) return;
    const request = response.request();
    if (endpoint === "dam_order_list") {
      if (request.method() !== "GET") return;
      const preference = request.headers()["prefer"]?.toLowerCase() ?? "";
      const select = url.searchParams.get("select") ?? "";
      if (preference.includes("count=") || select === "order_line_id") return;
    }
    events.push({ endpoint, status: response.status(), request, json: response.json().catch(() => null) });
  });
  async function waitFor(endpoint, predicate, start = 0, timeoutMs = 25_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const event of events.slice(start).filter((entry) => entry.endpoint === endpoint).reverse()) {
        const data = await event.json;
        if (event.status >= 200 && event.status < 300 && predicate(data)) return { data, event };
      }
      await page.waitForTimeout(100);
    }
    const error = new Error(`timed out waiting for authenticated ${endpoint} response`);
    error.name = "ResponseTimeoutError";
    throw error;
  }
  async function boundedOrderRow(rowId) {
    for (const event of [...events].reverse().filter((entry) => entry.endpoint === "dam_order_list" && entry.status >= 200 && entry.status < 300)) {
      const data = rows(await event.json);
      if (data.length <= 500) {
        const found = data.find((row) => row?.order_line_id === rowId);
        if (found) return found;
      }
    }
    return undefined;
  }
  return { events, waitFor, boundedOrderRow };
}

async function fetchOrderListCandidate(session, filters, label) {
  const { page, api } = session;
  const event = [...api.events].reverse().find((entry) => entry.endpoint === "dam_order_list");
  if (!event) throw new Error(`${label}: no authenticated OrderList request is available`);
  const requestHeaders = await event.request.allHeaders();
  const headers = selectAuthenticatedReadHeaders(requestHeaders);
  const params = new URLSearchParams({
    select: "order_line_id,production_order_number,sku,sku_normalized,item_id,item_description,item_name,master_data_match_status,master_data_license_status,snapshot_license_status,snapshot_description",
    limit: "25",
    ...filters,
  });
  const url = new URL(`/rest/v1/dam_order_list?${params}`, `https://${projectHost}`);
  const response = await page.request.get(url.href, { headers, timeout: 15_000 });
  if (!response.ok()) throw new Error(`${label}: authenticated bounded OrderList candidate query failed (${response.status()})`);
  const data = rows(await response.json());
  if (!data.length || data.length > 25) throw new Error(`${label}: bounded query did not return existing rows within its limit`);
  return data;
}

async function findAndRevealOrderRow(page, api, search, label) {
  if (typeof search !== "string" || !search.trim()) throw new Error(`${label}: search term is empty`);
  const start = api.events.length;
  await page.getByLabel("Find in orders").fill(search);
  const result = await api.waitFor("find_dam_order_list_row", (data) => rows(data).some((entry) => entry?.order_line_id && Number.isSafeInteger(entry?.row_index)), start, 8_000);
  const candidateRows = rows(result.data);
  const candidate = candidateRows.find((entry) => entry?.order_line_id && Number.isSafeInteger(entry?.row_index));
  if (!candidate || result.event.request.method() !== "POST" || result.event.request.postDataJSON()?.p_search !== search) throw new Error(`${label}: Find RPC evidence does not match the submitted search`);
  const cached = await api.boundedOrderRow(candidate.order_line_id);
  const selected = validateFindCandidate({ candidateRows, expectedRowId: candidate.order_line_id, boundedRowIds: cached ? [candidate.order_line_id] : [] });
  let actual = cached;
  if (!actual) {
    const fetched = await api.waitFor("dam_order_list", (data) => rows(data).length <= 500 && rows(data).some((entry) => entry?.order_line_id === selected.orderLineId), start);
    actual = rows(fetched.data).find((entry) => entry?.order_line_id === selected.orderLineId);
  }
  if (!actual || actual.order_line_id !== selected.orderLineId) throw new Error(`${label}: Find RPC row lacks bounded authenticated data`);
  const proven = validateFindCandidate({ candidateRows, expectedRowId: selected.orderLineId, boundedRowIds: [actual.order_line_id] });
  if (!proven.hasBoundedRowEvidence) throw new Error(`${label}: Find RPC row is not backed by bounded API data`);
  const gridRow = await revealOrderRow(page, actual);
  if (await gridRow.getAttribute("row-id") !== selected.orderLineId) throw new Error(`${label}: visible grid row differs from Find RPC identity`);
  return { row: actual, gridRow, rowIndex: selected.rowIndex };
}

async function findSemanticOrderRow(page, api, candidates, predicate, label) {
  const terms = [...new Set(candidates.flatMap((row) => [row?.production_order_number, row?.sku_normalized, row?.sku]).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))].slice(0, 10);
  for (const term of terms) {
    try {
      const result = await findAndRevealOrderRow(page, api, term, label);
      if (predicate(result.row)) return result;
    } catch (error) {
      if (error?.name !== "ResponseTimeoutError") throw error;
    }
  }
  throw new Error(`${label}: bounded Find candidates did not resolve a row with the required current semantics`);
}

async function installWriteBlock(context, forbiddenWrites) {
  await context.route((url) => url.hostname === projectHost && url.pathname.startsWith("/rest/v1/"), async (route) => {
    const url = new URL(route.request().url());
    const request = route.request();
    let body;
    if (request.method() === "POST" && url.pathname === "/rest/v1/rpc/search_style_tracker_link_candidates") {
      try { body = request.postDataJSON(); } catch { body = undefined; }
    }
    if (shouldBlockSupabaseRequest({ host: url.hostname, path: url.pathname, method: request.method(), body })) {
      forbiddenWrites.push(`${request.method()} ${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

async function login(chromium, email, password, role) {
  const context = await chromium.newContext({ viewport: { width: 1600, height: 1000 } });
  const forbiddenWrites = [];
  await installWriteBlock(context, forbiddenWrites);
  const page = await context.newPage();
  const api = watchApi(page);
  await page.goto(new URL("/login", productionUrl).href, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 30_000 });
  const deployedSha = process.env.DEPLOYED_FRONTEND_SHA;
  await page.waitForFunction((sha) => [...document.querySelectorAll("header span.font-mono")].some((element) => {
    const token = element.textContent?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    return /^[0-9a-f]{7,40}$/.test(token) && sha.startsWith(token);
  }), deployedSha.toLowerCase(), { timeout: 20_000 });
  const stamps = (await page.locator("header span.font-mono").allInnerTexts()).map((text) => text.trim().split(/\s+/)[0]);
  const observedBuildStamp = stamps.map((stamp) => stamp.toLowerCase()).find((stamp) => /^[0-9a-f]{7,40}$/.test(stamp) && deployedSha.toLowerCase().startsWith(stamp));
  assert(Boolean(observedBuildStamp), `${role} sees a valid deployed frontend build stamp`);
  assert(await page.getByText(/Connected to a non-production database/).count() === 0, `${role} sees no nonproduction banner`);
  return { context, page, api, role, forbiddenWrites, observedBuildStamp };
}

async function revealHorizontally(page, target) {
  const viewport = page.locator(".ag-body-horizontal-scroll-viewport").first();
  await viewport.waitFor();
  const size = await viewport.evaluate((element) => ({ width: element.clientWidth, total: element.scrollWidth }));
  const maxSteps = Math.min(60, Math.ceil(Math.max(0, size.total - size.width) / Math.max(1, size.width * 0.65)) + 2);
  for (let step = 0; step <= maxSteps; step += 1) {
    const targetBox = await target.boundingBox().catch(() => null);
    const viewportBox = await viewport.boundingBox();
    if (targetBox && viewportBox && targetBox.x >= viewportBox.x && targetBox.x + targetBox.width <= viewportBox.x + viewportBox.width) return true;
    const current = await viewport.evaluate((element) => element.scrollLeft);
    const max = await viewport.evaluate((element) => element.scrollWidth - element.clientWidth);
    if (current >= max) break;
    await viewport.evaluate((element) => { element.scrollLeft = Math.min(element.scrollWidth - element.clientWidth, element.scrollLeft + element.clientWidth * 0.65); });
    await page.waitForTimeout(100);
  }
  return false;
}

async function revealOrderRow(page, row) {
  const target = page.locator(`.ag-center-cols-container .ag-row[row-id="${row.order_line_id}"]`);
  await target.waitFor({ timeout: 20_000 });
  const viewport = page.locator(".ag-body-viewport").first();
  await viewport.waitFor();
  const dims = await viewport.evaluate((element) => ({ height: element.clientHeight, max: element.scrollHeight - element.clientHeight }));
  const maxSteps = Math.min(80, Math.ceil(Math.max(0, dims.max) / Math.max(1, dims.height * 0.7)) + 2);
  for (let step = 0; step <= maxSteps; step += 1) {
    const rowBox = await target.boundingBox().catch(() => null);
    const viewportBox = await viewport.boundingBox();
    if (rowBox && viewportBox && rowBox.y >= viewportBox.y && rowBox.y + rowBox.height <= viewportBox.y + viewportBox.height) return target;
    const current = await viewport.evaluate((element) => element.scrollTop);
    const max = await viewport.evaluate((element) => element.scrollHeight - element.clientHeight);
    if (current >= max) break;
    await viewport.evaluate((element) => { element.scrollTop = Math.min(element.scrollHeight - element.clientHeight, element.scrollTop + element.clientHeight * 0.7); });
    await page.waitForTimeout(100);
  }
  throw new Error("selected bounded OrderList row could not be brought into view");
}

async function checkOrderList(role, session) {
  const { page, api } = session;
  stage = `${role}: OrderList current link and description`;
  const start = api.events.length;
  await page.goto(new URL("/orders", productionUrl).href);
  const response = await api.waitFor("dam_order_list", (data) => rows(data).length > 0, start);
  const resultRows = rows(response.data);
  assert(resultRows.length <= 500, `${role} OrderList response stays within its bounded block`);
  const linkedHints = resultRows.filter((row) => row?.order_line_id && row?.production_order_number && row.item_id && (row.item_description || row.item_name) && ["matched", "manual"].includes(row.master_data_match_status));
  assert(linkedHints.length > 0, `${role} bounded OrderList page contains linked Item Master candidates`);
  const linkedResult = await findSemanticOrderRow(page, api, linkedHints, (row) => row?.item_id && (row.item_description || row.item_name) && ["matched", "manual"].includes(row.master_data_match_status), `${role} linked current Item Master row`);
  const linked = linkedResult.row;
  const gridRow = linkedResult.gridRow;
  assert(linked.item_id && (linked.item_description || linked.item_name), `${role} Find-selected row retains canonical Item Master identity and description`);
  const descriptionHeader = page.locator('.ag-header-cell[col-id="master_data_description"] .ag-header-cell-text');
  assert(await revealHorizontally(page, descriptionHeader), `${role} reveals current Master Data description column`);
  const descriptionCell = gridRow.locator('.ag-cell[col-id="master_data_description"]');
  assert(await revealHorizontally(page, descriptionCell), `${role} reveals same-row current Item Master description`);
  const expectedDescription = String(linked.item_description || linked.item_name);
  assert((await descriptionCell.innerText()).trim() === expectedDescription, `${role} current OrderList description matches the linked API record`);
  stage = `${role}: current Unknown distinct from imported history`;
  const unknownCandidates = await fetchOrderListCandidate(session, {
    item_id: "not.is.null",
    master_data_license_status: "is.null",
    snapshot_license_status: "not.is.null",
  }, `${role} current Unknown`);
  const unknownResult = await findSemanticOrderRow(page, api, unknownCandidates, (row) => Boolean(row?.item_id) && row.master_data_license_status == null && row.snapshot_license_status != null, `${role} linked current Unknown row`);
  const unknown = unknownResult.row;
  const unknownGridRow = unknownResult.gridRow;
  assert(unknown.item_id && unknown.master_data_license_status == null && unknown.snapshot_license_status != null, `${role} Find-selected row keeps current Unknown separate from imported status`);
  const currentCell = unknownGridRow.locator('.ag-cell[col-id="master_data_license_status"]');
  assert(await revealHorizontally(page, currentCell), `${role} reveals current workflow cell for linked unknown`);
  assert((await currentCell.innerText()).trim() === "Unknown", `${role} current linked workflow remains Unknown`);

  stage = `${role}: unlinked import snapshot label`;
  const snapshotCandidates = await fetchOrderListCandidate(session, {
    item_id: "is.null",
    snapshot_description: "not.is.null",
  }, `${role} unlinked snapshot`);
  const snapshotResult = await findSemanticOrderRow(page, api, snapshotCandidates, (row) => !row?.item_id && Boolean(row?.snapshot_description), `${role} unlinked snapshot row`);
  const snapshot = snapshotResult.row;
  const snapshotGridRow = snapshotResult.gridRow;
  assert(!snapshot.item_id && snapshot.snapshot_description, `${role} Find-selected row remains an unlinked historical snapshot`);
  const snapshotCell = snapshotGridRow.locator('.ag-cell[col-id="master_data_description"]');
  assert(await revealHorizontally(page, snapshotCell), `${role} reveals unlinked snapshot description`);
  const snapshotText = (await snapshotCell.innerText()).trim();
  assert(snapshotText.toLowerCase().includes("at import"), `${role} unlinked historical description is marked at import`);
  assert(snapshotText.replace(/at import/i, "").trim() === snapshot.snapshot_description, `${role} unlinked snapshot description matches the same API row`);
  return resultRows;
}

async function checkTracking(role, session) {
  const { page, api } = session;
  stage = `${role}: tracking`;
  await page.goto(new URL("/orders", productionUrl).href);
  const start = api.events.length;
  await page.getByRole("button", { name: "PO Tracking", exact: true }).click();
  const received = await api.waitFor("get_dam_order_tracking", (data) => rows(data).length > 0, start);
  const pageRows = rows(received.data);
  const body = received.event.request.postDataJSON();
  assert(pageRows.length <= 50 && Number(body?.p_limit) <= 50 && Number(body?.p_limit) > 0, `${role} tracking query is authenticated and capped at 50 rows`);
  assert(received.event.request.headers()["authorization"]?.startsWith("Bearer "), `${role} tracking request includes a signed-in bearer token`);
  const record = pageRows.find((row) => row.order_id && row.production_order_number);
  assert(Boolean(record), `${role} tracking response includes an existing purchase order`);
  const row = page.getByRole("button", { name: String(record.production_order_number), exact: true });
  await row.waitFor();
  const tr = row.locator("xpath=ancestor::tr");
  assert(await tr.count() === 1, `${role} tracking PO is visible in the same authenticated result`);
  assert((await tr.innerText()).includes(shown(record.vendor_name)), `${role} visible tracking vendor matches same API row`);
  if (role === "Administrator") {
    assert(await tr.getByRole("button", { name: "Edit", exact: true }).count() === 1, "Administrator sees the tracking editor control");
    await tr.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Edit PO tracking", exact: true }).click();
    for (const field of ["PO sent date", "MBL", "Close tracking", "CBM", "Comment", "Invoice", "Payment note"]) assert(await page.getByLabel(field, { exact: true }).count() > 0, `Administrator can open tracking field ${field}`);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
  } else {
    assert(await tr.getByRole("button", { name: "Edit", exact: true }).count() === 0, "Viewer has no tracking edit control");
  }
}

async function checkSettingsAndVendors(role, session) {
  const { page, api } = session;
  stage = `${role}: sample settings`;
  await page.goto(new URL("/orders", productionUrl).href);
  const depthStart = api.events.length;
  await page.getByRole("button", { name: "Sample Settings", exact: true }).click();
  const depthResponse = await api.waitFor("dam_order_sample_depth", (data) => rows(data).length > 0, depthStart);
  const depths = rows(depthResponse.data);
  const depthRange = depthResponse.event.request.headers().range;
  assert(depths.length <= 100 && (!depthRange || /^\d+-\d+$/.test(depthRange)), `${role} sample depth query stays within a bounded 100-row page`);
  const depth = depths[0];
  const depthRow = page.locator('[aria-label="Sample depth settings"] tbody tr').filter({ hasText: String(depth.sku_normalized) }).filter({ hasText: String(depth.customer_normalized) });
  await depthRow.waitFor();
  const depthCells = await depthRow.locator("td").allInnerTexts();
  assert(depthCells[2]?.trim() === dataCellValue(depth.depth_inches), `${role} sample-depth current value matches same API row`);
  assert(depthCells[3]?.includes(dataCellValue(depth.depth_raw)), `${role} sample-depth history matches same API row`);
  if (role === "Administrator") assert(await depthRow.getByRole("button", { name: "Edit", exact: true }).count() === 1, "Administrator sees sample-depth edit control");
  else assert(await depthRow.getByRole("button", { name: "Edit", exact: true }).count() === 0, "Viewer has no sample-depth edit control");
  if (role === "Administrator") {
    assert(await page.getByRole("button", { name: "Add depth setting", exact: true }).count() === 1, "Administrator can open sample-depth creation control");
    assert(await page.getByRole("button", { name: "Add customer suffix", exact: true }).count() === 1, "Administrator can open suffix creation control");
  }

  stage = `${role}: customer suffix`;
  const suffixStart = depthStart;
  await page.getByRole("region", { name: "Customer suffix settings" }).waitFor();
  const suffixResponse = await api.waitFor("dam_order_customer_settings", (data) => rows(data).length > 0, suffixStart);
  const suffixes = rows(suffixResponse.data);
  assert(suffixes.length <= 100, `${role} suffix query stays within a bounded 100-row page`);
  const suffix = suffixes[0];
  const suffixRow = page.locator('[aria-label="Customer suffix settings"] tbody tr').filter({ hasText: String(suffix.customer_normalized) });
  await suffixRow.waitFor();
  assert((await suffixRow.locator("td").nth(1).innerText()).trim() === String(suffix.suffix), `${role} suffix value matches same API row`);
  if (role === "Administrator") assert(await suffixRow.getByRole("button", { name: "Edit", exact: true }).count() === 1, "Administrator sees suffix edit control");
  else assert(await suffixRow.getByRole("button", { name: "Edit", exact: true }).count() === 0, "Viewer has no suffix edit control");

  stage = `${role}: vendor statistics`;
  await page.goto(new URL("/styles", productionUrl).href);
  const vendorStart = api.events.length;
  await page.getByRole("button", { name: "Vendor Statistics", exact: true }).click();
  const vendorResponse = await api.waitFor("dam_order_vendor_statistics", (data) => rows(data).length > 0, vendorStart);
  const vendors = rows(vendorResponse.data);
  const vendorRange = vendorResponse.event.request.headers().range;
  assert(vendors.length <= 100 && (!vendorRange || /^\d+-\d+$/.test(vendorRange)), `${role} vendor statistics query stays within a bounded 100-row page`);
  const vendor = vendors[0];
  const vendorRow = page.getByRole("region", { name: "Vendor Statistics" }).locator("tbody tr").filter({ hasText: String(vendor.vendor_name) }).filter({ hasText: String(vendor.factory_id ?? "Unknown") });
  await vendorRow.waitFor();
  const expected = [vendor.vendor_name, vendor.factory_id ?? "Unknown", vendor.order_count, vendor.closed_orders, vendor.open_orders, vendor.last_sent_po_date ?? "Unknown", vendor.activity_status].map(String);
  const actual = (await vendorRow.locator("td").allInnerTexts()).map((cell) => cell.trim());
  assert(expected.every((value, index) => actual[index] === value), `${role} vendor statistics cells match same API row`);
  assert(await page.getByRole("region", { name: "Vendor Statistics" }).getByRole("button", { name: /edit|delete|save/i }).count() === 0, `${role} vendor statistics is read-only`);
}

async function checkLicense(role, session) {
  const { page, api } = session;
  stage = `${role}: Master Data licensing`;
  await page.goto(new URL("/styles", productionUrl).href);
  const start = api.events.length;
  await page.getByRole("button", { name: "Licensed", exact: true }).click();
  const trackerResponse = await api.waitFor("style_tracker_rows_with_bridge", (data) => rows(data).length > 0, start);
  const trackers = rows(trackerResponse.data);
  assert(trackers.length <= 1000, `${role} Master Data tracker page is bounded`);
  const eligible = trackers.find((row) => row.id && row.source_sheet === "License.Style" && row.plm_item_id && row.sku);
  assert(Boolean(eligible), `${role} authenticated Master Data page has an existing Licensed row`);
  const statusesResponse = await api.waitFor("get_dam_style_tracker_license_status", (data) => rows(data).some((row) => row.id === eligible.id), start);
  const computed = rows(statusesResponse.data).find((row) => row.id === eligible.id);
  assert(Boolean(computed), `${role} computed licensing result is mapped by row ID`);
  await page.getByPlaceholder("Find in master data (Ctrl+F)").fill(eligible.id);
  const gridRow = page.locator(`.ag-center-cols-container .ag-row[row-id="${eligible.id}"]`);
  await gridRow.waitFor({ timeout: 20_000 });
  const header = page.locator('.ag-header-cell[col-id="N"] .ag-header-cell-text');
  assert(await revealHorizontally(page, header), `${role} reveals horizontally virtualized License Status N`);
  assert((await header.innerText()).trim() === "License Status", `${role} sees calculated License Status heading`);
  const cell = gridRow.locator('.ag-cell[col-id="N"]');
  assert(await revealHorizontally(page, cell), `${role} reveals calculated License Status cell`);
  assert((await cell.innerText()).trim() === dataCellValue(computed.license_status), `${role} current license display matches ID-mapped API result`);
  await cell.dblclick();
  await page.waitForTimeout(150);
  assert(await cell.evaluate((element) => !element.classList.contains("ag-cell-inline-editing") && !element.querySelector("input,textarea,select,[contenteditable=true]")), `${role} calculated License Status remains read-only`);
}

async function accept() {
  if (process.env.POPDAM_ACCEPTANCE_BASE_URL !== productionUrl) throw new Error("acceptance target is not the exact production application origin");
  validateDatabaseTarget();
  const ref = process.env.GITHUB_REF ?? "";
  const workflowSha = process.env.GITHUB_SHA ?? "";
  const deployedFrontendSha = process.env.DEPLOYED_FRONTEND_SHA ?? "";
  validateCommitInputs({ ref, workflowSha, deployedFrontendSha });
  const binding = validateBuildBinding({
    ref,
    workflowSha,
    deployedFrontendSha,
    isAncestor: runGitBoolean(["merge-base", "--is-ancestor", deployedFrontendSha, workflowSha]),
    frontendTreeEqual: runGitBoolean(["diff", "--quiet", deployedFrontendSha, workflowSha, "--", ...FRONTEND_BUILD_PATHS]),
  });
  if (!outputRoot) throw new Error("proof output directory is missing");
  for (const name of ["POPDAM_TEST_USER", "POPDAM_TEST_PASSWORD", "POPDAM_VIEWER_TEST_USER", "POPDAM_VIEWER_TEST_PASSWORD"]) {
    if (!process.env[name]) throw new Error(`required protected credential ${name} is unavailable`);
  }

  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const sessions = [];
  const checks = [];
  let observedBuildStamp;
  try {
    for (const [role, email, password] of [
      ["Administrator", process.env.POPDAM_TEST_USER, process.env.POPDAM_TEST_PASSWORD],
      ["Viewer", process.env.POPDAM_VIEWER_TEST_USER, process.env.POPDAM_VIEWER_TEST_PASSWORD],
    ]) {
      const before = checkLabels.length;
      const session = await login(browser, email, password, role);
      sessions.push(session);
      if (observedBuildStamp === undefined) observedBuildStamp = session.observedBuildStamp;
      else assert(session.observedBuildStamp === observedBuildStamp, "administrator and viewer see the same deployed frontend stamp");
      await checkOrderList(role, session);
      await checkTracking(role, session);
      await checkSettingsAndVendors(role, session);
      await checkLicense(role, session);
      assert(session.forbiddenWrites.length === 0, `${role} acceptance attempted no production Supabase REST mutation`);
      checks.push(...checkLabels.slice(before).map((label) => ({ label, passed: true })));
      // End this completed role's background reads before starting the next role.
      await session.context.close();
    }
  } finally {
    for (const session of sessions) await session.context.close().catch(() => {});
    await browser.close();
  }
  const baselineEvidencePath = process.env.BASELINE_EVIDENCE_PATH;
  if (!baselineEvidencePath) throw new Error("verified backend evidence input path is missing");
  const baselineEvidence = JSON.parse(await readFile(baselineEvidencePath, "utf8"));
  const proof = createLiveProof({ applicationCommitSha: binding.workflowSha, deployedFrontendSha: binding.deployedFrontendSha, observedBuildStamp, checks, baselineEvidence });
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const proofPath = resolve(outputRoot, "db-live-proof.json");
  await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`PASS: production admin/viewer read-only acceptance; checks=${proof.check_count}; checks_sha256=${proof.checks_sha256}\n`);
}

async function main() {
  const mode = process.argv[2];
  try {
    if (mode === "preflight") return preflight();
    if (mode === "verify-baseline") return await verifyBaselineEvidence();
    if (mode === "verify-project") return verifyProject();
    if (mode === "verify-types") return await verifyTypes();
    if (mode === "accept") return await accept();
    throw new Error("select one proof mode");
  } catch (error) {
    const safeMode = ["preflight", "verify-baseline", "verify-project", "verify-types", "accept"].includes(mode) ? mode : "unknown";
    const safeName = typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name) ? error.name : "Error";
    const run = /^\d+$/.test(process.env.GITHUB_RUN_ID ?? "") ? process.env.GITHUB_RUN_ID : "local";
    const attempt = /^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT ?? "") ? process.env.GITHUB_RUN_ATTEMPT : "1";
    const privateRoot = process.env.ORDERLIST_PROOF_PRIVATE_DIR ?? resolve(process.env.RUNNER_TEMP ?? tmpdir(), "orderlist-proof-private");
    try {
      await mkdir(privateRoot, { recursive: true, mode: 0o700 });
      await chmod(privateRoot, 0o700);
      await writeFile(resolve(privateRoot, `failure-${safeMode}-${run}-${attempt}.txt`), `${error instanceof Error ? error.stack ?? error.message : "proof failed"}\n`, { flag: "wx", mode: 0o600 });
    } catch { /* Failure details remain private and optional; never echo them to CI logs. */ }
    const safeStage = /^[A-Za-z0-9 :_-]+$/.test(stage) ? stage : "acceptance";
    process.stderr.write(`FAIL: ${safeMode} at ${safeStage}: ${safeName}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
