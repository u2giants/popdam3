import { describe, expect, it } from "vitest";
import { buildMockupUrl, pickMockupRoute } from "@/lib/mockup-tool";

describe("buildMockupUrl", () => {
  it("rewrites a Spaces thumbnail to the same-origin /spaces proxy", () => {
    const url = buildMockupUrl({
      art: "https://popdam.nyc3.digitaloceanspaces.com/thumbnails/abc-123.jpg",
      name: "Mickey Icon Final.ai",
    });
    expect(url).toBe(
      `/mockup/?${new URLSearchParams({
        art: "/spaces/thumbnails/abc-123.jpg",
        name: "Mickey Icon Final.ai",
      }).toString()}#/canvas`,
    );
  });

  it("passes a non-URL art value through unchanged", () => {
    const url = buildMockupUrl({ art: "images/pic.jpg" });
    expect(url).toContain(`art=${encodeURIComponent("images/pic.jpg")}`);
    expect(url).toContain("name=art");
  });

  it("emits artB/nameB and lenticular route", () => {
    const url = buildMockupUrl({
      art: "/spaces/pdf-pages/a1_p1.jpg",
      name: "Front.ai",
      artB: "https://popdam.nyc3.digitaloceanspaces.com/pdf-pages/a1_p2.jpg",
      nameB: "Back.ai",
      route: "lenticular",
    });
    expect(url).toBe(
      `/mockup/?${new URLSearchParams({
        art: "/spaces/pdf-pages/a1_p1.jpg",
        name: "Front.ai",
        artB: "/spaces/pdf-pages/a1_p2.jpg",
        nameB: "Back.ai",
      }).toString()}#/lenticular`,
    );
  });

  it("includes fallback param", () => {
    const url = buildMockupUrl({
      art: "/spaces/pdf-pages/a1_p1.jpg",
      name: "Front.ai",
      fallback:
        "https://popdam.nyc3.digitaloceanspaces.com/thumbnails/a1.jpg",
      route: "lenticular",
    });
    expect(url).toContain(
      `fallback=${encodeURIComponent("/spaces/thumbnails/a1.jpg")}`,
    );
    expect(url.endsWith("#/lenticular")).toBe(true);
  });

  it("keeps query in proxied path", () => {
    const url = buildMockupUrl({
      art: "https://popdam.nyc3.digitaloceanspaces.com/pdf-pages/a1_p2.jpg?token=abc%20d",
      name: "p2",
      artB: null,
    });
    expect(url).toContain(
      `art=${encodeURIComponent("/spaces/pdf-pages/a1_p2.jpg?token=abc%20d")}`,
    );
  });

  it("encodes hostile names", () => {
    const url = buildMockupUrl({
      art: "/spaces/thumbnails/x.jpg",
      name: 'weird "#/@§\nemoji 🎃 name',
      artB: "/spaces/thumbnails/y.jpg",
      nameB: "also #/weird",
    });
    const query = url.slice("/mockup/?".length, url.lastIndexOf("#/"));
    const params = new URLSearchParams(query);
    expect(params.get("name")).toBe('weird "#/@§\nemoji 🎃 name');
    expect(params.get("nameB")).toBe("also #/weird");
    // a raw # in the query would truncate it and break the #/route suffix
    expect(query.includes("#")).toBe(false);
    expect(url.endsWith("#/canvas")).toBe(true);
  });
});

describe("pickMockupRoute", () => {
  it("ranks lenticular above framed", () => {
    expect(
      pickMockupRoute(["Venom And Spiderman Framed 3D Lenticular"]),
    ).toBe("lenticular");
    expect(pickMockupRoute(["Framed Lenticular", null, ""])).toBe(
      "lenticular",
    );
  });

  it("matches canvas inside decorated names", () => {
    expect(pickMockupRoute(["Glow in the dark Canvas with foil"])).toBe(
      "canvas",
    );
  });

  it("defaults to canvas", () => {
    expect(pickMockupRoute([])).toBe("canvas");
    expect(pickMockupRoute([null, undefined, "   "])).toBe("canvas");
    expect(pickMockupRoute(["Tin Sign", "Tapestry", "Hamper"])).toBe("canvas");
  });

  it("sends clock to clock", () => {
    expect(pickMockupRoute(["Spider-Man Wall Clock 10in"])).toBe("clock");
  });

  it("sends the other product keywords to their routes", () => {
    expect(pickMockupRoute(["MDF shadowbox with Die-cut 3D Layer"])).toBe(
      "shadowbox",
    );
    expect(pickMockupRoute(["Shadow Box Portrait"])).toBe("shadowbox");
    expect(pickMockupRoute(["Bombers Framed Print"])).toBe("framed");
    expect(pickMockupRoute(["Stager 4 Piece Set"])).toBe("stager");
    expect(pickMockupRoute(["Four Piece Stager"])).toBe("stager");
    expect(pickMockupRoute(["Arched Shaped Frame"])).toBe("shaped");
    expect(pickMockupRoute(["MDF Die-Cut Plaque"])).toBe("plaque");
  });
});
