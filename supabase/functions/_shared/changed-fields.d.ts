export function valuesEqual(a: unknown, b: unknown): boolean;
export function changedFields(
  current: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
): Record<string, unknown>;
