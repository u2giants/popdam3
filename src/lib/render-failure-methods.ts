export function parseFailedRenderMethods(details: string): string[] {
  return details
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(":")[0]?.trim().toLowerCase())
    .filter(Boolean);
}
