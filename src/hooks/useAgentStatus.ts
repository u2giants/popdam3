import { useEffect, useState } from "react";
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
  files_stat_failed: number;
}

export interface AgentRecord {
  id: string;
  agent_name: string;
  agent_type: string;
  last_heartbeat: string | null;
  isOnline: boolean;
  scanRequested: boolean;
  scanAbort: boolean;
  lastError: string | null;
  lastCounters: ScanCounters | null;
  /** Most recent counter_history entry timestamp */
  lastActivityAt: string | null;
}

export interface AgentStatusInfo {
  bridgeStatus: AgentOnlineStatus | "none";
  /** True if any bridge agent has scan_requested=true and scan_abort=false */
  scanRunning: boolean;
  agents: AgentRecord[];
  status: "online" | "degraded" | "offline" | "none";
  agentCount: number;
  onlineCount: number;
}

const TWO_MIN = 2 * 60 * 1000;

function isOnline(hb: string | null): boolean {
  return !!hb && Date.now() - new Date(hb).getTime() < TWO_MIN;
}

const emptyCounters: ScanCounters = {
  files_checked: 0, candidates_found: 0, ingested_new: 0,
  moved_detected: 0, updated_existing: 0, errors: 0,
  roots_invalid: 0, roots_unreadable: 0, dirs_skipped_permission: 0,
  files_stat_failed: 0,
};

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
    files_stat_failed: Number(r.files_stat_failed ?? 0),
  };
}

export function useAgentStatus(): AgentStatusInfo {
  const [info, setInfo] = useState<AgentStatusInfo>({
    bridgeStatus: "none",
    scanRunning: false,
    agents: [],
    status: "none",
    agentCount: 0,
    onlineCount: 0,
  });

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const { data, error } = await supabase
        .from("agent_registrations")
        .select("id, agent_name, agent_type, last_heartbeat, metadata");

      if (error || !data) {
        if (mounted) setInfo({ bridgeStatus: "none", scanRunning: false, agents: [], status: "none", agentCount: 0, onlineCount: 0 });
        return;
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
          scanRequested: Boolean(meta.scan_requested),
          scanAbort: Boolean(meta.scan_abort),
          lastError: (meta.last_error as string) || null,
          lastCounters: parseCounters(meta.last_counters) ?? parseCounters(lastEntry),
          lastActivityAt: lastEntry && typeof (lastEntry as Record<string, unknown>).ts === "string"
            ? (lastEntry as Record<string, unknown>).ts as string
            : null,
        };
      });

      const bridgeAgents = agents.filter((a) => a.agent_type === "bridge");
      const bridgeStatus: AgentOnlineStatus | "none" =
        bridgeAgents.length === 0 ? "none" : bridgeAgents.some((a) => a.isOnline) ? "online" : "offline";

      // Scan is running if any online bridge agent has scan_requested and not scan_abort,
      // AND its counters show activity (files_checked > 0 or candidates_found > 0)
      const scanRunning = bridgeAgents.some((a) =>
        a.isOnline && a.scanRequested && !a.scanAbort &&
        a.lastCounters && (a.lastCounters.files_checked > 0 || a.lastCounters.candidates_found > 0)
      );

      const online = agents.filter((a) => a.isOnline).length;

      if (mounted) {
        setInfo({
          bridgeStatus,
          scanRunning,
          agents,
          agentCount: data.length,
          onlineCount: online,
          status: data.length === 0 ? "none" : online === data.length ? "online" : online > 0 ? "degraded" : "offline",
        });
      }
    };

    check();
    const interval = setInterval(check, 15_000); // poll faster for scan status
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return info;
}
