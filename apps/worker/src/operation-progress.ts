import type { BatchResult, OpState } from "./types.js";

// ── Progress accumulator — mirrors buildProgress() in bulk-job-runner ────────

function isRebuildRowCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function qualifyRebuildRowCounts(batch: BatchResult, op: OpState): BatchResult {
  if (!batch.ok || batch.stage !== "rebuild_assets") return batch;
  // The legacy handler estimates selected rows from its configured batch size.
  // Only the scheduled watermark contract returns actual selected candidates;
  // these counts do not describe physical database reads.
  const exact = op.params?.watermark_protocol === 1
    && isRebuildRowCount(batch.rows_examined)
    && isRebuildRowCount(batch.assets_assigned)
    && isRebuildRowCount(batch.assets_ungrouped)
    && Number.isSafeInteger(batch.assets_assigned + batch.assets_ungrouped)
    && batch.assets_assigned + batch.assets_ungrouped <= batch.rows_examined;
  return { ...batch, rebuild_counts_exact: exact };
}

export function mergeProgress(opKey: string, prev: Record<string, unknown>, batch: BatchResult): Record<string, unknown> {
  // Normalize dynamic keys for matching
  const normalizedKey = opKey.startsWith("ai-tag-single-") ? "ai-tag-all" : opKey;
  switch (normalizedKey) {
    case "ai-tag-untagged":
    case "ai-tag-all":
    case "ai-tag-groups":
    case "ai-tag-parallel": {
      const prevFail = Array.isArray(prev.failure_samples) ? prev.failure_samples as unknown[] : [];
      const batchFail = Array.isArray(batch.failure_samples) ? batch.failure_samples as unknown[] : [];
      const prevSkip = Array.isArray(prev.skip_samples) ? prev.skip_samples as unknown[] : [];
      const batchSkip = Array.isArray(batch.skip_samples) ? batch.skip_samples as unknown[] : [];
      return {
        tagged: ((prev.tagged as number) || 0) + ((batch.tagged as number) || 0),
        skipped: ((prev.skipped as number) || 0) + ((batch.skipped as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        visual_analysis_unavailable: ((prev.visual_analysis_unavailable as number) || 0) + ((batch.visual_analysis_unavailable as number) || 0),
        image_unusable: ((prev.image_unusable as number) || 0) + ((batch.image_unusable as number) || 0),
        // Prefer previously-set total; fall back to batch-supplied count (set by handler when total is unknown)
        total: (prev.total as number) || (batch.total_count as number) || 0,
        failure_samples: [...prevFail, ...batchFail].slice(-200),
        skip_samples: [...prevSkip, ...batchSkip].slice(-200),
      };
    }
    case "ai-tag-group-profiles": {
      const prevFail = Array.isArray(prev.failure_samples) ? prev.failure_samples as unknown[] : [];
      const batchFail = Array.isArray(batch.failure_samples) ? batch.failure_samples as unknown[] : [];
      return {
        profiled: ((prev.profiled as number) || 0) + ((batch.profiled as number) || 0),
        skipped: ((prev.skipped as number) || 0) + ((batch.skipped as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        visual_analysis_unavailable: ((prev.visual_analysis_unavailable as number) || 0) + ((batch.visual_analysis_unavailable as number) || 0),
        image_unusable: ((prev.image_unusable as number) || 0) + ((batch.image_unusable as number) || 0),
        total: (prev.total as number) || (batch.total_count as number) || 0,
        failure_samples: [...prevFail, ...batchFail].slice(-200),
      };
    }
    case "ai-tag-bakeoff": {
      const prevFail = Array.isArray(prev.failure_samples) ? prev.failure_samples as unknown[] : [];
      const batchFail = Array.isArray(batch.failure_samples) ? batch.failure_samples as unknown[] : [];
      return {
        evaluated: ((prev.evaluated as number) || 0) + ((batch.evaluated as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        total: (prev.total as number) || (batch.total_count as number) || 0,
        failure_samples: [...prevFail, ...batchFail].slice(-100),
      };
    }
    case "rebuild-style-groups": {
      let rowCounts = {
        rows_examined: prev.rows_examined,
        rows_written: prev.rows_written,
        rebuild_counts_exact: prev.rebuild_counts_exact,
      };
      if (batch.ok && batch.stage === "rebuild_assets") {
        const freshPrefix = prev.rebuild_counts_exact === undefined
          && prev.rows_examined === undefined && prev.rows_written === undefined
          && (prev.total_processed === undefined || prev.total_processed === 0);
        const exactPrefix = prev.rebuild_counts_exact === true
          && isRebuildRowCount(prev.rows_examined) && isRebuildRowCount(prev.rows_written);
        const selected = batch.rows_examined;
        const assigned = batch.assets_assigned;
        const ungrouped = batch.assets_ungrouped;
        if (batch.rebuild_counts_exact === true && (freshPrefix || exactPrefix)
          && isRebuildRowCount(selected) && isRebuildRowCount(assigned) && isRebuildRowCount(ungrouped)) {
          const examined = (freshPrefix ? 0 : Number(prev.rows_examined)) + selected;
          const written = (freshPrefix ? 0 : Number(prev.rows_written)) + assigned + ungrouped;
          // The handler commits its cursor/total before this separate progress
          // write. A crash between them must not label an incomplete sum exact.
          const reconciled = isRebuildRowCount(batch.total_processed) && batch.total_processed === examined;
          rowCounts = reconciled && Number.isSafeInteger(examined) && Number.isSafeInteger(written)
            ? { rows_examined: examined, rows_written: written, rebuild_counts_exact: true }
            : { rows_examined: null, rows_written: null, rebuild_counts_exact: false };
        } else {
          // A resumed legacy prefix cannot be reconstructed from total_processed.
          rowCounts = { rows_examined: null, rows_written: null, rebuild_counts_exact: false };
        }
      }
      const successful: Partial<BatchResult> = batch.ok ? batch : {};
      return {
        ...rowCounts,
        groups: ((prev.groups as number) || 0) + ((successful.groups_created as number) || 0),
        assigned: ((prev.assigned as number) || 0) + ((successful.assets_assigned as number) || 0),
        cleared: ((prev.cleared as number) || 0) + ((successful.cleared_assets as number) || 0),
        groups_deleted: ((prev.groups_deleted as number) || 0) + ((successful.groups_deleted as number) || 0),
        total_groups_before_delete: Math.max((prev.total_groups_before_delete as number) || 0, (successful.total_groups_before_delete as number) || 0),
        total_processed: Math.max((prev.total_processed as number) || 0, (successful.total_processed as number) || 0),
        total_assets: Math.max((prev.total_assets as number) || 0, (successful.total_assets as number) || 0),
        counts_processed: Math.max((prev.counts_processed as number) || 0, (successful.counts_processed as number) || 0),
        primaries_processed: Math.max((prev.primaries_processed as number) || 0, (successful.primaries_processed as number) || 0),
        finalize_total_groups: Math.max((prev.finalize_total_groups as number) || 0, (successful.finalize_total_groups as number) || 0),
        stage: batch.stage || prev.stage,
        substage: batch.sub || batch.substage || prev.substage,
      };
    }
    case "reconcile-style-group-stats":
      return {
        counts_processed: Math.max((prev.counts_processed as number) || 0, (batch.counts_processed as number) || 0),
        primaries_processed: Math.max((prev.primaries_processed as number) || 0, (batch.primaries_processed as number) || 0),
        total_groups: Math.max((prev.total_groups as number) || 0, (batch.total_groups as number) || 0),
        stage: batch.sub || prev.stage,
      };
    case "erp-enrichment":
      return {
        updated: ((prev.updated as number) || 0) + ((batch.updated as number) || 0),
        total: Math.max((prev.total as number) || 0, (batch.total as number) || 0),
        assets_updated: ((prev.assets_updated as number) || 0) + ((batch.assets_updated as number) || 0),
        groups_updated: ((prev.groups_updated as number) || 0) + ((batch.groups_updated as number) || 0),
        // #630: the handler reports the page size that actually worked so a
        // later tick starts there instead of re-burning a timeout at 100.
        retry_page_size: (batch.retry_page_size as number) ?? prev.retry_page_size,
      };
    case "shorten-item-descriptions":
      return {
        shortened: ((prev.shortened as number) || 0) + ((batch.shortened as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        scanned: ((prev.scanned as number) || 0) + ((batch.scanned as number) || 0),
        failure_samples: [
          ...(Array.isArray(prev.failure_samples) ? prev.failure_samples : []),
          ...(Array.isArray(batch.failure_samples) ? batch.failure_samples : []),
        ].slice(-100),
      };
    case "erp-classify":
      return {
        classified: ((prev.classified as number) || 0) + ((batch.classified as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        skipped_unclassifiable: ((prev.skipped_unclassifiable as number) || 0) + ((batch.skipped_unclassifiable as number) || 0),
        total: ((prev.total as number) || 0) + ((batch.total as number) || 0),
      };
    case "propagate-group-tags":
    case "refresh-group-metadata": {
      // Terminology deliberately changed from "assets propagated" to "groups
      // refreshed": nothing is copied between files any more.
      const prevFail = Array.isArray(prev.failure_samples) ? prev.failure_samples as unknown[] : [];
      const batchFail = Array.isArray(batch.failure_samples) ? batch.failure_samples as unknown[] : [];
      return {
        refreshed: ((prev.refreshed as number) || 0) + ((batch.refreshed as number) || 0),
        unchanged: ((prev.unchanged as number) || 0) + ((batch.unchanged as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        total: prev.total || 0,
        failure_samples: [...prevFail, ...batchFail].slice(-200),
        ...(batch.deprecated ? { deprecated: true, deprecation_notice: batch.deprecation_notice } : {}),
      };
    }
    case "cleanup-mega-group-tags":
      return {
        groups_processed: ((prev.groups_processed as number) || 0) + ((batch.groups_processed as number) || 0),
        tags_deleted: ((prev.tags_deleted as number) || 0) + ((batch.tags_deleted as number) || 0),
        characters_deleted: ((prev.characters_deleted as number) || 0) + ((batch.characters_deleted as number) || 0),
        metadata_cleared: ((prev.metadata_cleared as number) || 0) + ((batch.metadata_cleared as number) || 0),
      };
    case "relink-orphaned-assets":
      return {
        relinked: ((prev.relinked as number) || 0) + ((batch.relinked as number) || 0),
        errors: ((prev.errors as number) || 0) + ((batch.errors as number) || 0),
      };
    case "tag-popsg-files":
      return {
        processed: ((prev.processed as number) || 0) + ((batch.processed as number) || 0),
        tags_written: ((prev.tags_written as number) || 0) + ((batch.tags_written as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        licensor_present: ((prev.licensor_present as number) || 0) + ((batch.licensor_present as number) || 0),
        licensor_unmatched: ((prev.licensor_unmatched as number) || 0) + ((batch.licensor_unmatched as number) || 0),
        property_present: ((prev.property_present as number) || 0) + ((batch.property_present as number) || 0),
        property_unmatched: ((prev.property_unmatched as number) || 0) + ((batch.property_unmatched as number) || 0),
        consensus_folders: ((prev.consensus_folders as number) || 0) + ((batch.consensus_folders as number) || 0),
        consensus_relationships: ((prev.consensus_relationships as number) || 0) + ((batch.consensus_relationships as number) || 0),
        failure_samples: [
          ...(Array.isArray(prev.failure_samples) ? prev.failure_samples : []),
          ...(Array.isArray(batch.failure_samples) ? batch.failure_samples : []),
        ].slice(-100),
      };
    case "embed-dam-search":
      return {
        claimed: ((prev.claimed as number) || 0) + ((batch.claimed as number) || 0),
        embedded: ((prev.embedded as number) || 0) + ((batch.embedded as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        stale: ((prev.stale as number) || 0) + ((batch.stale as number) || 0),
        total_documents: (batch.total_documents as number) || (prev.total_documents as number) || 0,
        embedded_documents: (batch.embedded_documents as number) || (prev.embedded_documents as number) || 0,
        pending_documents: (batch.pending_documents as number) ?? (prev.pending_documents as number) ?? 0,
        exhausted_documents: (batch.exhausted_documents as number) ?? (prev.exhausted_documents as number) ?? 0,
      };
    case "rebuild-image-vectors": {
      const prevFail = Array.isArray(prev.failure_samples) ? prev.failure_samples as unknown[] : [];
      const batchFail = Array.isArray(batch.failure_samples) ? batch.failure_samples as unknown[] : [];
      return {
        stale_found: ((prev.stale_found as number) || 0) + ((batch.stale_found as number) || 0),
        enqueued: ((prev.enqueued as number) || 0) + ((batch.enqueued as number) || 0),
        failed: ((prev.failed as number) || 0) + ((batch.failed as number) || 0),
        failure_samples: [...prevFail, ...batchFail].slice(-100),
        // Last-write-wins snapshot from the handler's final (exhausted) batch.
        image_embed_status: (batch.image_embed_status as Record<string, unknown>)
          ?? (prev.image_embed_status as Record<string, unknown>),
      };
    }
    default:
      return { ...prev, ...batch };
  }
}

export function buildResultMessage(opKey: string, progress: Record<string, unknown>): string {
  const normalizedKey = opKey.startsWith("ai-tag-single-") ? "ai-tag-all" : opKey;
  switch (normalizedKey) {
    case "ai-tag-untagged":
    case "ai-tag-all":
    case "ai-tag-groups":
    case "ai-tag-parallel":
      return `Tagged ${progress.tagged}. ${(Number(progress.visual_analysis_unavailable) || 0) + (Number(progress.image_unusable) || 0)} visual analyses unavailable. ${progress.skipped || 0} skipped. ${progress.failed || 0} failed${progress.image_unusable ? ` (${progress.image_unusable} with unusable images)` : ""}.`;
    case "ai-tag-group-profiles":
      return `Profiled ${progress.profiled || 0} style groups. ${(Number(progress.visual_analysis_unavailable) || 0) + (Number(progress.image_unusable) || 0)} without usable representative images. ${progress.failed || 0} failed${progress.image_unusable ? ` (${progress.image_unusable} with unusable images)` : ""}.`;
    case "ai-tag-bakeoff":
      return `Evaluated ${progress.evaluated || 0} model responses. ${progress.failed || 0} failed.`;
    case "rebuild-style-groups": {
      const counts = progress.rebuild_counts_exact === true
        && isRebuildRowCount(progress.rows_examined) && isRebuildRowCount(progress.rows_written)
        ? `${progress.rows_examined} assets checked, ${progress.rows_written} assignments changed`
        : "Asset check/change counts unavailable for this run";
      return `Created ${progress.groups} style groups, assigned ${progress.assigned} assets. ${counts}`;
    }
    case "reconcile-style-group-stats":
      return `Reconciled counts for ${progress.counts_processed || 0} groups, primaries for ${progress.primaries_processed || 0} groups`;
    case "erp-enrichment":
      return `Enriched ${progress.assets_updated || 0} assets, ${progress.groups_updated || 0} groups`;
    case "shorten-item-descriptions":
      return `Shortened ${progress.shortened || 0} item descriptions. ${progress.failed || 0} failed.`;
    case "erp-classify":
      return `AI-classified ${progress.classified || 0} items (${progress.skipped_unclassifiable || 0} unclassifiable)`;
    case "propagate-group-tags":
    case "refresh-group-metadata":
      return `Refreshed ${progress.refreshed || 0} style groups (${progress.unchanged || 0} already current, ${progress.failed || 0} failed)`;
    case "cleanup-mega-group-tags":
      return `Cleaned ${progress.groups_processed || 0} mega-groups: ${progress.tags_deleted || 0} tags deleted, ${progress.characters_deleted || 0} characters removed, ${progress.metadata_cleared || 0} assets metadata cleared`;
    case "relink-orphaned-assets":
      return `Relinked ${progress.relinked || 0} orphaned assets${progress.errors ? `, ${progress.errors} errors` : ""}`;
    case "tag-popsg-files":
      return `Tagged ${progress.processed || 0} PopSG files with ${progress.tags_written || 0} direct relationships and ${progress.consensus_relationships || 0} folder-consensus relationships. ${progress.failed || 0} failed.`;
    case "embed-dam-search":
      return `Embedded ${progress.embedded || 0} search documents. ${progress.pending_documents || 0} pending, ${progress.exhausted_documents || 0} terminal.`;
    default:
      return "Operation completed";
  }
}
