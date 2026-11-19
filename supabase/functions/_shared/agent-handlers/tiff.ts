import { err, json } from "../http.ts";
import { isExcludedRelativePath } from "../path-filters.ts";
import { serviceClient } from "../service-client.ts";
import { optionalString, requireString } from "../validators.ts";

const TIFF_REINSPECT_MIN_BATCH = 1;
const TIFF_REINSPECT_MAX_BATCH = 200;
const TIFF_REINSPECT_DEFAULT_BATCH = 50;

// ── Route: claim-tiff-scan ──────────────────────────────────────────

export async function handleClaimTiffScan(_body: Record<string, unknown>, agentId: string) {
  const db = serviceClient();

  const { data: row, error } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "TIFF_SCAN_REQUEST")
    .maybeSingle();

  if (error) return err(error.message, 500);

  const req = (row?.value as Record<string, unknown> | undefined) ?? undefined;
  if (!req || req.status !== "pending") {
    return json({ ok: true, request: null });
  }

  if (req.target_agent_id && req.target_agent_id !== agentId) {
    return json({ ok: true, request: null });
  }

  const claimed = {
    ...req,
    status: "claimed",
    claimed_by: agentId,
    claimed_at: new Date().toISOString(),
  };

  const { error: claimErr } = await db.from("admin_config").upsert(
    {
      key: "TIFF_SCAN_REQUEST",
      value: claimed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  if (claimErr) return err(claimErr.message, 500);

  return json({ ok: true, request: claimed });
}

// ── Route: report-tiff-scan ─────────────────────────────────────────

export async function handleReportTiffScan(body: Record<string, unknown>) {
  const files = body.files as Array<Record<string, unknown>>;
  const sessionId = optionalString(body, "session_id");
  const done = body.done === true;
  const scanError = optionalString(body, "error");
  const scanStatus = optionalString(body, "status");

  // Accept progress counters from agent
  const progressCounters = body.progress as Record<string, unknown> | undefined;

  if (!Array.isArray(files)) return err("files must be an array");

  const db = serviceClient();

  // If agent is just reporting status (claimed / error), update config
  if (scanStatus === "claimed" && sessionId) {
    await db.from("admin_config").upsert({
      key: "TIFF_SCAN_REQUEST",
      value: {
        status: "claimed",
        request_id: sessionId,
        claimed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    });
    return json({ ok: true, status: "claimed" });
  }

  // Upsert files in batches
  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < files.length; i += CHUNK) {
    const chunk = files.slice(i, i + CHUNK);
    const rows = chunk
      .filter((f) => !isExcludedRelativePath(f.relative_path as string))
      .map((f) => ({
        relative_path: f.relative_path as string,
        filename: f.filename as string,
        file_size: f.file_size as number,
        file_modified_at: f.file_modified_at as string,
        file_created_at: (f.file_created_at as string) || null,
        compression_type: (f.compression_type as string) || "unknown",
        status: "scanned",
        scan_session_id: sessionId,
      }));

    const { error } = await db.from("tiff_optimization_queue")
      .upsert(rows, { onConflict: "relative_path", ignoreDuplicates: false });
    if (error) {
      console.error("report-tiff-scan upsert error:", error);
    } else {
      inserted += rows.length;
    }
  }

  // Update progress on every batch (not just when done)
  if (sessionId && !done) {
    const progressUpdate: Record<string, unknown> = {
      status: "claimed",
      request_id: sessionId,
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      files_reported_so_far: inserted,
    };
    if (progressCounters) {
      progressUpdate.progress = progressCounters;
    }
    try {
      await db.from("admin_config").upsert({
        key: "TIFF_SCAN_REQUEST",
        value: progressUpdate,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    } catch { /* best-effort */ }
  }

  // If done, mark scan request as completed (or failed)
  if (done && sessionId) {
    const finalValue: Record<string, unknown> = {
      status: scanError ? "error" : "completed",
      request_id: sessionId,
      completed_at: new Date().toISOString(),
      total_files: inserted,
    };
    if (scanError) finalValue.error = scanError;
    if (progressCounters) finalValue.progress = progressCounters;
    await db.from("admin_config").upsert({
      key: "TIFF_SCAN_REQUEST",
      value: finalValue,
      updated_at: new Date().toISOString(),
    });
  }

  return json({ ok: true, inserted });
}

// ── Route: claim-tiff-job ───────────────────────────────────────────

export async function handleClaimTiffJob(body: Record<string, unknown>, agentId: string) {
  const db = serviceClient();
  const batchSize = typeof body.batch_size === "number" ? body.batch_size : 1;

  const { data, error } = await db.rpc("claim_tiff_jobs", {
    p_agent_id: agentId,
    p_batch_size: batchSize,
  });

  if (error) return err(error.message, 500);
  if (!data || data.length === 0) return json({ ok: true, jobs: [] });

  return json({ ok: true, jobs: data });
}

export async function handleClaimTiffReinspect(body: Record<string, unknown>, agentId: string) {
  const db = serviceClient();
  const batchSize = typeof body.batch_size === "number"
    ? Math.min(Math.max(body.batch_size, TIFF_REINSPECT_MIN_BATCH), TIFF_REINSPECT_MAX_BATCH)
    : TIFF_REINSPECT_DEFAULT_BATCH;

  const { data: row, error: reqErr } = await db
    .from("admin_config")
    .select("value")
    .eq("key", "TIFF_REINSPECT_REQUEST")
    .maybeSingle();

  if (reqErr) return err(reqErr.message, 500);

  const req = (row?.value as Record<string, unknown> | undefined) ?? undefined;
  if (!req || (req.status !== "pending" && req.status !== "claimed")) {
    return json({ ok: true, jobs: [], done: true });
  }

  const nowIso = new Date().toISOString();
  const currentStatus = req.status as string;
  const claimedBy = typeof req.claimed_by === "string" ? req.claimed_by : null;

  if (currentStatus === "pending") {
    const { error: claimErr } = await db.from("admin_config").upsert({
      key: "TIFF_REINSPECT_REQUEST",
      value: {
        ...req,
        status: "claimed",
        claimed_by: agentId,
        claimed_at: nowIso,
      },
      updated_at: nowIso,
    }, { onConflict: "key" });
    if (claimErr) return err(claimErr.message, 500);
  } else if (claimedBy && claimedBy !== agentId) {
    return json({ ok: true, jobs: [], done: false });
  }

  const requestedIds = Array.isArray(req.ids) ? (req.ids.filter((v): v is string => typeof v === "string" && v.length > 0)) : [];
  const lastId = typeof req.last_id === "string" && req.last_id.length > 0 ? req.last_id : null;
  const processedCount = typeof req.processed_count === "number" ? req.processed_count : 0;

  let query = db.from("tiff_optimization_queue")
    .select("id, relative_path")
    .eq("status", "completed")
    .order("id", { ascending: true })
    .limit(batchSize);

  if (requestedIds.length > 0) query = query.in("id", requestedIds);
  if (lastId) query = query.gt("id", lastId);

  const { data: jobs, error: jobsErr } = await query;
  if (jobsErr) return err(jobsErr.message, 500);

  if (!jobs || jobs.length === 0) {
    const { error: doneErr } = await db.from("admin_config").upsert({
      key: "TIFF_REINSPECT_REQUEST",
      value: {
        ...req,
        status: "completed",
        completed_at: nowIso,
        processed_count: processedCount,
      },
      updated_at: nowIso,
    }, { onConflict: "key" });
    if (doneErr) return err(doneErr.message, 500);
    return json({ ok: true, jobs: [], done: true });
  }

  const newLastId = jobs[jobs.length - 1].id;
  const { error: progErr } = await db.from("admin_config").upsert({
    key: "TIFF_REINSPECT_REQUEST",
    value: {
      ...req,
      status: "claimed",
      claimed_by: agentId,
      claimed_at: nowIso,
      processed_count: processedCount + jobs.length,
      last_id: newLastId,
    },
    updated_at: nowIso,
  }, { onConflict: "key" });
  if (progErr) return err(progErr.message, 500);

  return json({ ok: true, jobs, done: false });
}

export async function handleCompleteTiffReinspect(body: Record<string, unknown>) {
  const jobId = requireString(body, "job_id");
  const success = body.success === true;
  const db = serviceClient();

  const updates: Record<string, unknown> = {
    processed_at: new Date().toISOString(),
  };

  if (success) {
    if (body.new_file_modified_at !== undefined) updates.new_file_modified_at = body.new_file_modified_at;
    if (body.new_file_created_at !== undefined) updates.new_file_created_at = body.new_file_created_at;
    updates.error_message = null;
  } else {
    updates.error_message = optionalString(body, "error") || "Timestamp re-inspection failed";
  }

  const { error } = await db.from("tiff_optimization_queue")
    .update(updates)
    .eq("id", jobId)
    .eq("status", "completed");

  if (error) return err(error.message, 500);
  return json({ ok: true });
}

// ── Route: complete-tiff-job ────────────────────────────────────────

export async function handleCompleteTiffJob(body: Record<string, unknown>) {
  const jobId = requireString(body, "job_id");
  const success = body.success === true;
  const errorMsg = optionalString(body, "error");
  const db = serviceClient();

  const updates: Record<string, unknown> = {
    status: success ? "completed" : "failed",
    processed_at: new Date().toISOString(),
    error_message: errorMsg || null,
  };

  if (success) {
    if (body.new_file_size !== undefined) updates.new_file_size = body.new_file_size;
    if (body.new_filename !== undefined) updates.new_filename = body.new_filename;
    if (body.new_file_modified_at !== undefined) updates.new_file_modified_at = body.new_file_modified_at;
    if (body.new_file_created_at !== undefined) updates.new_file_created_at = body.new_file_created_at;
    if (body.original_backed_up !== undefined) updates.original_backed_up = body.original_backed_up;
    if (body.original_deleted !== undefined) updates.original_deleted = body.original_deleted;
    if (body.file_size !== undefined) updates.file_size = body.file_size; // update original size if changed
  }

  const { error } = await db.from("tiff_optimization_queue")
    .update(updates)
    .eq("id", jobId);

  if (error) return err(error.message, 500);
  return json({ ok: true });
}
