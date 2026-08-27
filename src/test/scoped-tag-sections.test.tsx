import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScopedTagSections } from "@/components/library/ScopedTagSections";
import type { EffectiveTag } from "@/hooks/useEffectiveAssetTags";

function tag(over: Partial<EffectiveTag> = {}): EffectiveTag {
  return {
    scope: "asset",
    tag: "blue",
    category: "color",
    source: "ai",
    status: "active",
    confidence: 0.9,
    model: "test/model",
    createdBy: null,
    ...over,
  };
}

function renderSections(props: Partial<React.ComponentProps<typeof ScopedTagSections>> = {}) {
  const onAction = vi.fn();
  render(
    <TooltipProvider>
      <ScopedTagSections
        groupTags={[]}
        groupCandidates={[]}
        assetTags={[]}
        assetCandidates={[]}
        rejected={[]}
        hasStyleGroup
        editing={false}
        onAction={onAction}
        canReview
        canEditGroup
        {...props}
      />
    </TooltipProvider>,
  );
  return { onAction };
}

describe("Style Group vs This file tag sections", () => {
  it("shows shared product facts and this file's facts under separate headings", () => {
    renderSections({
      groupTags: [tag({ scope: "style_group", tag: "drinkware", source: "authoritative" })],
      assetTags: [tag({ tag: "3/4 view", category: "view" })],
    });
    expect(screen.getByText("Style Group")).toBeInTheDocument();
    expect(screen.getByText("This file")).toBeInTheDocument();
    expect(screen.getByText("drinkware")).toBeInTheDocument();
    expect(screen.getByText("3/4 view")).toBeInTheDocument();
  });

  it("hides the Style Group section for an ungrouped file", () => {
    renderSections({ hasStyleGroup: false, assetTags: [tag()] });
    expect(screen.queryByText("Style Group")).not.toBeInTheDocument();
    expect(screen.getByText("This file")).toBeInTheDocument();
  });

  it("defaults a new tag to this file, not the whole group", async () => {
    const { onAction } = renderSections({ editing: true });
    fireEvent.change(screen.getByPlaceholderText("Add a fact about this file…"), { target: { value: "Zipper" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ scope: "asset", tag: "zipper", action: "add" }));
  });

  it("adds to the whole group only after that scope is chosen deliberately", async () => {
    const { onAction } = renderSections({ editing: true });
    fireEvent.click(screen.getByRole("button", { name: "Whole Style Group" }));
    fireEvent.change(screen.getByPlaceholderText("Add a shared product fact…"), { target: { value: "gift" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ scope: "style_group", tag: "gift", action: "add" }));
  });

  it("offers confirm on a candidate and remove on a confirmed AI fact", async () => {
    const { onAction } = renderSections({
      editing: true,
      assetCandidates: [tag({ tag: "zipper", status: "candidate" })],
      assetTags: [tag({ tag: "blue" })],
    });
    fireEvent.click(screen.getByLabelText("Confirm zipper"));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ scope: "asset", tag: "zipper", action: "approve" }));
    fireEvent.click(screen.getByLabelText("Remove blue"));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ scope: "asset", tag: "blue", action: "remove" }));
  });

  it("never offers to remove a fact that comes from business data", () => {
    renderSections({
      editing: true,
      groupTags: [tag({ scope: "style_group", tag: "drinkware", source: "authoritative" })],
    });
    expect(screen.queryByLabelText("Remove drinkware")).not.toBeInTheDocument();
  });

  it("shows rejected facts while editing so a mistake can be undone", async () => {
    const { onAction } = renderSections({
      editing: true,
      rejected: [tag({ tag: "pink", status: "rejected" })],
    });
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Restore pink"));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ scope: "asset", tag: "pink", action: "restore" }));
  });

  it("explains a file with no usable preview instead of showing it as untagged", () => {
    renderSections({ visualAnalysisUnavailable: true });
    expect(screen.getByText(/Visual analysis unavailable/)).toBeInTheDocument();
    expect(screen.queryByText("No file tags")).not.toBeInTheDocument();
  });

  it("keeps candidates out of the confirmed list", () => {
    renderSections({
      assetTags: [tag({ tag: "blue" })],
      assetCandidates: [tag({ tag: "zipper", status: "candidate" })],
    });
    expect(screen.getByText(/Suggested — confirm to make searchable/)).toBeInTheDocument();
  });

  it("hides shared-group editing and review controls from a user without authority", () => {
    renderSections({
      editing: true,
      canEditGroup: false,
      canReview: false,
      groupTags: [tag({ scope: "style_group", tag: "floral", source: "group_ai" })],
      assetTags: [tag({ tag: "blue" })],
      assetCandidates: [tag({ tag: "zipper", status: "candidate" })],
    });
    // The shared product fact is visible but not changeable.
    expect(screen.getByText("floral")).toBeInTheDocument();
    expect(screen.queryByLabelText("Remove floral")).not.toBeInTheDocument();
    // Neither is the scope switch that would create one.
    expect(screen.queryByRole("button", { name: "Whole Style Group" })).not.toBeInTheDocument();
    // Confirming a suggestion is a decision for everyone, so it is gated too.
    expect(screen.queryByLabelText("Confirm zipper")).not.toBeInTheDocument();
    // Their own file tags remain theirs to manage.
    expect(screen.getByLabelText("Remove blue")).toBeInTheDocument();
  });

  it("returns to This file after a group add so the scope cannot persist unnoticed", async () => {
    const { onAction } = renderSections({ editing: true });
    fireEvent.click(screen.getByRole("button", { name: "Whole Style Group" }));
    fireEvent.change(screen.getByPlaceholderText("Add a shared product fact…"), { target: { value: "gift" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ scope: "style_group", tag: "gift", action: "add" }));
    await waitFor(() => expect(screen.getByPlaceholderText("Add a fact about this file…")).toBeInTheDocument());
  });
});