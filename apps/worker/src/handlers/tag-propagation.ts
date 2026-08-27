/**
 * Legacy `propagate-group-tags` entry point.
 *
 * This operation used to copy one asset's tags, characters, and identity onto
 * every sibling in the Style Group, which is exactly the cross-file contamination
 * issue #96 exists to remove. It is now a thin compatibility alias over the safe
 * group-metadata refresh: the user keeps the capability, but no asset row is ever
 * read from or written to by it.
 *
 * The canonical key is `refresh-group-metadata`. This alias stays until the
 * shared-db orchestrator retires `propagate_group_tags_batch` in a later additive
 * migration, after production has run one full cycle safely.
 */

import type { BatchResult, OpState } from "../types.js";
import { handleLegacyPropagationAlias, type RefreshDependencies } from "./group-metadata-refresh.js";

export async function handlePropagateGroupTags(
  opState: OpState,
  dependencies: RefreshDependencies = {},
): Promise<BatchResult> {
  return handleLegacyPropagationAlias(opState, dependencies);
}
