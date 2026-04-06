## Mega-Group Tag Contamination — Scope & Surgical Cleanup Plan

### What Happened

14 "mega-groups" exist where the SKU regex matched a product-type folder (e.g. "3D Lenticular framed") instead of the design-specific folder. This lumped 100–2,000 unrelated designs (Disney, Marvel, Sonic, NASA, Star Wars, etc.) into a single style group. When tag propagation ran, it spread every license's tags to every sibling — cross-contaminating the entire group.  


### Scope of Damage


| Metric                                            | Count                                 |
| ------------------------------------------------- | ------------------------------------- |
| Mega-groups (>50 assets)                          | ~20                                   |
| Assets affected                                   | ~9,500                                |
| Contaminated AI tag rows                          | **154,224** (21% of all 726K AI tags) |
| Contaminated metadata fields (theme, description) | ~6,861 assets                         |


### Can We Differentiate Good Tags from Bad?

**Yes.** Two clean signals exist:

1. `**ai_tagged_at` timestamp on each asset** — assets that were directly AI-tagged have this set. Assets that only received propagated tags have `ai_tagged_at = NULL`.
2. `**asset_tags.created_at` vs `ai_tagged_at**` — for directly-tagged assets, their *original* tags were created within seconds of `ai_tagged_at`. Tags injected later by propagation have `created_at > ai_tagged_at + 5 minutes`. This cleanly splits original (4–18 tags) from contaminated (+41 propagated tags) on every asset tested.

### The Plan (3 steps)

**Step 1 — Delete contaminated tags (surgical)**

Create a database function `cleanup_mega_group_tags` that:

- For each mega-group (style_groups with asset_count > threshold, configurable):
  - **Non-directly-tagged assets** (`ai_tagged_at IS NULL`): delete ALL `source='ai'` tags (they're 100% propagated garbage). Also null out propagated metadata fields (`big_theme`, `little_theme`, `design_style`, `cover_description`).
  - **Directly-tagged assets** (`ai_tagged_at IS NOT NULL`): delete only AI tags where `created_at > ai_tagged_at + interval '5 minutes'` (the foreign tags injected by propagation). Keep their original tags intact.
- Also clean `asset_characters` rows that were propagated the same way.
- Process in batches with cursor-based pagination (same pattern as other bulk ops).

**Step 2 — Split mega-groups into correct sub-groups**

After cleaning tags, run the existing `rebuild_style_groups_batch` function. Since assets already have their correct `sku` field populated (178 distinct real SKUs exist inside the biggest mega-group alone), the rebuild will create proper granular groups. The contaminated mega-group records get replaced.  
And also correct the logic that allowed this to happen in the first place.

**Step 3 — Re-propagate within correct groups**

After regrouping, run a normal tag propagation pass. Now each group contains only siblings of the same design, so propagation will correctly share tags within each small group.

### Files Changed

1. **New migration** — `cleanup_mega_group_tags_batch(p_cursor, p_batch_size, p_min_group_size)` plpgsql function that does the surgical tag deletion described above.
2. `**supabase/functions/_shared/admin-handlers/style-group-handlers.ts**` — Add `handleCleanupMegaGroupTags` handler that calls the new RPC.
3. `**supabase/functions/admin-api/index.ts**` — Wire up the new `cleanup-mega-group-tags` action.
4. `**supabase/functions/_shared/operation-constants.ts**` — Add the new operation key/lane/action.
5. `**src/components/settings/diagnostics/types.ts**` — Add the frontend operation type.
6. `**src/components/settings/diagnostics/StyleGroupsSection.tsx**` — Add a "Clean Mega-Group Tags" button to the diagnostics panel, runnable as a persistent operation through the worker.
7. `**apps/worker/src/handlers/style-groups.ts**` — Add worker handler for the new cleanup operation.

### Safety

- The cleanup function only touches groups with `asset_count > threshold` (default 50).
- if a group has more than 30 assets in it The system has to know that that's suspect / highly unusual and give an alert and stop what's it doing or stop whatever process or logic that led to more than 50 assets being grouped together. 
- Directly-tagged assets keep all their original tags (timestamp-gated).
- The function is idempotent — running it twice changes nothing.
- Tags with `source = 'manual'` are never touched.
- A dry-run mode (count-only) can be added for verification before committing.