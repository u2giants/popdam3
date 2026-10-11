import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Settings as SettingsIcon, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { formatDateTime } from "@/lib/format-date";
import { canManagePackagingTypes } from "@/lib/packaging-types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NasStorageTab, ImageOutputTab, ScanningTab, LiveScanMonitor, UpdateAgentButton } from "@/components/settings/WorkerManagementTab";
import ApisTab from "@/components/settings/ApisTab";
import WindowsAgentTab from "@/components/settings/WindowsAgentTab";
import InstallBundleTab from "@/components/settings/InstallBundleTab";
import DiagnosticsTab from "@/components/settings/DiagnosticsTab";
import TiffHygieneTab from "@/components/settings/TiffHygieneTab";
import FileHygieneTab from "@/components/settings/FileHygieneTab";
import ErpEnrichmentTab from "@/components/settings/ErpEnrichmentTab";
import AiTaggingTab from "@/components/settings/AiTaggingTab";
import AiTagBakeoffTab from "@/components/settings/AiTagBakeoffTab";
import OperationsTab from "@/components/settings/OperationsTab";
import StyleGuideCrawlTab from "@/components/settings/StyleGuideCrawlTab";
import PopSGAgentTab from "@/components/settings/PopSGAgentTab";
import PdfTextSamplesTab from "@/components/settings/PdfTextSamplesTab";
import PackagingTypesTab from "@/components/settings/PackagingTypesTab";
import { AgentStatusSection } from "./settings/AgentStatusSection";
import { AgentThroughputChart } from "./settings/AgentThroughputChart";
import { HelperPasswordCard } from "./settings/HelperPasswordCard";
import { PairingCodesSection, PathTesterSection } from "./settings/PairingAndPaths";
import { SettingsSearch, SubTabBar, TipTab } from "./settings/SettingsNav";
import { InvitationSection, UsersSection } from "./settings/UsersAndInvitations";

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const { isRealAdmin, isLoading: isAdminLoading } = useIsAdmin();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "general";
  const canManagePackagingTypeSettings = canManagePackagingTypes(user?.email, isRealAdmin);
  const handleTabChange = useCallback((value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  }, [setSearchParams]);

  const [storageSubTab, setStorageSubTab] = useState("nas");
  const [agentsSubTab, setAgentsSubTab] = useState("bridge");
  const [processingSubTab, setProcessingSubTab] = useState("ai-tagging");
  const [fileHealthSubTab, setFileHealthSubTab] = useState("style-guide");
  const [referenceSubTab, setReferenceSubTab] = useState("packaging-types");

  const navigateTo = useCallback((tab: string, subTab?: string) => {
    handleTabChange(tab);
    if (subTab) {
      if (tab === "storage") setStorageSubTab(subTab);
      else if (tab === "agents") setAgentsSubTab(subTab);
      else if (tab === "processing") setProcessingSubTab(subTab);
      else if (tab === "file-health") setFileHealthSubTab(subTab);
      else if (tab === "reference-data") setReferenceSubTab(subTab);
    }
  }, [handleTabChange]);

  useEffect(() => {
    if (activeTab === "reference-data" && !canManagePackagingTypeSettings && !authLoading && !isAdminLoading) {
      handleTabChange("general");
    }
  }, [activeTab, authLoading, canManagePackagingTypeSettings, handleTabChange, isAdminLoading]);

  const settingsContainerClass = activeTab === "processing" && processingSubTab === "ai-bakeoff"
    ? "w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6"
    : "container max-w-7xl py-8 space-y-6";

  return (
    <div className={settingsContainerClass}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SettingsIcon className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Settings</h1>
        </div>
        <div className="flex items-center gap-4">
          <SettingsSearch onNavigate={navigateTo} canShowPackagingTypes={canManagePackagingTypeSettings} />
          <span className="text-xs text-muted-foreground font-mono select-all" title="Git commit hash and date of this build">
            {__APP_COMMIT__} · {formatDateTime(__APP_DATE__)}
          </span>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          {canManagePackagingTypeSettings && (
            <TipTab value="reference-data" label="Reference Data" tip="Shared lookup tables used by DAM and other apps" />
          )}
          <TipTab value="processing" label="Processing" tip="AI tagging, PDF text extraction, ERP sync, and taxonomy APIs" />
          <TipTab value="file-health" label="File Health" tip="Style guide crawl, TIFF compression, and file quality checks" />
          <TipTab value="maintenance" label="Maintenance" tip="Bulk data operations: rebuild style groups, reprocess metadata" />
          <TipTab value="diagnostics" label="Diagnostics" tip="System health, connected agents, recent errors, and database inspector" />
        </TabsList>

        {/* ── General (Users + App Password) ── */}
        <TabsContent value="general" className="space-y-4">
          <HelperPasswordCard />
          <UsersSection />
          <InvitationSection />
        </TabsContent>

        {/* ── Storage ── */}
        <TabsContent value="storage" className="space-y-4">
          <SubTabBar
            tabs={[
              { id: "nas", label: "NAS & Folders" },
              { id: "scanning", label: "Scanning" },
              { id: "image-output", label: "Image Output" },
              { id: "paths", label: "Path Tester" },
            ]}
            active={storageSubTab}
            onChange={setStorageSubTab}
          />
          {storageSubTab === "nas" && <NasStorageTab />}
          {storageSubTab === "scanning" && <ScanningTab />}
          {storageSubTab === "image-output" && <ImageOutputTab />}
          {storageSubTab === "paths" && <PathTesterSection />}
        </TabsContent>

        {/* ── Agents ── */}
        <TabsContent value="agents" className="space-y-4">
          <SubTabBar
            tabs={[
              { id: "bridge", label: "Bridge Agent (NAS)" },
              { id: "windows", label: "Windows Render Agent" },
              { id: "popsg", label: "PopSG Connection" },
              { id: "install", label: "Install Bundles" },
            ]}
            active={agentsSubTab}
            onChange={setAgentsSubTab}
          />
          {agentsSubTab === "bridge" && (
            <div className="space-y-4">
              <PairingCodesSection defaultAgentType="bridge" />
              <AgentStatusSection />
              <AgentThroughputChart />
              <LiveScanMonitor />
              <UpdateAgentButton />
            </div>
          )}
          {agentsSubTab === "windows" && <WindowsAgentTab />}
          {agentsSubTab === "popsg" && <PopSGAgentTab />}
          {agentsSubTab === "install" && <InstallBundleTab />}
        </TabsContent>

        {/* ── Reference Data ── */}
        {canManagePackagingTypeSettings && (
          <TabsContent value="reference-data" className="space-y-4">
            <SubTabBar
              tabs={[
                { id: "packaging-types", label: "Packaging Types" },
              ]}
              active={referenceSubTab}
              onChange={setReferenceSubTab}
            />
            {referenceSubTab === "packaging-types" && <PackagingTypesTab />}
          </TabsContent>
        )}

        {/* ── Processing (AI Tagging + PDF Text + ERP + Taxonomy) ── */}
        <TabsContent value="processing" className="space-y-4">
          <SubTabBar
            tabs={[
              { id: "ai-tagging", label: "AI Tagging" },
              { id: "ai-bakeoff", label: "Vision Bake-Off" },
              { id: "pdf-text", label: "PDF Text" },
              { id: "erp", label: "ERP Sync" },
              { id: "taxonomy", label: "Taxonomy" },
            ]}
            active={processingSubTab}
            onChange={setProcessingSubTab}
          />
          {processingSubTab === "ai-tagging" && <AiTaggingTab />}
          {processingSubTab === "ai-bakeoff" && <AiTagBakeoffTab />}
          {processingSubTab === "pdf-text" && <PdfTextSamplesTab />}
          {processingSubTab === "erp" && <ErpEnrichmentTab />}
          {processingSubTab === "taxonomy" && <ApisTab />}
        </TabsContent>

        {/* ── File Health (Style Guide + TIFF + File Quality) ── */}
        <TabsContent value="file-health" className="space-y-4">
          <SubTabBar
            tabs={[
              { id: "style-guide", label: "Style Guide Crawl" },
              { id: "tiff", label: "TIFF Compression" },
              { id: "files", label: "File Quality" },
            ]}
            active={fileHealthSubTab}
            onChange={setFileHealthSubTab}
          />
          {fileHealthSubTab === "style-guide" && <StyleGuideCrawlTab />}
          {fileHealthSubTab === "tiff" && <TiffHygieneTab />}
          {fileHealthSubTab === "files" && <FileHygieneTab />}
        </TabsContent>

        {/* ── Maintenance ── */}
        <TabsContent value="maintenance" className="space-y-4">
          <OperationsTab />
        </TabsContent>

        {/* ── Diagnostics ── */}
        <TabsContent value="diagnostics" className="space-y-4">
          <DiagnosticsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
