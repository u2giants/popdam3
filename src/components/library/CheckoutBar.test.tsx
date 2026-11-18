import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const state: Record<string, unknown> = {};
vi.mock("@/hooks/useAssetCheckout", () => ({
  useAssetCheckout: () => ({
    checkoutBusy: false,
    refetchCheckout: vi.fn(),
    handleCheckout: vi.fn(),
    handleCheckin: vi.fn(),
    handleDiscard: vi.fn(),
    ...state,
  }),
}));

import CheckoutBar from "./CheckoutBar";

const lock = { id: "c1", status: "active", checked_out_at: "2026-11-18T12:00:00Z", user_id: "u1" };

describe("CheckoutBar (popdam3#1089)", () => {
  beforeEach(() => {
    for (const k of Object.keys(state)) delete state[k];
  });

  it("shows an unavailable state, not Check Out, when the lookup fails", () => {
    Object.assign(state, { checkout: undefined, checkoutStatus: "error", currentUser: { id: "u1" } });
    render(<CheckoutBar assetId="a" />);
    expect(screen.getByText("Status unavailable")).toBeTruthy();
    expect(screen.queryByText("Check Out")).toBeNull();
  });

  it("does not offer Check Out while status is loading", () => {
    Object.assign(state, { checkout: undefined, checkoutStatus: "loading", currentUser: { id: "u1" } });
    render(<CheckoutBar assetId="a" />);
    expect(screen.queryByText("Check Out")).toBeNull();
  });

  it("keeps Check In and Discard for the owner when their profile is unavailable", () => {
    Object.assign(state, {
      checkout: { ...lock, profiles: null },
      checkoutStatus: "ready",
      currentUser: { id: "u1", email: "owner@example.com" },
    });
    render(<CheckoutBar assetId="a" />);
    expect(screen.getByText("Check In")).toBeTruthy();
    expect(screen.getByTitle("Discard checkout")).toBeTruthy();
  });

  it("uses owner ID, not email, to decide ownership", () => {
    Object.assign(state, {
      checkout: { ...lock, profiles: { full_name: "Owner", email: "same@example.com" } },
      checkoutStatus: "ready",
      currentUser: { id: "u2", email: "same@example.com" },
    });
    render(<CheckoutBar assetId="a" />);
    expect(screen.queryByText("Check In")).toBeNull();
    expect(screen.getByText("Owner")).toBeTruthy();
  });

  it("offers Check Out when the asset is confirmed unlocked", () => {
    Object.assign(state, { checkout: null, checkoutStatus: "ready", currentUser: { id: "u1" } });
    render(<CheckoutBar assetId="a" />);
    expect(screen.getByText("Check Out")).toBeTruthy();
  });
});
