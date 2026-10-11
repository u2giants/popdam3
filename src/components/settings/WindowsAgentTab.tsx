import { useState } from "react";
import { WindowsAgentDownload, WindowsAgentSetup } from "./windows-agent/AgentSetup";
import { WindowsAgentStatus } from "./windows-agent/AgentStatus";
import { AgentLogTail, AgentRemoteControls } from "./windows-agent/RemoteControls";
import { RenderJobsTable } from "./windows-agent/RenderJobsTable";
import { RenderPolicyEditor } from "./windows-agent/RenderPolicyEditor";
export { WindowsAgentStatus } from "./windows-agent/AgentStatus";
export { AgentRemoteControls, AgentLogTail } from "./windows-agent/RemoteControls";

export default function WindowsAgentTab() {
  const [pollFast, setPollFast] = useState(false);

  return (
    <div className="space-y-4">
      <WindowsAgentStatus pollFast={pollFast} />
      <AgentRemoteControls />
      <AgentLogTail />
      <RenderPolicyEditor />
      <WindowsAgentDownload />
      <WindowsAgentSetup onTokenGenerated={() => setPollFast(true)} />
      <RenderJobsTable />
    </div>
  );
}
