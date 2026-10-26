import assert from "node:assert/strict";
import test from "node:test";
import type { DB } from "../supabase.js";
import {
  normalizeSgEmbeddingStatus,
  normalizeClaimedSgDocuments,
  parseEmbedVector,
  isMissingRpcError,
  resolveTextEmbedConfig,
  resetTextEmbedConfigCache,
  handleEmbedSgSearch,
  processClaimedSgBatch,
  type ClaimedSgDocument,
} from "./embed-sg-search.js";

const vector = (n = 768) => Array.from({ length: n }, (_, i) => ((i % 17) / 17) - 0.5);
const embedOk = { ok: true, dim: 768, model: "google/siglip2-base-patch16-naflex", vector: vector() };

interface RpcCall { fn: string; params: Record<string, unknown> }

function fakeClient(rpcs: {
  claim?: unknown; claimError?: { message: string; code?: string };
  upsert?: unknown; mark?: unknown; status?: unknown; statusError?: { message: string };
}) {
  const calls: RpcCall[] = [];
  const client = {
    rpc: (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      if (fn === "claim_sg_search_embedding_documents") {
        return Promise.resolve(rpcs.claimError ? { data: null, error: rpcs.claimError } : { data: rpcs.claim ?? [], error: null });
      }
      if (fn === "upsert_sg_search_embedding") return Promise.resolve({ data: rpcs.upsert ?? true, error: null });
      if (fn === "mark_sg_search_embedding_error") return Promise.resolve({ data: rpcs.mark ?? true, error: null });
      if (fn === "get_sg_search_embedding_status") {
        return Promise.resolve(rpcs.statusError ? { data: null, error: rpcs.statusError } : { data: rpcs.status ?? { total_documents: 0 }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
    },
  } as unknown as DB;
  return { client, calls };
}

const doc = (id: string, overrides: Partial<ClaimedSgDocument> = {}): ClaimedSgDocument => ({
  style_guide_file_id: id,
  search_text: `file ${id}`,
  thumbnail_url: "https://cdn/x.png",
  content_sha256: `sha-${id}`,
  lease_token: `lease-${id}`,
  lease_expires_at: "2026-10-26T00:00:00Z",
  attempt: 1,
  ...overrides,
});

const claimRow = (d: ClaimedSgDocument) => ({ ...d });

const configLoader = async () => ({ url: "https://text-embed.internal", key: "k" });

test("normalizes popsg embedding coverage without trusting malformed counts", () => {
  const status = normalizeSgEmbeddingStatus({ total_documents: "20", embedded_documents: 9, pending_documents: -4, unidentified_documents: "2", exhausted_documents: "1" });
  assert.equal(status.total_documents, 20);
  assert.equal(status.embedded_documents, 9);
  assert.equal(status.pending_documents, 0);
  assert.equal(status.unidentified_documents, 2);
  assert.equal(status.exhausted_documents, 1);
});

test("defaults absent popsg embedding coverage to safe zeros", () => {
  assert.equal(normalizeSgEmbeddingStatus(undefined).pending_documents, 0);
  assert.equal(normalizeSgEmbeddingStatus(undefined).unidentified_documents, 0);
});

test("claims without the full lease triple are dropped, not half-processed", () => {
  const docs = normalizeClaimedSgDocuments([
    { style_guide_file_id: "a", lease_token: "t", content_sha256: "h", search_text: "x" },
    { style_guide_file_id: "b", lease_token: null, content_sha256: "h" },
    "junk",
  ]);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].style_guide_file_id, "a");
});

test("parseEmbedVector accepts only SigLIP2/768 answers", () => {
  assert.equal(parseEmbedVector(embedOk).vector?.length, 768);
  assert.match(parseEmbedVector({ ...embedOk, dim: 384 }).reason!, /dimension mismatch/);
  assert.match(parseEmbedVector({ ...embedOk, model: "other/model" }).reason!, /model mismatch/);
  assert.match(parseEmbedVector({ ok: false }).reason!, /ok:false/);
  assert.match(parseEmbedVector({ ...embedOk, vector: [0.1, 0.2] }).reason!, /768-float/);
  assert.match(parseEmbedVector({ ...embedOk, vector: embedOk.vector.map((v, i) => (i === 0 ? NaN : v)) }).reason!, /non-finite/);
});

test("missing-RPC detection covers the PostgREST shapes", () => {
  assert.equal(isMissingRpcError({ message: "Could not find the function public.claim_sg_search_embedding_documents", code: "PGRST202" }), true);
  assert.equal(isMissingRpcError({ message: "function public.claim_sg_search_embedding_documents(integer, text, integer) does not exist", code: "42883" }), true);
  assert.equal(isMissingRpcError({ message: "lease returned no rows" }), false);
  assert.equal(isMissingRpcError(null), false);
});

test("drains a claimed batch through embed + lease-guarded upsert, then reports done on empty claim", async () => {
  const first = fakeClient({ claim: [claimRow(doc("a")), claimRow(doc("b"))], status: { total_documents: 2, embedded_documents: 2, pending_documents: 0 } });
  const seenTexts: string[] = [];
  const result = await handleEmbedSgSearch(
    { status: "running", params: { batch_size: 10 } },
    first.client,
    async (text) => { seenTexts.push(text); return embedOk; },
    configLoader,
  );
  assert.equal(result.ok, true);
  assert.equal(result.done, false);
  assert.equal(result.embedded, 2);
  assert.deepEqual(seenTexts, ["file a", "file b"]);
  const upserts = first.calls.filter((c) => c.fn === "upsert_sg_search_embedding");
  assert.equal(upserts.length, 2);
  assert.equal(upserts[0].params.p_embedding_model, "google/siglip2-base-patch16-naflex");
  const rawVector = String(upserts[0].params.p_embedding);
  assert.ok(rawVector.startsWith("[") && rawVector.endsWith("]"), "vector is bracketed pgvector literal");
  const numbers = JSON.parse(rawVector) as number[];
  assert.equal(numbers.length, 768);
  assert.ok(numbers.every((n) => Number.isFinite(n)));
  assert.equal(upserts[0].params.p_lease_token, "lease-a");

  const second = fakeClient({ claim: [], status: { total_documents: 2, embedded_documents: 2, pending_documents: 0 } });
  const done = await handleEmbedSgSearch({ status: "running", params: {} }, second.client, async () => embedOk, configLoader);
  assert.equal(done.ok, true);
  assert.equal(done.done, true);
  assert.match(String(done.message), /2\/2 documents embedded/);
});

test("stage-1 RPC missing fails the operation honestly with the migration named", async () => {
  const { client, calls } = fakeClient({ claimError: { message: "Could not find the function public.claim_sg_search_embedding_documents", code: "PGRST202" } });
  const result = await handleEmbedSgSearch({ status: "running", params: {} }, client, async () => { throw new Error("must not embed"); }, configLoader);
  assert.equal(result.ok, false);
  assert.equal(result.done, false);
  assert.match(String(result.error), /20261025180137/);
  assert.equal(calls.filter((c) => c.fn === "upsert_sg_search_embedding").length, 0);
});

test("unconfigured text-embed service fails before any claim", async () => {
  const { client, calls } = fakeClient({ claim: [claimRow(doc("a"))] });
  const result = await handleEmbedSgSearch({ status: "running", params: {} }, client, async () => embedOk, async () => null);
  assert.equal(result.ok, false);
  assert.match(String(result.error), /TEXT_EMBED_URL/);
  assert.equal(calls.length, 0);
});

test("per-document HTTP failures mark bounded transient/permanent errors and keep the batch honest", async () => {
  const docs = [doc("a"), doc("b"), doc("c")];
  const { client, calls } = fakeClient({ claim: docs.map(claimRow) });
  const outcome = await processClaimedSgBatch(docs, async (text) => {
    if (text.includes("a")) { const e = new Error("text-embed HTTP 400") as Error & { httpStatus?: number }; e.httpStatus = 400; throw e; }
    if (text.includes("b")) { const e = new Error("text-embed HTTP 503") as Error & { httpStatus?: number }; e.httpStatus = 503; throw e; }
    if (text.includes("c")) throw new Error("fetch failed");
    return embedOk;
  }, client);
  assert.deepEqual({ embedded: outcome.embedded, failed: outcome.failed, stale: outcome.skipped_stale }, { embedded: 0, failed: 3, stale: 0 });
  assert.equal(outcome.service_level_error, undefined);
  const marks = calls.filter((c) => c.fn === "mark_sg_search_embedding_error");
  assert.equal(marks.length, 3);
  assert.equal(marks[0].params.p_category, "permanent");
  assert.equal(marks[1].params.p_category, "transient");
  assert.equal(marks[2].params.p_category, "transient");
});

test("a misconfigured embed service (wrong dimension) stops the batch and requeues untouched claims transient", async () => {
  const docs = Array.from({ length: 8 }, (_, i) => doc(`d${i}`));
  const { client, calls } = fakeClient({ claim: docs.map(claimRow) });
  const outcome = await processClaimedSgBatch(docs, async () => ({ ...embedOk, dim: 384 }), client);
  assert.match(String(outcome.service_level_error), /dimension mismatch/);
  assert.equal(outcome.failed, 8);
  assert.equal(outcome.embedded, 0);
  const marks = calls.filter((c) => c.fn === "mark_sg_search_embedding_error");
  assert.equal(marks.length, 8);
  assert.ok(marks.every((m) => m.params.p_category === "transient"));
  assert.equal(calls.filter((c) => c.fn === "upsert_sg_search_embedding").length, 0);
});

test("an expired-lease upsert counts as stale, not failed", async () => {
  const docs = [doc("a"), doc("b")];
  const { client } = fakeClient({ claim: docs.map(claimRow), upsert: false });
  const outcome = await processClaimedSgBatch(docs, async () => embedOk, client);
  assert.deepEqual({ embedded: outcome.embedded, failed: outcome.failed, stale: outcome.skipped_stale }, { embedded: 0, failed: 0, stale: 2 });
});

test("empty search_text is marked permanent", async () => {
  const docs = [doc("a", { search_text: "   " })];
  const { client, calls } = fakeClient({ claim: docs.map(claimRow) });
  const outcome = await processClaimedSgBatch(docs, async () => embedOk, client);
  assert.equal(outcome.failed, 1);
  const mark = calls.find((c) => c.fn === "mark_sg_search_embedding_error");
  assert.equal(mark?.params.p_category, "permanent");
});

test("resolveTextEmbedConfig: admin_config wins, env is the fallback, none is null", async () => {
  resetTextEmbedConfigCache();
  const fromDb = async () => ({ TEXT_EMBED_URL: "https://from-db", TEXT_EMBED_KEY: "db-key" });
  const primary = await resolveTextEmbedConfig(fromDb, "https://from-env", "env-key", 1_000);
  assert.deepEqual(primary, { url: "https://from-db", key: "db-key" });
  // cached for the TTL window
  assert.deepEqual(await resolveTextEmbedConfig(async () => { throw new Error("unreadable"); }, "", "", 1_000 + 30_000), primary);

  resetTextEmbedConfigCache();
  const fallback = await resolveTextEmbedConfig(async () => { throw new Error("db down"); }, "https://from-env", "env-key", 2_000);
  assert.deepEqual(fallback, { url: "https://from-env", key: "env-key" });

  resetTextEmbedConfigCache();
  assert.equal(await resolveTextEmbedConfig(async () => ({}), "", "", 3_000), null);
});
