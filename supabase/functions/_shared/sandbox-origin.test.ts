import { sandboxOrigin } from "./sandbox-origin.ts";

const env = (values: Record<string, string>) => (name: string) => values[name];
const SANDBOX = "https://dam-sandbox.designflow.app";
const PREVIEW = "https://mvpkijzfmfcxhnzqogzs.supabase.co";

describe("sandboxOrigin", () => {
  it("is honored on a non-production project", () => {
    expect(sandboxOrigin(env({ SANDBOX_ALLOWED_ORIGIN: SANDBOX, SUPABASE_URL: PREVIEW }))).toBe(SANDBOX);
  });

  it("is never honored on the production project", () => {
    expect(
      sandboxOrigin(env({ SANDBOX_ALLOWED_ORIGIN: SANDBOX, SUPABASE_URL: "https://qsllyeztdwjgirsysgai.supabase.co" })),
    ).toBeNull();
  });

  it("is off when unset, malformed, or the project is unknown", () => {
    expect(sandboxOrigin(env({ SUPABASE_URL: PREVIEW }))).toBeNull();
    expect(sandboxOrigin(env({ SANDBOX_ALLOWED_ORIGIN: "*", SUPABASE_URL: PREVIEW }))).toBeNull();
    expect(sandboxOrigin(env({ SANDBOX_ALLOWED_ORIGIN: SANDBOX }))).toBeNull();
  });
});
