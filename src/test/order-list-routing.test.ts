import { describe, expect, it } from "vitest";

async function readSource(relativePath: string) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(path.resolve(__dirname, relativePath), "utf8");
}

describe("OrderList route and navigation", () => {
  it("registers /orders inside the protected layout", async () => {
    const source = await readSource("../App.tsx");
    const route = source.slice(source.indexOf("<Route element={<ProtectedRoute>"), source.indexOf('<Route path="*"'));
    expect(route).toContain('<Route path="/orders" element={<OrdersPage />} />');
  });

  it("never exposes OrderList in PopSG", async () => {
    const source = await readSource("../App.tsx");
    expect(source).toContain('{!IS_POPSG && <Route path="/orders" element={<OrdersPage />} />}');

    const header = await readSource("../components/AppHeader.tsx");
    const popsgNav = header.slice(header.indexOf("const popsgNavItems"), header.indexOf("const navItems"));
    expect(popsgNav).not.toContain("/orders");
  });

  it("adds Orders to PopDAM navigation, including the compact menu", async () => {
    const header = await readSource("../components/AppHeader.tsx");
    const popdamNav = header.slice(header.indexOf("const popdamNavItems"), header.indexOf("const popsgNavItems"));
    expect(popdamNav).toContain('{ to: "/orders", label: "Orders", icon: ClipboardList }');
    expect(header).toContain('const SECONDARY_NAV_LABELS = new Set(["Sell-through", "Master Data", "Orders", "Setup"]);');
  });
});
