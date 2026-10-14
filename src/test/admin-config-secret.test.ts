import { describe, expect, it } from "vitest";
import { isAdminConfigSecretKey, redactAdminConfigSecret, redactAdminConfigValues } from "../../supabase/functions/_shared/admin-config-secret";

describe("admin-config secret response handling", () => {
  it("recognizes API keys, secrets, tokens, and passwords by config key suffix", () => {
    for (const key of [
      "OPENROUTER_API_KEY",
      "DO_SPACES_SECRET",
      "WINDOWS_AGENT_NAS_PASS",
      "SERVICE_ACCESS_TOKEN",
      "EXTERNAL_PASSWORD",
    ]) {
      expect(isAdminConfigSecretKey(key)).toBe(true);
    }
    expect(isAdminConfigSecretKey("AI_MODEL_POOL")).toBe(false);
    expect(isAdminConfigSecretKey("SPACES_CONFIG")).toBe(false);
  });

  it("returns only whether a secret exists, never its value", () => {
    expect(redactAdminConfigSecret("sensitive-value")).toEqual({ value: "", configured: true });
    expect(redactAdminConfigSecret("")).toEqual({ value: "", configured: false });
    expect(redactAdminConfigSecret(null)).toEqual({ value: "", configured: false });
  });

  it("redacts secret rows in diagnostic config while preserving nonsecret settings", () => {
    expect(redactAdminConfigValues([
      { key: "OPENROUTER_API_KEY", value: "sensitive-value" },
      { key: "AI_MODEL_POOL", value: { openrouter: ["openai/gpt-5"] } },
    ])).toEqual({
      OPENROUTER_API_KEY: { value: "", configured: true },
      AI_MODEL_POOL: { openrouter: ["openai/gpt-5"] },
    });
  });
});
