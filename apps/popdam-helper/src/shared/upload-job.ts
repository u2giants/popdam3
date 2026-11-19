import type { CheckoutRecord, StorageProvider, UploadInstructions, UploadJob } from "./types";

export function makeUploadQueueItem(
  record: Pick<CheckoutRecord, "id" | "sourceProvider" | "seafileObjId">,
  snapshotPath: string,
  instructions: UploadInstructions,
  preferredProvider: StorageProvider | undefined,
  isRedrive?: true,
): UploadJob {
  return {
    checkoutId: record.id,
    snapshotPath,
    uploadMethod: preferredProvider === "synology" ? "smb_local" : "synology_file_station",
    synologyUrl: instructions.synology_url,
    synologyPort: instructions.synology_port,
    relativePath: instructions.relative_path,
    filename: instructions.filename,
    tempSuffix: instructions.temp_suffix,
    retryCount: 0,
    addedAt: Date.now(),
    sourceProvider: record.sourceProvider,
    seafileObjId: record.seafileObjId,
    ...(isRedrive ? { isRedrive } : {}),
  };
}
