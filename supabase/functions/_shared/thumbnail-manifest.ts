/**
 * Streaming CSV builder for export-thumbnail-manifest (#1099).
 *
 * Pages are fetched with keyset pagination (id > last id) and each page is
 * encoded and enqueued before the next is fetched, so peak memory is bounded
 * by one page regardless of catalog size.
 */

export interface ManifestRow {
  id: string;
  relative_path: string | null;
  filename: string | null;
  quick_hash: string | null;
  thumbnail_url: string | null;
}

export type FetchManifestPage = (afterId: string | null, limit: number) => Promise<ManifestRow[]>;

export const MANIFEST_HEADER = "old_asset_id,relative_path,filename,quick_hash,thumbnail_url\n";

export function escapeCSV(val: string | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function manifestLine(row: ManifestRow): string {
  return [row.id, row.relative_path, row.filename, row.quick_hash, row.thumbnail_url]
    .map(escapeCSV)
    .join(",") + "\n";
}

export function streamThumbnailManifest(
  fetchPage: FetchManifestPage,
  pageSize = 1000,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let afterId: string | null = null;
  let started = false;
  let done = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(MANIFEST_HEADER));
        return;
      }
      if (done) return;
      try {
        const rows = await fetchPage(afterId, pageSize);
        if (rows.length > 0) {
          controller.enqueue(encoder.encode(rows.map(manifestLine).join("")));
          afterId = rows[rows.length - 1].id;
        }
        if (rows.length < pageSize) {
          done = true;
          controller.close();
        }
      } catch (e) {
        done = true;
        controller.error(e);
      }
    },
  });
}
