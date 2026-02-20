import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type AgentStatus = "online" | "degraded" | "offline" | "none";

interface AgentInfo {
  status: AgentStatus;
  agentCount: number;
  onlineCount: number;
}

export function useAgentStatus(): AgentInfo {
  const [info, setInfo] = useState<AgentInfo>({ status: "none", agentCount: 0, onlineCount: 0 });

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const { data, error } = await supabase
        .from("agent_registrations")
        .select("last_heartbeat");

      if (error || !data) {
        if (mounted) setInfo({ status: "none", agentCount: 0, onlineCount: 0 });
        return;
      }

      const now = Date.now();
      const twoMin = 2 * 60 * 1000;
      const online = data.filter(
        (a) => a.last_heartbeat && now - new Date(a.last_heartbeat).getTime() < twoMin
      ).length;

      if (mounted) {
        setInfo({
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
