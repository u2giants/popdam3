/** Each token remains single-use and is checked against the signed-in user by the API. */
export function parseCheckoutBatch(value: string): string[] | null {
  const tokens = value.split(",");
  return tokens.length <= 50 && new Set(tokens).size === tokens.length &&
    tokens.every((token) => /^[a-f0-9]{32}$/.test(token)) ? tokens : null;
}

/** Attempt every file even when an earlier file is locked or unavailable. */
export async function checkoutBatch(tokens: string[], checkout: (token: string) => Promise<unknown>): Promise<void> {
  const failures: string[] = [];
  for (const token of tokens) {
    try { await checkout(token); }
    catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  }
  if (failures.length) throw new Error(`${failures.length} file(s) could not be checked out: ${failures[0]}`);
}
