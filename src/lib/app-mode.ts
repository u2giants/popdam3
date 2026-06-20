/**
 * App mode detection — one codebase serves two sites:
 *   dam.designflow.app → PopDAM (licensed product-art DAM)
 *   sg.designflow.app  → PopSG  (licensor style-guide library)
 *
 * Both modes connect to the same Supabase project (PopDAM). PopSG is a
 * workspace within that project — same agent, same DB, different scan roots,
 * different UI. Mode controls routing and UI only, not which Supabase to hit.
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

export const POPDAM_SUPABASE_PROJECT_REF = "qsllyeztdwjgirsysgai";
export const POPDAM_SUPABASE_URL = `https://${POPDAM_SUPABASE_PROJECT_REF}.supabase.co`;
export const POPDAM_ANON_KEY = "sb_publishable_DzKBYH1jmWYDuA3ONUrPQQ_0EFEUSbE";

export const APP_CONFIG = {
  popdam: {
    mode: "popdam" as const,
    name: "PopDAM",
    tagline: "Digital Asset Manager",
    domain: "dam.designflow.app",
    supabaseUrl: POPDAM_SUPABASE_URL,
    supabaseAnonKey: POPDAM_ANON_KEY,
  },
  popsg: {
    mode: "popsg" as const,
    name: "PopSG",
    tagline: "Licensor Style Guides",
    domain: "sg.designflow.app",
    // Same Supabase project as PopDAM — PopSG is a workspace within it.
    supabaseUrl: POPDAM_SUPABASE_URL,
    supabaseAnonKey: POPDAM_ANON_KEY,
  },
} as const;

export const APP_MODE: AppMode = detectMode();
export const CURRENT_APP = APP_CONFIG[APP_MODE];
export const IS_POPSG = APP_MODE === "popsg";
export const IS_POPDAM = APP_MODE === "popdam";
