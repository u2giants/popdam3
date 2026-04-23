/**
 * App mode detection — one codebase serves two sites:
 *   dam.designflow.app → PopDAM (licensed product-art DAM)
 *   sg.designflow.app  → PopSG  (licensor style-guide library)
 *
 * Mode is inferred from window.location.host at runtime. Both Supabase
 * anon keys are publishable and baked into the bundle, selected per-mode.
 *
 * To preview PopSG locally: `?mode=popsg` query param overrides hostname
 * detection (first call only — persisted in sessionStorage for the tab).
 */

export type AppMode = "popdam" | "popsg";

const PREVIEW_STORAGE_KEY = "designflow-app-mode-preview";

function detectMode(): AppMode {
  if (typeof window === "undefined") return "popdam";

  const params = new URLSearchParams(window.location.search);
  const preview = params.get("mode");
  if (preview === "popsg" || preview === "popdam") {
    try {
      sessionStorage.setItem(PREVIEW_STORAGE_KEY, preview);
    } catch {
      // sessionStorage unavailable (private mode, SSR) — fall through
    }
    return preview;
  }
  try {
    const stored = sessionStorage.getItem(PREVIEW_STORAGE_KEY);
    if (stored === "popsg" || stored === "popdam") return stored;
  } catch {
    // sessionStorage unavailable — fall through to hostname detection
  }

  const host = window.location.host.toLowerCase();
  if (host.startsWith("sg.") || host.startsWith("popsg.")) return "popsg";
  return "popdam";
}

export const APP_CONFIG = {
  popdam: {
    mode: "popdam" as const,
    name: "PopDAM",
    tagline: "Digital Asset Manager",
    domain: "dam.designflow.app",
    supabaseUrl: "https://ryltkzzernhwnojzouyb.supabase.co",
    supabaseAnonKey: "sb_publishable_7pDNMn_LIJOkdYmhcI0n7g_IuKABuWK",
  },
  popsg: {
    mode: "popsg" as const,
    name: "PopSG",
    tagline: "Licensor Style Guides",
    domain: "sg.designflow.app",
    supabaseUrl: "https://eeueczxhezfhyrhdmidg.supabase.co",
    supabaseAnonKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVldWVjenhoZXpmaHlyaGRtaWRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTUyNDQsImV4cCI6MjA5MjIzMTI0NH0.EZuS09HZnHu365I0Kt0Uf0EMt-Q0x0j2IzN9xTbU9WU",
  },
} as const;

export const APP_MODE: AppMode = detectMode();
export const CURRENT_APP = APP_CONFIG[APP_MODE];
export const IS_POPSG = APP_MODE === "popsg";
export const IS_POPDAM = APP_MODE === "popdam";
