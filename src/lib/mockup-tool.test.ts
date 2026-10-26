import { describe, expect, it } from "vitest";
import { buildMockupUrl } from "@/lib/mockup-tool";

describe("buildMockupUrl", () => {
  it("rewrites a Spaces thumbnail to the same-origin /spaces proxy", () => {
    const url = buildMockupUrl(
      "https://popdam.nyc3.digitaloceanspaces.com/thumbnails/abc-123.jpg",
      "Mickey Icon Final.ai",
    );
    expect(url).toBe(
      `/mockup/?${new URLSearchParams({
        art: "/spaces/thumbnails/abc-123.jpg",
        name: "Mickey Icon Final.ai",
      }).toString()}#/canvas`,
    );
  });

  it("passes a non-URL art value through unchanged", () => {
    const url = buildMockupUrl("images/pic.jpg", null);
    expect(url).toContain(`art=${encodeURIComponent("images/pic.jpg")}`);
    expect(url).toContain("name=art");
  });
});
