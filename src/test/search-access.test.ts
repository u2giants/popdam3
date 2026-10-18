import { describe, expect, it, vi } from "vitest";
import { loadDamSearchMode, searchAccessStatus } from "../../supabase/functions/_shared/search-access";

describe("DAM role-safe mode capability", () => {
  it.each(["administrator", "designer", "viewer"])("returns the saved mode for an authorized %s", async () => {
    const config = vi.fn().mockResolvedValue({ data: { value: "hybrid" }, error: null });
    await expect(loadDamSearchMode(async () => ({ data: true, error: null }), config)).resolves.toBe("hybrid");
    expect(config).toHaveBeenCalledOnce();
  });
  it("does not read privileged config for a user without DAM access", async () => {
    const config = vi.fn();
    await expect(loadDamSearchMode(async () => ({ data: false, error: null }), config)).rejects.toMatchObject({ status: 403 });
    expect(config).not.toHaveBeenCalled();
  });
  it("preserves an authorization-check error instead of granting access", async () => {
    const config = vi.fn();
    await expect(loadDamSearchMode(async () => ({ data: null, error: { code: "42501" } }), config)).rejects.toMatchObject({ code: "42501" });
    expect(config).not.toHaveBeenCalled();
  });
  it.each([null, {}, { value: false }, { value: "unknown" }])("defaults missing or invalid mode to keyword", async (data) => {
    await expect(loadDamSearchMode(async () => ({ data: true, error: null }), async () => ({ data, error: null }))).resolves.toBe("keyword");
  });
  it("accepts the existing wrapped setting without exposing it", async () => {
    await expect(loadDamSearchMode(async () => ({ data: true, error: null }), async () => ({ data: { value: { value: "hybrid" } }, error: null }))).resolves.toBe("hybrid");
  });
});

describe("search access error classification", () => {
  it.each([
    [{ context: new Response(null, { status: 401 }) }, 401],
    [{ context: new Response(null, { status: 403 }) }, 403],
    [{ status: 403 }, 403],
    [{ code: "42501", message: "search_assets_full_text permission denied" }, 403],
    [{ code: "PGRST301" }, 401],
    [{ code: "PGRST302" }, 401],
    [{ code: "28000" }, 401],
    [{ status: 503 }, null],
    [{ code: "57014" }, null],
  ])("classifies access separately from availability", (error, status) => {
    expect(searchAccessStatus(error)).toBe(status);
  });
});
