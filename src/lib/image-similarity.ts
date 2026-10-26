/**
 * Browser client for the image-similarity edge function (issue #486).
 *
 * The drop zone stays hidden unless admin_config.IMAGE_SIM_ENABLED is true
 * (one cached admin_config read; the table's SELECT RLS allows every
 * authenticated user).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  IMAGE_SIM_ENABLED_KEY,
  parseFlag,
  type ImageSimMatch,
  type ImageSimResponse,
} from "./image-similarity-config";

export type { ImageSimMatch, ImageSimResponse } from "./image-similarity-config";

let flagPromise: Promise<boolean> | null = null;
let flagExpiresAt = 0;
const FLAG_TTL_MS = 60_000;

export function getImageSimEnabled(): Promise<boolean> {
  if (!flagPromise || Date.now() >= flagExpiresAt) {
    flagExpiresAt = Date.now() + FLAG_TTL_MS;
    flagPromise = (async () => {
      try {
        const { data, error } = await supabase
          .from("admin_config")
          .select("key, value")
          .eq("key", IMAGE_SIM_ENABLED_KEY)
          .maybeSingle();
        if (error) throw error;
        return parseFlag(data?.value);
      } catch {
        flagPromise = null; // transient failure: retry on next mount
        return false;
      }
    })();
  }
  return flagPromise;
}

export function invalidateImageSimFlag(): void {
  flagPromise = null;
  flagExpiresAt = 0;
}

export async function searchByImageBase64(imageBase64: string): Promise<ImageSimResponse> {
  const { data, error } = await supabase.functions.invoke("image-similarity", {
    body: { action: "search", image_base64: imageBase64 },
  });
  // FunctionsHttpError carries the response body; surface the stable shape.
  if (error) {
    const detail = (error as { context?: { payload?: unknown } }).context?.payload;
    if (detail && typeof detail === "object" && "status" in detail) {
      return detail as ImageSimResponse;
    }
    throw error;
  }
  return data as ImageSimResponse;
}

export async function fetchImageSimQueryStatus(queryJobId: string): Promise<ImageSimResponse> {
  const { data, error } = await supabase.functions.invoke("image-similarity", {
    body: { action: "query-status", query_job_id: queryJobId },
  });
  if (error) {
    const detail = (error as { context?: { payload?: unknown } }).context?.payload;
    if (detail && typeof detail === "object" && "status" in detail) {
      return detail as ImageSimResponse;
    }
    throw error;
  }
  return data as ImageSimResponse;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1)); // strip the data: URL prefix
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export const IMAGE_SIM_UI_POLL_MS = 2_000;
/** Stop the client-side polling loop after this long regardless of state. */
export const IMAGE_SIM_UI_POLL_MAX_MS = 90_000;
