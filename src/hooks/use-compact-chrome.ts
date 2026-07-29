import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * "Compact chrome" mode. On short or narrow viewports the stacked app chrome
 * (header + library toolbar + view toggles + bulk-action bar) eats too much
 * vertical space, so we collapse it into two rows and shrink the detail-panel
 * hero. 1920x1200 (~1080px of viewport height) matches on the height rule.
 */
export const COMPACT_CHROME_QUERY = "(max-height: 1300px), (max-width: 1700px)";

export function useCompactChrome(): boolean {
  return useMediaQuery(COMPACT_CHROME_QUERY);
}
