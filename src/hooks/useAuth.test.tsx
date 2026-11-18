import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  warning: vi.fn(),
  session: { user: { id: "u1" } } as unknown,
}));

vi.mock("sonner", () => ({ toast: { warning: mocks.warning } }));
vi.mock("@/lib/external-supabase", () => ({
  AUTH_STORAGE_KEY: "sb-popdam-auth-token",
  externalSupabase: {
    auth: {
      signOut: mocks.signOut,
      getSession: () => Promise.resolve({ data: { session: mocks.session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

import { AuthProvider, useAuth } from "./useAuth";

function setup() {
  const qc = new QueryClient();
  qc.setQueryData(["secret"], "prev-user-data");
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, createElement(AuthProvider, null, children));
  return { qc, ...renderHook(() => useAuth(), { wrapper }) };
}

describe("signOut (#1088)", () => {
  beforeEach(() => {
    mocks.signOut.mockReset();
    mocks.warning.mockReset();
  });

  it("clears local state silently on success", async () => {
    mocks.signOut.mockResolvedValue({ error: null });
    const { result, qc } = setup();
    await waitFor(() => expect(result.current.user).not.toBeNull());
    await act(() => result.current.signOut());
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(qc.getQueryData(["secret"])).toBeUndefined();
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("clears local session and warns when server returns an error", async () => {
    mocks.signOut.mockResolvedValueOnce({ error: new Error("500") }).mockResolvedValue({ error: null });
    const { result, qc } = setup();
    await waitFor(() => expect(result.current.user).not.toBeNull());
    await act(() => result.current.signOut());
    expect(mocks.signOut).toHaveBeenLastCalledWith({ scope: "local" });
    expect(result.current.user).toBeNull();
    expect(qc.getQueryData(["secret"])).toBeUndefined();
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });

  it("clears local state and warns even when every sign-out call throws", async () => {
    mocks.signOut.mockRejectedValue(new Error("network"));
    localStorage.setItem("sb-popdam-auth-token", "{\"access_token\":\"x\"}");
    localStorage.setItem("sb-popdam-auth-token-code-verifier", "v");
    const { result } = setup();
    await waitFor(() => expect(result.current.user).not.toBeNull());
    await act(() => result.current.signOut());
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(localStorage.getItem("sb-popdam-auth-token")).toBeNull();
    expect(localStorage.getItem("sb-popdam-auth-token-code-verifier")).toBeNull();
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });
});
