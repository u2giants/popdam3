/**
 * Windows renderers act on `trigger_update` as an install (#1093), so only an
 * apply that is not scoped to the bridge may set it. A check never does.
 */
export function shouldFlagWindowsRenderers(action: string, agentType: unknown): boolean {
  return action === "apply" && agentType !== "bridge";
}
