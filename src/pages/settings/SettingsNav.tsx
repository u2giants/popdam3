import { useState, useMemo, useRef } from "react";
import { Download, Users, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function TipTab({ value, label, tip }: { value: string; label: string; tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TabsTrigger value={value}>{label}</TabsTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  );
}

// ── Sub-tab bar ─────────────────────────────────────────────────────

export function SubTabBar({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-1 border-b border-border pb-2">
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${active === id ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Settings search ─────────────────────────────────────────────────

export const SETTINGS_SEARCH_ITEMS: { label: string; desc: string; tab: string; subTab?: string; requiresPackagingTypesAccess?: boolean }[] = [
  { label: "Users & Access", desc: "Manage users, roles, and invitations", tab: "general" },
  { label: "App Password", desc: "Helper app password for Synology integration", tab: "general" },
  { label: "Packaging Types", desc: "Shared packaging lookup values", tab: "reference-data", subTab: "packaging-types", requiresPackagingTypesAccess: true },
  { label: "NAS & Folders", desc: "Volume mapping, scan folders, subfolder filters", tab: "storage", subTab: "nas" },
  { label: "Scanning", desc: "Auto-scan intervals, batch size, date cutoffs, resource guard", tab: "storage", subTab: "scanning" },
  { label: "Image Output", desc: "Thumbnail and preview output settings", tab: "storage", subTab: "image-output" },
  { label: "Path Tester", desc: "Test and validate NAS paths", tab: "storage", subTab: "paths" },
  { label: "Bridge Agent (NAS)", desc: "Status, pairing codes, throughput, live scan monitor", tab: "agents", subTab: "bridge" },
  { label: "Windows Render Agent", desc: "Status, remote controls, agent logs", tab: "agents", subTab: "windows" },
  { label: "PopSG Connection", desc: "Connect PopSG style guide agent", tab: "agents", subTab: "popsg" },
  { label: "Install Bundles", desc: "Download Bridge and Windows agent installers", tab: "agents", subTab: "install" },
  { label: "AI Tagging", desc: "Run AI tagging jobs, configure models and instructions", tab: "processing", subTab: "ai-tagging" },
  { label: "Vision Bake-Off", desc: "Compare five AI vision tagging models side by side", tab: "processing", subTab: "ai-bakeoff" },
  { label: "PDF Text Extraction", desc: "Test and review PDF text and OCR extraction", tab: "processing", subTab: "pdf-text" },
  { label: "ERP Enrichment", desc: "Enrich assets with ColdLion product data", tab: "processing", subTab: "erp" },
  { label: "Taxonomy", desc: "View canonical licensors and properties from shared master data", tab: "processing", subTab: "taxonomy" },
  { label: "Style Guide Crawl", desc: "Crawl and index style guide files", tab: "file-health", subTab: "style-guide" },
  { label: "TIFF Compression", desc: "Scan and compress uncompressed TIFF files", tab: "file-health", subTab: "tiff" },
  { label: "File Quality Checks", desc: "Scan for and review embedded-file quality issues", tab: "file-health", subTab: "files" },
  { label: "Maintenance & Bulk Jobs", desc: "Rebuild style groups, reprocess metadata, rebuild indexes", tab: "maintenance" },
  { label: "Diagnostics", desc: "System health, connected agents, error history, database inspector", tab: "diagnostics" },
];

export function SettingsSearch({
  onNavigate,
  canShowPackagingTypes,
}: {
  onNavigate: (tab: string, subTab?: string) => void;
  canShowPackagingTypes: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return SETTINGS_SEARCH_ITEMS.filter((item) => {
      if (item.requiresPackagingTypesAccess && !canShowPackagingTypes) return false;
      return item.label.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q);
    });
  }, [canShowPackagingTypes, query]);

  return (
    <div className="relative w-72">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        placeholder="Search settings…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="pl-8 pr-8"
      />
      {query && (
        <button
          className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
          onMouseDown={(e) => { e.preventDefault(); setQuery(""); inputRef.current?.focus(); }}
        >
          <X className="h-4 w-4" />
        </button>
      )}
      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 w-full min-w-[280px] bg-popover border border-border rounded-md shadow-md z-50 overflow-hidden">
          {results.map((item, i) => (
            <button
              key={i}
              className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex flex-col gap-0.5"
              onMouseDown={(e) => {
                e.preventDefault();
                onNavigate(item.tab, item.subTab);
                setQuery("");
                setOpen(false);
                inputRef.current?.blur();
              }}
            >
              <span className="font-medium">{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.desc}</span>
            </button>
          ))}
        </div>
      )}
      {open && query && results.length === 0 && (
        <div className="absolute top-full mt-1 left-0 w-full bg-popover border border-border rounded-md shadow-md z-50 px-3 py-2 text-sm text-muted-foreground">
          No settings found
        </div>
      )}
    </div>
  );
}

// ── Helper App Password ─────────────────────────────────────────────
