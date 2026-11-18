// Decides when the bridge update screen may report a result (#1092).
// A result only counts if it was produced after the current request, and an
// install is only confirmed once the agent itself reports the new build.

export type UpdateStatus = Record<string, unknown>;
export type AgentRow = Record<string, unknown>;

function ms(v: unknown): number {
  if (typeof v !== "string") return NaN;
  return Date.parse(v);
}

/** True when an AGENT_UPDATE_STATUS row was reported for the request made at `requestedAt`. */
export function isStatusForRequest(status: UpdateStatus | null | undefined, requestedAt: string): boolean {
  if (!status) return false;
  const reported = ms(status.reported_at);
  const requested = ms(requestedAt);
  if (Number.isNaN(reported) || Number.isNaN(requested)) return false;
  if (status.agent_type !== undefined && status.agent_type !== "bridge") return false;
  return reported >= requested;
}

export interface InstallBaseline {
  requestedAt: string;
  fromVersion: string | null;
  fromSha: string | null;
  targetVersion: string | null;
  targetSha: string | null;
}

/** True only when the agent is heartbeating after the request and reports the new build. */
export function isInstallConfirmed(agent: AgentRow | null | undefined, base: InstallBaseline): boolean {
  if (!agent || agent.status !== "online") return false;
  const hb = ms(agent.last_heartbeat);
  const requested = ms(base.requestedAt);
  if (Number.isNaN(hb) || Number.isNaN(requested) || hb <= requested) return false;
  const vi = (agent.version_info as Record<string, unknown> | null) || {};
  const sha = typeof vi.build_sha === "string" ? vi.build_sha : null;
  const version = typeof vi.version === "string" ? vi.version : null;
  if (base.targetSha && sha) return sha === base.targetSha;
  if (base.targetVersion && version) return version === base.targetVersion;
  // No published target known: require evidence the build actually changed.
  if (base.fromSha && sha) return sha !== base.fromSha;
  if (base.fromVersion && version) return version !== base.fromVersion;
  return false;
}
