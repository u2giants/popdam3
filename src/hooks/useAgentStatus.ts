import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AgentOnlineStatus = "online" | "offline";

export interface AgentRecord {
  id: string;
  agent_name: string;
  agent_type: string;
  last_heartbeat: string | null;
  isOnline: boolean;
}

export interface AgentStatusInfo {
  /** Primary bridge agent status (green/red at a glance) */
  bridgeStatus: AgentOnlineStatus | "none";
  /** All registered agents with online state */
  agents: AgentRecord[];
  /** Legacy compat */
  status: "online" | "degraded" | "offline" | "none";
  agentCount: number;
  onlineCount: number;
}

const TWO_MIN = 2 * 60 * 1000;

function isOnline(hb: string | null): boolean {
  return !!hb && Date.now() - new Date(hb).getTime() < TWO_MIN;
}

export function useAgentStatus(): AgentStatusInfo {
  const [info, setInfo] = useState<AgentStatusInfo>({
    bridgeStatus: "none",
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
        .select("id, agent_name, agent_type, last_heartbeat");

      if (error || !data) {
        if (mounted) setInfo({ bridgeStatus: "none", agents: [], status: "none", agentCount: 0, onlineCount: 0 });
        return;
      }

      const agents: AgentRecord[] = data.map((a) => ({
        id: a.id,
        agent_name: a.agent_name,
        agent_type: a.agent_type,
        last_heartbeat: a.last_heartbeat,
        isOnline: isOnline(a.last_heartbeat),
      }));

      const bridgeAgents = agents.filter((a) => a.agent_type === "bridge");
      const bridgeStatus: AgentOnlineStatus | "none" =
        bridgeAgents.length === 0 ? "none" : bridgeAgents.some((a) => a.isOnline) ? "online" : "offline";

      const online = agents.filter((a) => a.isOnline).length;

      if (mounted) {
        setInfo({
          bridgeStatus,
          agents,
          agentCount: data.length,
          onlineCount: online,
          status: data.length === 0 ? "none" : online === data.length ? "online" : online > 0 ? "degraded" : "offline",
        });
      }
    };

    check();
    const interval = setInterval(check, 30_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return info;
}
