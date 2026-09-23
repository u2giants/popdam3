import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSecretFingerprint } from "@/hooks/useSecretFingerprint";

describe("useSecretFingerprint", () => {
  it("never returns the previous key's fingerprint after a rotation", async () => {
    const { result, rerender } = renderHook(({ secret }) => useSecretFingerprint(secret), { initialProps: { secret: "account-one" } });
    await waitFor(() => expect(result.current).not.toBeNull());
    const first = result.current;
    rerender({ secret: "account-two" });
    // Same render as the rotation: must be pending, not the old identity.
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).not.toBe(first);
    rerender({ secret: "" });
    expect(result.current).toBe("none");
  });
});
