// Product Mockups tool — vendored single-file app in public/mockup/index.html,
// source of truth: github.com/u2giants/pop-mock (kept in sync automatically by
// pop-mock's sync-popdam.yml release workflow).
// Link contract (pop-mock 7.4+): ?art=<image url>&name=<file name> plus
// &artB=&nameB= (second picture — lenticular windows A/B), &fallback= (backup
// URL when art 404s), and a #/<product> route. Every art URL is rewritten to
// the same-origin /spaces/ proxy (see nginx.conf) so the tool can read image
// pixels without any Spaces CORS setup.

export type MockupRoute =
  | "lenticular"
  | "shadowbox"
  | "clock"
  | "framed"
  | "canvas"
  | "stager"
  | "shaped"
  | "plaque";

/** Keyword → product-route rules, most specific first (rule order wins, not
 * word position: "Framed 3D Lenticular" must land on lenticular, not framed). */
const ROUTE_RULES: ReadonlyArray<{ re: RegExp; route: MockupRoute }> = [
  { re: /lenticular/, route: "lenticular" },
  { re: /shadow\s*box/, route: "shadowbox" },
  { re: /clock/, route: "clock" },
  { re: /framed/, route: "framed" },
  { re: /canvas/, route: "canvas" },
  { re: /stager|4[\s-]*piece|four[\s-]*piece/, route: "stager" },
  { re: /shaped|arch/, route: "shaped" },
  { re: /mdf|die[\s-]*cut/, route: "plaque" },
];

/** Picks the mockup product route from an item's description fields.
 * First rule that matches anywhere in the joined (lowercased) text wins;
 * no match → canvas (the tool's generic product). */
export function pickMockupRoute(
  descriptions: Array<string | null | undefined>,
): MockupRoute {
  const text = descriptions
    .filter((d): d is string => typeof d === "string")
    .join(" ")
    .toLowerCase();
  for (const rule of ROUTE_RULES) if (rule.re.test(text)) return rule.route;
  return "canvas";
}

export interface MockupUrlOptions {
  /** Primary art URL (Spaces URL, /spaces/ proxy path, or relative path). */
  art: string;
  name?: string | null;
  /** Second picture — fills window B on the lenticular product. */
  artB?: string | null;
  nameB?: string | null;
  /** Backup URL the tool tries when `art` fails to load. */
  fallback?: string | null;
  /** Product hash route; defaults to canvas. */
  route?: MockupRoute;
}

function toSpacesProxy(url: string): string {
  try {
    const u = new URL(url);
    return `/spaces${u.pathname}${u.search}`;
  } catch {
    // not a full URL — pass through; the tool reports if it cannot load it
    return url;
  }
}

export function buildMockupUrl(opts: MockupUrlOptions): string {
  const params = new URLSearchParams({
    art: toSpacesProxy(opts.art),
    name: opts.name || "art",
  });
  if (opts.artB) {
    params.set("artB", toSpacesProxy(opts.artB));
    params.set("nameB", opts.nameB || "artB");
  }
  if (opts.fallback) params.set("fallback", toSpacesProxy(opts.fallback));
  return `/mockup/?${params.toString()}#/${opts.route ?? "canvas"}`;
}
