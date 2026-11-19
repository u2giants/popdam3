// The one path that schedules Windows render jobs (#1094). Files reach it only
// after the scan's skip rules (excluded folders, the permanent .ai ignore list,
// PDF siblings, the no-PDF-compat sentinel). A failed queue request is a scan
// error, never a silent warning.

export interface RenderReasonInput {
  defer: boolean;
  deferReason: string | null;
  isNewOrChanged: boolean;
  thumbnailUrl: string | null | undefined;
  thumbnailError: string | null | undefined;
  fileType: string;
  finalFallbackOnLocalFailure: boolean;
}

export function renderQueueReason(input: RenderReasonInput): string | null {
  if (input.defer && input.isNewOrChanged) return input.deferReason;
  const localFailed = !input.thumbnailUrl && !!input.thumbnailError && input.thumbnailError !== "deferred_to_windows_agent";
  if (!localFailed) return null;
  // blank_render: structurally useless file — never queue for Windows
  if (input.thumbnailError === "blank_render") return null;
  if (input.finalFallbackOnLocalFailure) return "local_thumb_failed";
  if (input.thumbnailError === "no_pdf_compat" && input.fileType === "ai") return "no_pdf_compat";
  return null;
}

export interface RenderQueueDeps {
  queueRender(assetId: string, reason: string): Promise<unknown>;
  recordError(message: string): void;
}

/** Returns true when the job was accepted; a failure is recorded as a scan error. */
export async function requestRender(assetId: string, relativePath: string, reason: string, deps: RenderQueueDeps): Promise<boolean> {
  try {
    await deps.queueRender(assetId, reason);
    return true;
  } catch (e) {
    deps.recordError(`render queue failed for ${relativePath} (${reason}): ${(e as Error).message}`);
    return false;
  }
}
