import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import StyleGroupDetailPanel from "@/components/library/StyleGroupDetailPanel";
import type { StyleGroup } from "@/hooks/useStyleGroups";

const group: StyleGroup = {
  id: "g1",
  sku: "VDE86MVSP01",
  folder_path: "/MARVEL/VDE86MVSP01",
  primary_asset_id: "a1",
  asset_count: 2,
  workflow_status: "approved",
  is_licensed: true,
  licensor_id: null,
  licensor_code: "MARVEL",
  licensor_name: "MARVEL",
  property_id: null,
  property_code: null,
  property_name: "Spiderman",
  product_category: "Mat",
  division_code: null,
  division_name: null,
  mg01_code: null,
  mg01_name: null,
  mg02_code: null,
  mg02_name: null,
  mg03_code: null,
  mg03_name: null,
  size_code: null,
  size_name: null,
  thumbnail_url: "https://popdam.nyc3.digitaloceanspaces.com/thumbnails/g1.jpg",
  latest_file_date: null,
  designer_name: null,
  technical_designer_name: null,
  freelancer_name: null,
  designer_conflict: false,
  created_at: "2026-10-26T00:00:00Z",
  updated_at: "2026-10-26T00:00:00Z",
  cover_description: null,
  stage: null,
  customer: null,
  program: null,
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StyleGroupDetailPanel group={group} width={420} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("StyleGroupDetailPanel mockup button", () => {
  it("shows the mockup button when the group has a thumbnail", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Create product mockup" })).toBeInTheDocument();
  });

  it("opens the tool with the group thumbnail through the /spaces proxy", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Create product mockup" }));
    expect(open).toHaveBeenCalledWith(
      "/mockup/?art=%2Fspaces%2Fthumbnails%2Fg1.jpg&name=VDE86MVSP01#/canvas",
      "_blank",
      "noopener",
    );
    vi.unstubAllGlobals();
  });
});
