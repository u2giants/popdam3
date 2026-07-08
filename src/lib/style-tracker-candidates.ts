export type StyleTrackerFieldKey = "sku" | "customer" | "licensor" | "designer" | "factory";

export type StyleTrackerLinkCandidate = {
  target_schema: string;
  target_table: string;
  target_id: string;
  target_label: string;
  score: number;
};

const MIN_REVIEW_CANDIDATE_SCORE = 0.65;

export function normalizeStyleTrackerValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string) {
  return normalizeStyleTrackerValue(value).split(" ").filter(Boolean);
}

function acronym(parts: string[]) {
  return parts.map((part) => part[0]).join("");
}

function levenshtein(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= b.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
}

export function scoreStyleTrackerCandidate(rawValue: string, candidateLabel: string) {
  const raw = normalizeStyleTrackerValue(rawValue);
  const candidate = normalizeStyleTrackerValue(candidateLabel);
  if (!raw || !candidate) return 0;
  if (raw === candidate) return 1;

  const rawTokens = tokens(rawValue);
  const candidateTokens = tokens(candidateLabel);
  const rawSet = new Set(rawTokens);
  const candidateSet = new Set(candidateTokens);

  const candidateIsToken = candidate.length >= 3 && rawSet.has(candidate);
  const rawIsToken = raw.length >= 3 && candidateSet.has(raw);
  if (candidateIsToken || rawIsToken) return 0.95;

  if (candidate.length >= 3 && acronym(rawTokens) === candidate) return 0.92;
  if (raw.length >= 3 && acronym(candidateTokens) === raw) return 0.92;

  const allCandidateTokensInRaw = candidateTokens.length > 0 && candidateTokens.every((part) => part.length >= 2 && rawSet.has(part));
  if (allCandidateTokensInRaw) return 0.9;

  const allRawTokensInCandidate = rawTokens.length > 0 && rawTokens.every((part) => part.length >= 2 && candidateSet.has(part));
  if (allRawTokensInCandidate) return 0.88;

  const distance = levenshtein(raw, candidate);
  return 1 - distance / Math.max(raw.length, candidate.length);
}

export function filterStyleTrackerCandidates(
  rawValue: string,
  candidates: StyleTrackerLinkCandidate[],
  options: { minScore?: number } = {},
) {
  const minScore = options.minScore ?? MIN_REVIEW_CANDIDATE_SCORE;
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: Math.max(Number(candidate.score ?? 0), scoreStyleTrackerCandidate(rawValue, candidate.target_label)),
    }))
    .filter((candidate) => candidate.score >= minScore)
    .sort((a, b) => b.score - a.score || a.target_label.localeCompare(b.target_label));
}
