import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AgentOnlineStatus = "online" | "offline";

export interface ScanCounters {
  files_checked: number;
  candidates_found: number;
  ingested_new: number;
  moved_detected: number;
  updated_existing: number;
  errors: number;
  roots_invalid: number;
  roots_unreadable: number;
  dirs_skipped_permission: number;
  dirs_skipped_excluded?: number;
  files_stat_failed: number;
  files_total_encountered?: number;
  rejected_wrong_type?: number;
  rejected_junk_file?: number;
  noop_unchanged?: number;
  rejected_subfolder?: number;
}

export interface AgentRecord {
  id: string;
  agent_name: string;
  agent_type: string;
  last_heartbeat: string | null;
  isOnline: boolean;
  lastError: string | null;
  lastCounters: ScanCounters | null;
  /** Most recent counter_history entry timestamp */
  lastActivityAt: string | null;
  /** Whether force_stop is set on this agent */
  forceStop: boolean;
}

export interface AgentStatusInfo {
  bridgeStatus: AgentOnlineStatus | "none";
  agents: AgentRecord[];
  status: "online" | "degraded" | "offline" | "none";
  agentCount: number;
  onlineCount: number;
  /** True if any bridge agent has force_stop or scan_abort set */
  scanBlocked: boolean;
  /** Reason scanning is blocked, if any */
  scanBlockedReason: string | null;
}

const TWO_MIN = 2 * 60 * 1000;

function isOnline(hb: string | null): boolean {
  return !!hb && Date.now() - new Date(hb).getTime() < TWO_MIN;
}

function parseCounters(raw: unknown): ScanCounters | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    files_checked: Number(r.files_checked ?? 0),
    candidates_found: Number(r.candidates_found ?? 0),
    ingested_new: Number(r.ingested_new ?? 0),
    moved_detected: Number(r.moved_detected ?? 0),
    updated_existing: Number(r.updated_existing ?? 0),
    errors: Number(r.errors ?? 0),
    roots_invalid: Number(r.roots_invalid ?? 0),
    roots_unreadable: Number(r.roots_unreadable ?? 0),
    dirs_skipped_permission: Number(r.dirs_skipped_permission ?? 0),
    dirs_skipped_excluded: Number(r.dirs_skipped_excluded ?? 0),
    files_stat_failed: Number(r.files_stat_failed ?? 0),
    files_total_encountered: Number(r.files_total_encountered ?? 0),
    rejected_wrong_type: Number(r.rejected_wrong_type ?? 0),
    rejected_junk_file: Number(r.rejected_junk_file ?? 0),
    noop_unchanged: Number(r.noop_unchanged ?? 0),
  };
}

const DEFAULT_STATUS: AgentStatusInfo = {
  bridgeStatus: "none",
  agents: [],
  status: "none",
  agentCount: 0,
  onlineCount: 0,
  scanBlocked: true,
  scanBlockedReason: "Loading agent status...",
};

async function fetchAgentStatus(): Promise<AgentStatusInfo> {
  const { data, error } = await supabase
    .from("agent_registrations")
    .select("id, agent_name, agent_type, last_heartbeat, metadata");

  if (error || !data) {
    return {
      ...DEFAULT_STATUS,
      scanBlockedReason: "Failed to load agent status",
    };
  }

  const agents: AgentRecord[] = data.map((a) => {
    const meta = (a.metadata ?? {}) as Record<string, unknown>;
    const counterHistory = Array.isArray(meta.counter_history) ? meta.counter_history : [];
    const lastEntry = counterHistory.length > 0 ? counterHistory[counterHistory.length - 1] : null;

    return {
      id: a.id,
      agent_name: a.agent_name,
      agent_type: a.agent_type,
      last_heartbeat: a.last_heartbeat,
      isOnline: isOnline(a.last_heartbeat),
      lastError: (meta.last_error as string) || null,
      lastCounters: parseCounters(meta.last_counters) ?? parseCounters(lastEntry),
      lastActivityAt: lastEntry && typeof (lastEntry as Record<string, unknown>).ts === "string"
        ? (lastEntry as Record<string, unknown>).ts as string
        : null,
      forceStop: meta.force_stop === true || meta.scan_abort === true,
    };
  });

  const bridgeAgents = agents.filter((a) => a.agent_type === "bridge");
  const bridgeStatus: AgentOnlineStatus | "none" =
    bridgeAgents.length === 0 ? "none" : bridgeAgents.some((a) => a.isOnline) ? "online" : "offline";

  const online = agents.filter((a) => a.isOnline).length;

  const blockedBridge = bridgeAgents.find((a) => a.forceStop);
  const scanBlocked = bridgeStatus === "none" || (bridgeStatus === "offline" && bridgeAgents.length > 0) || !!blockedBridge;
  let scanBlockedReason: string | null = null;
  if (bridgeStatus === "none") {
    scanBlockedReason = "No Bridge Agent registered. Go to Settings → Setup to connect one.";
  } else if (bridgeStatus === "offline") {
    scanBlockedReason = "Bridge Agent is offline. Check that the Docker container is running on your NAS.";
  } else if (blockedBridge) {
    scanBlockedReason = "Scanning was force-stopped. Clicking Sync will auto-clear this and start a new scan.";
  }

  return {
    bridgeStatus,
    agents,
    agentCount: data.length,
    onlineCount: online,
    status: data.length === 0 ? "none" : online === data.length ? "online" : online > 0 ? "degraded" : "offline",
    scanBlocked,
    scanBlockedReason,
  };
}

export function useAgentStatus(): AgentStatusInfo {
  const { data } = useQuery({
    queryKey: ["agent-status"],
    queryFn: fetchAgentStatus,
    refetchInterval: 15_000,
    initialData: DEFAULT_STATUS,
  });
  return data;
}
