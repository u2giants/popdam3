import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let stored: { accessToken: string; refreshToken: string } | null = null;
vi.mock("./logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("./config", () => ({
  getConfig: () => ({ supabaseUrl: "https://sb.example", supabaseAnonKey: "anon", damUrl: "https://dam.example" }),
}));
vi.mock("./credentials", () => ({
  loadSession: () => stored,
  storeSession: (accessToken: string, refreshToken: string) => {
    stored = { accessToken, refreshToken };
  },
  clearSession: () => {
    stored = null;
  },
}));

function jwt(expSecondsFromNow: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })).toString("base64url");
  return `h.${payload}.s`;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("session refresh (#1396)", () => {
  it("uses a fresh token without refreshing", async () => {
    stored = { accessToken: jwt(3600), refreshToken: "r1" };
    const { getValidAccessToken } = await import("./session");
    expect(await getValidAccessToken()).toBe(stored.accessToken);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expiring token and stores the new pair", async () => {
    stored = { accessToken: jwt(30), refreshToken: "r1" };
    const next = jwt(3600);
    fetchMock.mockResolvedValueOnce(json(200, { access_token: next, refresh_token: "r2" }));
    const { getValidAccessToken } = await import("./session");
    expect(await getValidAccessToken()).toBe(next);
    expect(stored).toEqual({ accessToken: next, refreshToken: "r2" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sb.example/auth/v1/token?grant_type=refresh_token");
    expect(JSON.parse(init.body)).toEqual({ refresh_token: "r1" });
  });

  it("shares one refresh between concurrent callers", async () => {
    stored = { accessToken: jwt(-10), refreshToken: "r1" };
    fetchMock.mockResolvedValueOnce(json(200, { access_token: jwt(3600), refresh_token: "r2" }));
    const { refreshSession } = await import("./session");
    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("signs out when the refresh token is rejected", async () => {
    stored = { accessToken: jwt(-10), refreshToken: "bad" };
    fetchMock.mockResolvedValueOnce(json(400, { error: "invalid_grant" }));
    const { refreshSession } = await import("./session");
    expect(await refreshSession()).toBeNull();
    expect(stored).toBeNull();
  });

  it("keeps the session on a network failure", async () => {
    stored = { accessToken: jwt(-10), refreshToken: "r1" };
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const { refreshSession } = await import("./session");
    expect(await refreshSession()).toBeNull();
    expect(stored).not.toBeNull();
  });
});

describe("damClient 401 retry (#1396)", () => {
  it("refreshes once and retries the call after a 401", async () => {
    stored = { accessToken: jwt(3600), refreshToken: "r1" };
    const next = jwt(3600);
    fetchMock
      .mockResolvedValueOnce(json(401, { error: "expired" }))
      .mockResolvedValueOnce(json(200, { access_token: next, refresh_token: "r2" }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    const { heartbeat } = await import("./damClient");
    expect(await heartbeat({ device_id: "d" })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe(`Bearer ${next}`);
  });

  it("does not loop when the refresh fails", async () => {
    stored = { accessToken: jwt(3600), refreshToken: "bad" };
    fetchMock
      .mockResolvedValueOnce(json(401, { error: "expired" }))
      .mockResolvedValueOnce(json(400, { error: "invalid_grant" }));
    const { fetchConfig } = await import("./damClient");
    await expect(fetchConfig()).rejects.toThrow("401");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stored).toBeNull();
  });
});
