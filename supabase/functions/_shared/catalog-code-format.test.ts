import { afterEach, expect, it, vi } from "vitest";
import { completeCatalogCodeFormat, hasCatalogCodeFormat } from "./catalog-code-format";
import { searchRequestBudget } from "./search-request-budget";

afterEach(() => vi.useRealTimers());

it("normalizes complete ASCII catalog formats including letter sizes and digit-leading codes", () => {
  for (
    const [query, format] of [[" ZZZ83MVSP99 ", "AAA99AAAA99"], ["ABC12DEFGXL", "AAA99AAAAAA"], ["123ABCD45", "999AAAA99"], ["AbCd123", "AAAA999"], [
      "A".repeat(63) + "9",
      "A".repeat(63) + "9",
    ]]
  ) {
    expect(completeCatalogCodeFormat(query)).toBe(format);
  }
  for (const query of ["", "A1", "ABC123", "1234567", "spiderman", "zzzzzzzz", "A1.*AAAA", "ABC12DEFG99.ai", "A1AAAAĀ", "A".repeat(64) + "9"]) {
    expect(completeCatalogCodeFormat(query)).toBeNull();
  }
});

it("does not call the reader for words, filenames, numeric strings, or unknown short partials", async () => {
  const read = vi.fn();
  for (const query of ["spiderman", "zzzzzzzz", "12345678", "ABC123", "ABC12DEFG99.ai"]) {
    expect(await hasCatalogCodeFormat(query, read, new AbortController().signal)).toBe(false);
  }
  expect(read).not.toHaveBeenCalled();
});

it("preserves an explicit unsupported-format false and rejects malformed success data", async () => {
  expect(await hasCatalogCodeFormat("x7q9v2n8", async () => ({ data: false, error: null }), new AbortController().signal)).toBe(false);
  for (const data of [null, 0, "true", [], {}]) {
    await expect(hasCatalogCodeFormat("ZZZ83MVSP99", async () => ({ data, error: null }), new AbortController().signal)).rejects.toThrow();
  }
});

it("caps a hung reader at1000ms, aborts its transport and never treats failure as false", async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  const result = hasCatalogCodeFormat("ZZZ83MVSP99", (_format, current) => {
    signal = current;
    return new Promise(() => {});
  }, new AbortController().signal);
  const assertion = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(999);
  expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await assertion;
  expect(signal.aborted).toBe(true);
});

it("uses only the remaining original30s request budget instead of resetting it for a late hint", async () => {
  vi.useFakeTimers();
  const budget = searchRequestBudget(new AbortController().signal);
  try {
    await vi.advanceTimersByTimeAsync(29_700);
    let signal!: AbortSignal;
    const result = hasCatalogCodeFormat("ZZZ83MVSP99", (_format, current) => {
      signal = current;
      return new Promise(() => {});
    }, budget.signal);
    const assertion = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(299);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(signal.aborted).toBe(true);
  } finally {
    budget.close();
  }
});

it("never starts a catalog read after the original request has already expired", async () => {
  vi.useFakeTimers();
  const budget = searchRequestBudget(new AbortController().signal);
  const read = vi.fn();
  try {
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(hasCatalogCodeFormat("ZZZ83MVSP99", read, budget.signal)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(read).not.toHaveBeenCalled();
  } finally {
    budget.close();
  }
});
