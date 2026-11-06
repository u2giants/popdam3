import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach } from "vitest";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import StyleGroupDetailPanel from "@/components/library/StyleGroupDetailPanel";
import type { StyleGroup } from "@/hooks/useStyleGroups";

// Supabase mock: every table query resolves from `tables`; unlisted tables
// resolve null so the panel falls back to group-level data.
const h = vi.hoisted(() => {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  const makeChain = (rows: () => Array<Record<string, unknown>> | null): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "in", "or", "not", "is"]) {
      chain[m] = () => chain;
    }
    chain.then = (res: unknown, rej: unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(res as never, rej as never);
    return chain;
  };
  return { tables, makeChain };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => h.makeChain(() => h.tables[t] ?? null),
    schema: () => ({ from: (t: string) => h.makeChain(() => h.tables[t] ?? null) }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  },
}));

const baseGroup: StyleGroup = {
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

function assetRow(over: Record<string, unknown>) {
  return {
    id: "a1",
    style_group_id: "g1",
    filename: "Front.ai",
    thumbnail_url: "https://popdam.nyc3.digitaloceanspaces.com/thumbnails/a1.jpg",
    pdf_page2_url: null,
    relative_path: "/MARVEL/VDE86MVSP01/Front.ai",
    is_deleted: false,
    file_size: 1024,
    file_created_at: "2026-10-26T00:00:00Z",
    modified_at: "2026-10-26T00:00:00Z",
    created_at: "2026-10-26T00:00:00Z",
    updated_at: "2026-10-26T00:00:00Z",
    ...over,
  };
}

function renderPanel(group: StyleGroup) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StyleGroupDetailPanel group={group} width={420} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

async function waitForHeroThumbnail(srcPart: string) {
  await waitFor(() => {
    const imgs = screen.getAllByRole("img", { name: baseGroup.sku }) as HTMLImageElement[];
    expect(imgs.some((i) => (i.getAttribute("src") ?? "").includes(srcPart))).toBe(true);
  });
}

function clickMockupButton() {
  fireEvent.click(screen.getByRole("button", { name: "Create product mockup" }));
}

describe("StyleGroupDetailPanel mockup button", () => {
  beforeEach(() => {
    delete h.tables["assets"];
  });

  it("shows the mockup button when the group has a thumbnail", () => {
    renderPanel(baseGroup);
    expect(screen.getByRole("button", { name: "Create product mockup" })).toBeInTheDocument();
  });

  it("opens the tool with the group thumbnail through the /spaces proxy", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    renderPanel(baseGroup);
    clickMockupButton();
    expect(open).toHaveBeenCalledWith(
      "/mockup/?art=%2Fspaces%2Fthumbnails%2Fg1.jpg&name=VDE86MVSP01#/canvas",
      "_blank",
      "noopener",
    );
    vi.unstubAllGlobals();
  });

  it("non-lenticular group sends single art and matched route", async () => {
    h.tables["assets"] = [assetRow({})];
    const open = vi.fn();
    vi.stubGlobal("open", open);
    renderPanel({ ...baseGroup, item_short_description: "Bombers Framed Print" });
    await waitForHeroThumbnail("thumbnails/a1.jpg");
    clickMockupButton();
    expect(open).toHaveBeenCalledTimes(1);
    const url = open.mock.calls[0][0] as string;
    expect(url.startsWith("/mockup/?art=")).toBe(true);
    expect(url).toContain(encodeURIComponent("/spaces/thumbnails/a1.jpg"));
    expect(url).not.toContain("artB=");
    expect(url.endsWith("#/framed")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("lenticular group sends page renders as A and B", async () => {
    h.tables["assets"] = [
      assetRow({
        pdf_page2_url: "https://popdam.nyc3.digitaloceanspaces.com/pdf-pages/a1_p2.jpg",
      }),
      assetRow({ id: "a2", filename: "Back.ai" }),
    ];
    const open = vi.fn();
    vi.stubGlobal("open", open);
    renderPanel({ ...baseGroup, item_short_description: "Venom Framed Lenticular" });
    // wait for the style-group-assets query to resolve so the hero uses the asset
    await waitForHeroThumbnail("thumbnails/a1.jpg");
    clickMockupButton();
    expect(open).toHaveBeenCalledTimes(1);
    const url = open.mock.calls[0][0] as string;
    const query = url.slice("/mockup/?".length, url.lastIndexOf("#/"));
    const params = new URLSearchParams(query);
    expect(params.get("art")).toBe("/spaces/pdf-pages/a1_p1.jpg");
    expect(params.get("artB")).toBe("/spaces/pdf-pages/a1_p2.jpg");
    expect(params.get("fallback")).toBe("/spaces/thumbnails/a1.jpg");
    expect(url.endsWith("#/lenticular")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("lenticular with one file sends no artB", async () => {
    h.tables["assets"] = [assetRow({})];
    const open = vi.fn();
    vi.stubGlobal("open", open);
    renderPanel({ ...baseGroup, item_short_description: "Framed 3D Lenticular" });
    await waitForHeroThumbnail("thumbnails/a1.jpg");
    clickMockupButton();
    expect(open).toHaveBeenCalledTimes(1);
    const url = open.mock.calls[0][0] as string;
    expect(url).toContain(encodeURIComponent("/spaces/thumbnails/a1.jpg"));
    expect(url).not.toContain("artB=");
    expect(url.endsWith("#/lenticular")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("lenticular without page renders uses the next thumbnail as B", async () => {
    h.tables["assets"] = [
      assetRow({}),
      assetRow({
        id: "a2",
        filename: "Back.ai",
        thumbnail_url: "https://popdam.nyc3.digitaloceanspaces.com/thumbnails/a2.jpg",
      }),
    ];
    const open = vi.fn();
    vi.stubGlobal("open", open);
    renderPanel({ ...baseGroup, cover_description: "Spider-Man Web Lenticular" });
    await waitForHeroThumbnail("thumbnails/a1.jpg");
    clickMockupButton();
    expect(open).toHaveBeenCalledTimes(1);
    const url = open.mock.calls[0][0] as string;
    const query = url.slice("/mockup/?".length, url.lastIndexOf("#/"));
    const params = new URLSearchParams(query);
    expect(params.get("art")).toBe("/spaces/thumbnails/a1.jpg");
    expect(params.get("artB")).toBe("/spaces/thumbnails/a2.jpg");
    expect(params.get("nameB")).toBe("Back.ai");
    expect(url.endsWith("#/lenticular")).toBe(true);
    vi.unstubAllGlobals();
  });
});
