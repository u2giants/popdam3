import { SpacesConfigSettings, FolderManager } from "./worker-management/SpacesAndFolders";
import { ResourceGuardSettings, PollingConfig } from "./worker-management/ResourceAndPolling";
import { DateCutoffSettings, ImageOutputSettings } from "./worker-management/ScanAndOutputSettings";
import { UpdateAgentButton } from "./worker-management/UpdateAgentButton";
import { LiveScanMonitor } from "./worker-management/LiveScanMonitor";
export { NasStorageTab, ImageOutputTab, ScanningTab } from "./worker-management/ScanAndOutputSettings";
export { UpdateAgentButton } from "./worker-management/UpdateAgentButton";
export { LiveScanMonitor } from "./worker-management/LiveScanMonitor";
export default function WorkerManagementTab() {
  return (
    <div className="space-y-4">
      <LiveScanMonitor />
      <UpdateAgentButton />
      <DateCutoffSettings />
      <SpacesConfigSettings />
      <FolderManager />
      <ImageOutputSettings />
      <ResourceGuardSettings />
      <PollingConfig />
    </div>
  );
}
