/**
 * Frontend defaults for image similarity (plan Muse 18). The canonical logic
 * lives in supabase/functions/_shared/image-similarity-config.ts and is
 * re-exported here (same pattern as search-access / dam-search.ts).
 */
export {
  BAND_LABELS,
  IMAGE_SIM_DEFAULTS,
  IMAGE_SIM_ENABLED_KEY,
  bandForScore,
  buildModelStamps,
  configValue,
  parseFlag,
  parseNumber01,
  parsePositiveInt,
  resolveTunables,
  sniffMagicBytes,
  validateUploadPayload,
} from "../../supabase/functions/_shared/image-similarity-config";
export type {
  ImageSimBand,
  ImageSimMatch,
  ImageSimResponse,
  ImageSimTunables,
  UploadValidation,
} from "../../supabase/functions/_shared/image-similarity-config";
