const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR_PREFIX = "ai1";

export type AiTagCursor = { tier: number; id: string };

export class AiTagCursorError extends Error {
  constructor(
    public readonly code: "invalid_cursor" | "legacy_cursor",
    message: string,
  ) {
    super(message);
    this.name = "AiTagCursorError";
  }
}

export function encodeAiTagCursor(cursor: AiTagCursor): string {
  if (!Number.isSafeInteger(cursor.tier) || cursor.tier < 0 || !UUID_RE.test(cursor.id)) {
    throw new AiTagCursorError("invalid_cursor", "Cannot encode an invalid AI tagging cursor");
  }
  return `${CURSOR_PREFIX}:${cursor.tier}:${cursor.id.toLowerCase()}`;
}

export function decodeAiTagCursor(raw: string | number | undefined): AiTagCursor | null {
  if (raw === undefined || raw === 0 || raw === "") return null;
  if (typeof raw === "number") {
    if (Number.isFinite(raw) && raw > 0) {
      throw new AiTagCursorError(
        "legacy_cursor",
        "This AI tagging run uses legacy offset progress and must be restarted",
      );
    }
    throw new AiTagCursorError("invalid_cursor", "Invalid numeric AI tagging cursor");
  }

  const match = /^ai1:(\d+):([0-9a-f-]+)$/i.exec(raw);
  if (!match) throw new AiTagCursorError("invalid_cursor", "Malformed AI tagging cursor");
  const tier = Number(match[1]);
  const id = match[2];
  if (!Number.isSafeInteger(tier) || tier < 0 || !UUID_RE.test(id)) {
    throw new AiTagCursorError("invalid_cursor", "Malformed AI tagging cursor");
  }
  return { tier, id: id.toLowerCase() };
}

export function isAiTagCursor(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try {
    return decodeAiTagCursor(raw) !== null;
  } catch {
    return false;
  }
}
