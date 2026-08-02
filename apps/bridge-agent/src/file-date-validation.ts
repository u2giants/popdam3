// Filesystems and archive tools can preserve corrupt timestamps. A small clock
// tolerance avoids false positives while ensuring a bad date cannot make a
// style guide appear newer than every real file for years.
export const MAX_FUTURE_FILE_DATE_MS = 24 * 60 * 60 * 1000;

export function safeFilesystemModifiedAt(
  modifiedAt: Date,
  nowMs = Date.now(),
): string | null {
  const timestamp = modifiedAt.getTime();
  if (!Number.isFinite(timestamp) || timestamp > nowMs + MAX_FUTURE_FILE_DATE_MS) {
    return null;
  }
  return modifiedAt.toISOString();
}
