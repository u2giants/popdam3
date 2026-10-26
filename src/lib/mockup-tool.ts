// Product Mockups tool — vendored single-file app in public/mockup/index.html,
// source of truth: github.com/u2giants/pop-mock (keep both in sync on release).
// It accepts ?art=<image url>&name=<file name> plus a #/<product> route, and
// opens the art in the Canvas product. The thumbnail URL is rewritten to the
// same-origin /spaces/ proxy (see nginx.conf) so the tool can read image
// pixels without any Spaces CORS setup.
export function buildMockupUrl(
  thumbnailUrl: string,
  filename: string | null | undefined,
): string {
  let art = thumbnailUrl;
  try {
    const u = new URL(thumbnailUrl);
    art = `/spaces${u.pathname}${u.search}`;
  } catch {
    // not a full URL — pass through; the tool reports if it cannot load it
  }
  const params = new URLSearchParams({ art, name: filename || "art" });
  return `/mockup/?${params.toString()}#/canvas`;
}
