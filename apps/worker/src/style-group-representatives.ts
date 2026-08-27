export type StyleGroupRepresentativeCandidate = {
  id: string;
  is_primary?: boolean | null;
  thumbnail_url?: string | null;
  thumbnail_size_bytes?: number | null;
  filename?: string | null;
  relative_path?: string | null;
  file_type?: string | null;
  content_type?: string | null;
  file_size?: number | null;
};

export type RepresentativeSelectionOptions = {
  minCount?: number;
  maxCount?: number;
  maxPayloadBytes?: number;
  defaultThumbnailBytes?: number;
};

const VIEW_HINTS: Array<[string, RegExp]> = [
  ["front", /(?:^|[\s_.-])front(?:[\s_.-]|$)/i],
  ["back", /(?:^|[\s_.-])back(?:[\s_.-]|$)/i],
  ["side", /(?:^|[\s_.-])side(?:[\s_.-]|$)/i],
  ["detail", /(?:^|[\s_.-])(?:detail|close[\s_-]?up)(?:[\s_.-]|$)/i],
  ["three-quarter", /(?:^|[\s_.-])(?:3[\s_-]?4|three[\s_-]?quarter)(?:[\s_.-]|$)/i],
];

function extensionOf(candidate: StyleGroupRepresentativeCandidate): string {
  const name = candidate.filename ?? candidate.relative_path ?? "";
  const match = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match?.[1] ?? (candidate.file_type ?? "unknown").toLowerCase();
}

function fileFamily(candidate: StyleGroupRepresentativeCandidate): string {
  const type = (candidate.content_type ?? "").trim().toLowerCase();
  if (type) return type;
  const ext = extensionOf(candidate);
  if (["jpg", "jpeg", "png", "webp", "heic", "tif", "tiff"].includes(ext)) return "raster";
  if (["ai", "eps", "svg", "pdf"].includes(ext)) return "vector-document";
  if (["psd", "psb"].includes(ext)) return "layered-art";
  return ext;
}

function viewHint(candidate: StyleGroupRepresentativeCandidate): string {
  const text = `${candidate.filename ?? ""} ${candidate.relative_path ?? ""}`;
  return VIEW_HINTS.find(([, pattern]) => pattern.test(text))?.[0] ?? "unspecified";
}

function stableDuplicateKey(candidate: StyleGroupRepresentativeCandidate): string {
  // This is deliberately only a near-duplicate heuristic. quick_hash is sampled
  // and must never be treated as a content-unique identifier.
  const normalizedName = (candidate.filename ?? "")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/(?:copy|final|rev|v)\s*\d+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return [normalizedName, candidate.file_size ?? "", fileFamily(candidate), viewHint(candidate)].join("|");
}

function diversityKey(candidate: StyleGroupRepresentativeCandidate): string {
  return `${fileFamily(candidate)}|${viewHint(candidate)}|${extensionOf(candidate)}`;
}

export function selectStyleGroupRepresentatives(
  candidates: readonly StyleGroupRepresentativeCandidate[],
  options: RepresentativeSelectionOptions = {},
): StyleGroupRepresentativeCandidate[] {
  const minCount = Math.max(1, options.minCount ?? 4);
  const maxCount = Math.max(minCount, Math.min(8, options.maxCount ?? 6));
  const maxPayloadBytes = options.maxPayloadBytes ?? 12 * 1024 * 1024;
  const defaultThumbnailBytes = options.defaultThumbnailBytes ?? 750 * 1024;

  const ordered = candidates
    .filter((candidate) => Boolean(candidate.thumbnail_url))
    .slice()
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || a.id.localeCompare(b.id));

  const unique: StyleGroupRepresentativeCandidate[] = [];
  const duplicateKeys = new Set<string>();
  for (const candidate of ordered) {
    const key = stableDuplicateKey(candidate);
    if (duplicateKeys.has(key)) continue;
    duplicateKeys.add(key);
    unique.push(candidate);
  }

  const selected: StyleGroupRepresentativeCandidate[] = [];
  const selectedIds = new Set<string>();
  const diversityKeys = new Set<string>();
  let payloadBytes = 0;

  const add = (candidate: StyleGroupRepresentativeCandidate, allowBudgetOverflowForMinimum = false) => {
    if (selected.length >= maxCount || selectedIds.has(candidate.id)) return false;
    const bytes = Math.max(1, candidate.thumbnail_size_bytes ?? defaultThumbnailBytes);
    if (!allowBudgetOverflowForMinimum && payloadBytes + bytes > maxPayloadBytes) return false;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    diversityKeys.add(diversityKey(candidate));
    payloadBytes += bytes;
    return true;
  };

  const primary = unique.find((candidate) => candidate.is_primary);
  if (primary) add(primary, true);

  for (const candidate of unique) {
    if (diversityKeys.has(diversityKey(candidate))) continue;
    add(candidate, selected.length < minCount);
  }
  for (const candidate of unique) {
    add(candidate, selected.length < minCount);
  }

  return selected;
}
