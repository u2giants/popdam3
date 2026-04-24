export function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`Missing required string field: ${key}`);
  }
  return v.trim();
}

export function optionalString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new Error(`Field ${key} must be a string`);
  return v.trim() || null;
}

export function optionalNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "number") throw new Error(`Field ${key} must be a number`);
  return v;
}
