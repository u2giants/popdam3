import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { signOut } } }));
import SearchAccessNotice from "@/components/library/SearchAccessNotice";

describe("search access notice", () => {
  beforeEach(() => signOut.mockReset());
  it("shows access instructions without logging out a denied user", () => {
    render(<SearchAccessNotice expired={false} />);
    expect(screen.getByText("You don't have PopDAM access yet")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });
  it("offers sign-in for expired sessions and preserves a failed sign-out for retry", async () => {
    signOut.mockResolvedValue({ error: new Error("offline") });
    render(<SearchAccessNotice expired />);
    expect(screen.getByText("Your session has expired")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(await screen.findByText("Couldn't open sign-in. Please try again.")).toBeInTheDocument();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(screen.getByRole("button")).toBeEnabled();
  });
});
