import { corsServe, err } from "../_shared/http.ts";

// Retired 2026-07-23. Licensors and properties are shared master data owned by
// core.licensor/core.property and populated by the canonical shared-db PLM
// feeder. Keeping the former PopDAM-only writer alive would recreate a second
// source of truth and produce UUIDs that cannot satisfy the canonical FKs.
corsServe(async (req: Request) => {
  if (req.method !== "POST") return err("Method not allowed", 405);
  return err(
    "This taxonomy sync is retired. Licensors and properties now come from core.licensor and core.property via the shared DesignFlow master-data feed.",
    410,
  );
});
