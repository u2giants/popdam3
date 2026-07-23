import { useState, useMemo } from "react";
import { formatDate } from "@/lib/format-date";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { expandFallbackTerms } from "@/lib/dam-search";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  RotateCw,
  ImageOff,
  FolderOpen,
  Folder,
  FileText,
  CalendarDays,
  HardDrive,
  Layers,
  LayoutList,
  ArrowRight,
  AlertCircle,
  Files,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCrawlProgress } from "@/hooks/useCrawlProgress";
import { useCrawlLifecycle } from "@/hooks/useCrawlLifecycle";

// Columns available in PopDAM's style_guide_files table.
// licensor_name is a generated column: split_part(relative_path, '/', 1)
// property_folder is segments[1] from the root (licensor's property name)
interface StyleGuideFile {
  id: string;
  filename: string;
  relative_path: string;
  directory_path: string;
  file_extension: string | null;
  licensor_name: string | null;
  property_folder: string | null;
  size_bytes: number | null;
  modified_at: string | null;
  thumbnail_url: string | null;
  thumbnail_error: string | null;
}

interface StyleGuideGroup {
  group_key: string;
  root_label: string | null;
  directory_path: string;
  licensor_name: string | null;
  property_folder: string | null;
  style_guide_folder: string | null;
  style_guide_name: string;
  file_count: number;
  latest_modified_at: string | null;
  total_size_bytes: number | null;
  sample_thumbnail_url: string | null;
}

interface TreeNode {
  licensor: string;
  properties: string[];
}

const PAGE_SIZE_OPTIONS = [60, 100, 200, 500, 1000] as const;
type PageSize = typeof PAGE_SIZE_OPTIONS[number];

const FILE_TYPE_OPTIONS = ["pdf", "ai", "psd", "jpg", "jpeg", "png", "tif", "tiff", "indd", "eps"] as const;
type ThumbStatus = "any" | "has" | "missing";
type PopSGDisplayMode = "guides" | "files";
type PopSGSortField = "modified_at" | "name" | "size";
type SortDirection = "asc" | "desc";

const SORT_OPTIONS: { value: PopSGSortField; label: string }[] = [
  { value: "modified_at", label: "Date" },
  { value: "name", label: "Name" },
  { value: "size", label: "Size" },
];

function formatBytes(n: number | null): string {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[u]}`;
}


// ── Folder tree sidebar ──────────────────────────────────────────────

function FolderTree({
  tree,
  licensor,
  property,
  onSelect,
}: {
  tree: TreeNode[];
  licensor: string;
  property: string;
  onSelect: (l: string, p: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (licensor !== "all") s.add(licensor);
    return s;
  });

  const toggle = (l: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l); else next.add(l);
      return next;
    });

  return (
    <nav className="space-y-0.5">
      <button
        onClick={() => onSelect("all", "all")}
        className={cn(
          "w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
          licensor === "all"
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <LayoutList className="h-3.5 w-3.5 shrink-0" />
        All files
      </button>

      {tree.map((node) => {
        const isOpen = open.has(node.licensor);
        const isActive = licensor === node.licensor;

        return (
          <Collapsible key={node.licensor} open={isOpen} onOpenChange={() => toggle(node.licensor)}>
            <div className="flex items-center">
              <CollapsibleTrigger asChild>
                <button className="p-0.5 text-muted-foreground hover:text-foreground">
                  {isOpen
                    ? <ChevronDown className="h-3.5 w-3.5" />
                    : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              </CollapsibleTrigger>
              <button
                onClick={() => onSelect(node.licensor, "all")}
                className={cn(
                  "flex-1 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium transition-colors",
                  isActive && property === "all"
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted",
                )}
              >
                {isOpen
                  ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  : <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                <span className="truncate">{node.licensor}</span>
              </button>
            </div>

            <CollapsibleContent>
              <div className="ml-7 mt-0.5 space-y-0.5">
                {node.properties.map((prop) => (
                  <button
                    key={prop}
                    onClick={() => onSelect(node.licensor, prop)}
                    className={cn(
                      "w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                      isActive && property === prop
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Folder className="h-3 w-3 shrink-0" />
                    <span className="truncate">{prop}</span>
                  </button>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </nav>
  );
}

// ── File detail sheet ────────────────────────────────────────────────

function FileDetailSheet({
  file,
  onClose,
}: {
  file: StyleGuideFile | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!file} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full max-w-md overflow-y-auto">
        {file && (() => {
          const pathSegments = file.relative_path.split("/").filter(Boolean);
          return (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="truncate text-sm font-semibold">{file.filename}</SheetTitle>
              </SheetHeader>

              {/* Thumbnail */}
              <div className="mb-4 overflow-hidden rounded-lg border border-border bg-muted/30 aspect-square flex items-center justify-center">
                {file.thumbnail_url ? (
                  <img src={file.thumbnail_url} alt={file.filename} className="h-full w-full object-contain" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <ImageOff className="h-10 w-10" />
                    <span className="text-xs">
                      {file.thumbnail_error && file.thumbnail_error !== "unsupported type"
                        ? "Preview failed"
                        : "No preview"}
                    </span>
                  </div>
                )}
              </div>

              {/* Path breadcrumbs */}
              <div className="mb-4">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Location
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  {pathSegments.map((seg, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[11px]",
                          i === pathSegments.length - 1
                            ? "bg-primary/10 text-primary font-medium"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {seg}
                      </span>
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/70 break-all">
                  {file.relative_path}
                </p>
              </div>

              {/* Metadata rows */}
              <dl className="divide-y divide-border rounded-lg border border-border overflow-hidden text-xs">
                {[
                  {
                    icon: <FileText className="h-3.5 w-3.5" />,
                    label: "Type",
                    value: file.file_extension
                      ? file.file_extension.replace(/^\./, "").toUpperCase()
                      : "—",
                  },
                  {
                    icon: <HardDrive className="h-3.5 w-3.5" />,
                    label: "Size",
                    value: formatBytes(file.size_bytes),
                  },
                  {
                    icon: <CalendarDays className="h-3.5 w-3.5" />,
                    label: "Modified",
                    value: formatDate(file.modified_at),
                  },
                  {
                    icon: <Folder className="h-3.5 w-3.5" />,
                    label: "Licensor",
                    value: file.licensor_name ?? "—",
                  },
                  {
                    icon: <Folder className="h-3.5 w-3.5" />,
                    label: "Property",
                    value: file.property_folder ?? "—",
                  },
                ].map(({ icon, label, value }) => (
                  <div key={label} className="flex items-center gap-3 bg-card px-3 py-2">
                    <span className="text-muted-foreground">{icon}</span>
                    <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          );
        })()}
      </SheetContent>
    </Sheet>
  );
}

function GuideDetailSheet({
  group,
  onClose,
  onOpenFile,
}: {
  group: StyleGuideGroup | null;
  onClose: () => void;
  onOpenFile: (file: StyleGuideFile) => void;
}) {
  const { data: files = [], isLoading } = useQuery({
    queryKey: ["popsg", "guide-files", group?.group_key],
    enabled: !!group,
    queryFn: async () => {
      if (!group) return [];
      const { data, error } = await supabase
        .from("style_guide_files")
        .select(
          "id,filename,relative_path,directory_path,file_extension,licensor_name,property_folder,thumbnail_url,thumbnail_error,size_bytes,modified_at",
        )
        .eq("is_active", true)
        .eq("root_label", group.root_label)
        .eq("directory_path", group.directory_path)
        .order("modified_at", { ascending: false, nullsFirst: false })
        .order("filename", { ascending: true });
      if (error) throw error;
      return (data ?? []) as StyleGuideFile[];
    },
  });

  return (
    <Sheet open={!!group} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full max-w-xl overflow-y-auto">
        {group && (
          <>
            <SheetHeader className="mb-4">
              <SheetTitle className="truncate text-sm font-semibold">{group.style_guide_name}</SheetTitle>
            </SheetHeader>

            <div className="mb-4 space-y-2 rounded-md border border-border bg-muted/20 p-3 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Folder className="h-3.5 w-3.5" />
                <span className="break-all">{group.directory_path}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                <span>{group.file_count.toLocaleString()} file{group.file_count === 1 ? "" : "s"}</span>
                <span>{formatBytes(group.total_size_bytes)}</span>
                <span>{formatDate(group.latest_modified_at)}</span>
              </div>
            </div>

            {isLoading ? (
              <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                Loading files…
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {files.map((file) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    onClick={() => {
                      onClose();
                      onOpenFile(file);
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Empty state ──────────────────────────────────────────────────────

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  if (hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Search className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm font-medium text-foreground">No files match these filters</p>
        <p className="mt-1 text-xs text-muted-foreground">Try widening your search or selecting a different folder.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mb-6 flex justify-center">
        <div className="rounded-full bg-muted p-4">
          <FolderOpen className="h-8 w-8 text-muted-foreground" />
        </div>
      </div>
      <h2 className="mb-2 text-base font-semibold text-foreground">No style guides yet</h2>
      <p className="mb-8 text-sm text-muted-foreground">
        The Bridge Agent needs to crawl the NAS and push file metadata here.
      </p>

      <ol className="space-y-4 text-left">
        {[
          {
            n: 1,
            title: "Ensure a bridge agent is paired in PopDAM",
            body: "The same bridge agent handles both PopDAM and PopSG. Pair it in PopDAM Settings.",
          },
          {
            n: 2,
            title: "Set PopSG scan roots",
            body: "In PopDAM Settings → Style Guide, configure STYLE_GUIDE_SCAN_ROOTS (e.g. /nas/styleguides).",
          },
          {
            n: 3,
            title: "Trigger the first crawl",
            body: "Click the Sync button above. The agent picks it up on its next heartbeat and files appear here.",
          },
        ].map(({ n, title, body }) => (
          <li key={n} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {n}
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8">
        <Button variant="outline" size="sm" asChild>
          <a href="/settings" className="gap-1.5 inline-flex items-center">
            Go to Settings <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </Button>
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : "Unable to load style guides.";

  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 rounded-full bg-destructive/10 p-4 text-destructive">
        <AlertCircle className="h-8 w-8" />
      </div>
      <h2 className="mb-2 text-base font-semibold text-foreground">Style guides could not load</h2>
      <p className="mb-6 text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </Button>
    </div>
  );
}

// ── File card ─────────────────────────────────────────────────────────

function FileCard({ file, onClick }: { file: StyleGuideFile; onClick: () => void }) {
  const segments = file.relative_path.split("/").filter(Boolean);
  const propertyLabel = file.property_folder ?? segments[1] ?? "";
  const subfolders = segments.slice(2, -1);

  return (
    <button
      onClick={onClick}
      className="group w-full text-left overflow-hidden rounded-lg border border-border bg-card transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-square bg-muted/30">
        {file.thumbnail_url ? (
          <img
            src={file.thumbnail_url}
            alt={file.filename}
            loading="lazy"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageOff className="h-6 w-6" />
            <span className="text-[10px]">no preview</span>
          </div>
        )}
        {file.file_extension && (
          <Badge
            variant="secondary"
            className="absolute right-1.5 top-1.5 px-1.5 py-0 text-[10px] uppercase"
          >
            {file.file_extension.replace(/^\./, "")}
          </Badge>
        )}
      </div>
      <div className="space-y-0.5 p-2">
        <div className="truncate text-xs font-medium text-foreground" title={file.filename}>
          {file.filename}
        </div>
        <div className="truncate text-[10px] text-muted-foreground" title={file.relative_path}>
          {file.licensor_name ?? "?"}
          {propertyLabel ? ` / ${propertyLabel}` : ""}
          {subfolders.length > 0 ? ` / …` : ""}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{formatBytes(file.size_bytes)}</span>
          <span>{formatDate(file.modified_at)}</span>
        </div>
      </div>
    </button>
  );
}

function GuideCard({ group, onClick }: { group: StyleGuideGroup; onClick: () => void }) {
  const location = [group.licensor_name, group.property_folder].filter(Boolean).join(" / ");

  return (
    <button
      onClick={onClick}
      className="group w-full text-left overflow-hidden rounded-lg border border-border bg-card transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-square bg-muted/30">
        {group.sample_thumbnail_url ? (
          <img
            src={group.sample_thumbnail_url}
            alt={group.style_guide_name}
            loading="lazy"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <FolderOpen className="h-7 w-7" />
            <span className="text-[10px]">style guide</span>
          </div>
        )}
        <Badge
          variant="secondary"
          className="absolute right-1.5 top-1.5 px-1.5 py-0 text-[10px]"
        >
          {group.file_count} file{group.file_count === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="space-y-0.5 p-2">
        <div className="truncate text-xs font-medium text-foreground" title={group.style_guide_name}>
          {group.style_guide_name}
        </div>
        <div className="truncate text-[10px] text-muted-foreground" title={group.directory_path}>
          {location || group.directory_path}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{formatBytes(group.total_size_bytes)}</span>
          <span>{formatDate(group.latest_modified_at)}</span>
        </div>
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────

export default function PopSGLibraryPage() {
  const [licensor, setLicensor] = useState<string>("all");
  const [property, setProperty] = useState<string>("all");
  const [nameSearch, setNameSearch] = useState<string>("");
  const [fileTypes, setFileTypes] = useState<string[]>([]);
  const [thumbStatus, setThumbStatus] = useState<ThumbStatus>("any");
  const [displayMode, setDisplayMode] = useState<PopSGDisplayMode>("guides");
  const [sortField, setSortField] = useState<PopSGSortField>("modified_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(60);
  const [selectedFile, setSelectedFile] = useState<StyleGuideFile | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<StyleGuideGroup | null>(null);

  const crawlProgress = useCrawlProgress();
  const { crawlTriggered, handleTriggerCrawl } = useCrawlLifecycle(crawlProgress, "trigger-style-guide-crawl");

  const crawlActive = crawlProgress.status === "queued" || crawlProgress.status === "running" || crawlTriggered;

  // Build folder tree using the style_guide_folders view (distinct licensor/property pairs)
  const { data: tree = [], error: treeError, refetch: refetchTree } = useQuery<TreeNode[]>({
    queryKey: ["popsg", "tree"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("style_guide_folders")
        .select("licensor_name,property_folder")
        .order("licensor_name")
        .order("property_folder")
        .limit(5000);
      if (error) throw error;

      const map = new Map<string, Set<string>>();
      for (const r of (data ?? []) as { licensor_name: string | null; property_folder: string | null }[]) {
        if (!r.licensor_name) continue;
        if (!map.has(r.licensor_name)) map.set(r.licensor_name, new Set());
        if (r.property_folder) map.get(r.licensor_name)!.add(r.property_folder);
      }
      return Array.from(map.entries())
        .map(([l, props]) => ({ licensor: l, properties: Array.from(props).sort() }))
        .sort((a, b) => a.licensor.localeCompare(b.licensor));
    },
    staleTime: 60_000,
  });

  const filters = useMemo(
    () => ({ licensor, property, nameSearch: nameSearch.trim(), fileTypes, thumbStatus }),
    [licensor, property, nameSearch, fileTypes, thumbStatus],
  );

  const { data: groupResults, isLoading: groupsLoading, refetch: refetchGroups, isFetching: groupsFetching, error: groupsError } = useQuery({
    queryKey: ["popsg", "groups", filters, sortField, sortDirection, page, pageSize],
    enabled: displayMode === "guides",
    queryFn: async () => {
      let q = (supabase as any)
        .from("style_guide_file_groups")
        .select(
          "group_key,root_label,directory_path,licensor_name,property_folder,style_guide_folder,style_guide_name,file_count,latest_modified_at,total_size_bytes,sample_thumbnail_url",
          { count: "exact" },
        );

      if (filters.licensor !== "all") q = q.eq("licensor_name", filters.licensor);
      if (filters.property !== "all") q = q.eq("property_folder", filters.property);
      if (filters.nameSearch) {
        // Expand synonyms + hyphen/space variants so "spiderman" matches the
        // stored "Spider-Man" folder/path (raw ILIKE alone cannot bridge the
        // hyphen). See expandFallbackTerms.
        const terms = await expandFallbackTerms(filters.nameSearch);
        const clauses = terms.flatMap((t) => {
          const escaped = t.replace(/[%_]/g, "\\$&");
          return [`style_guide_name.ilike.%${escaped}%`, `directory_path.ilike.%${escaped}%`];
        });
        if (clauses.length > 0) q = q.or(clauses.join(","));
      }
      if (filters.thumbStatus === "has") q = q.not("sample_thumbnail_url", "is", null);
      if (filters.thumbStatus === "missing") q = q.is("sample_thumbnail_url", null);

      if (sortField === "modified_at") {
        q = q.order("latest_modified_at", { ascending: sortDirection === "asc", nullsFirst: false });
      } else if (sortField === "size") {
        q = q.order("total_size_bytes", { ascending: sortDirection === "asc", nullsFirst: false });
      } else {
        q = q.order("style_guide_name", { ascending: sortDirection === "asc", nullsFirst: false });
      }
      q = q.order("directory_path", { ascending: true });
      q = q.range(page * pageSize, page * pageSize + pageSize - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as StyleGuideGroup[], total: count ?? 0 };
    },
  });

  const { data: fileResults, isLoading: filesLoading, refetch: refetchFiles, isFetching: filesFetching, error: filesError } = useQuery({
    queryKey: ["popsg", "files", filters, sortField, sortDirection, page, pageSize],
    enabled: displayMode === "files",
    queryFn: async () => {
      let q = supabase
        .from("style_guide_files")
        .select(
          "id,filename,relative_path,directory_path,file_extension,licensor_name,property_folder,thumbnail_url,thumbnail_error,size_bytes,modified_at",
          { count: "exact" },
        )
        .eq("is_active", true);

      if (filters.licensor !== "all") q = q.eq("licensor_name", filters.licensor);
      if (filters.property !== "all") q = q.eq("property_folder", filters.property);
      if (filters.nameSearch) {
        // Search the full relative path (which includes the directory path AND
        // the filename), so a franchise query like "spiderman" returns every
        // file living under a "Marvel Style Guide/Spider-Man/…" path — not just
        // files whose SKU-coded name happens to contain it. Synonym/separator-
        // expanded so "spiderman" reaches the stored "Spider-Man".
        // Uses the raw-column trigram GIN index idx_sgf_relative_path_trgm
        // (gin (relative_path gin_trgm_ops)) — a lower()-expression index would
        // NOT serve PostgREST's `ilike`, so ILIKE must hit a raw-column index.
        const terms = await expandFallbackTerms(filters.nameSearch);
        const clauses = terms.map((t) => `relative_path.ilike.%${t.replace(/[%_]/g, "\\$&")}%`);
        if (clauses.length > 0) q = q.or(clauses.join(","));
      }
      if (filters.fileTypes.length > 0) q = q.in("file_extension", filters.fileTypes);
      if (filters.thumbStatus === "has") q = q.not("thumbnail_url", "is", null);
      if (filters.thumbStatus === "missing") q = q.is("thumbnail_url", null);

      if (sortField === "modified_at") {
        q = q.order("modified_at", { ascending: sortDirection === "asc", nullsFirst: false });
      } else if (sortField === "size") {
        q = q.order("size_bytes", { ascending: sortDirection === "asc", nullsFirst: false });
      } else {
        q = q.order("filename", { ascending: sortDirection === "asc" });
      }
      q = q.order("licensor_name", { ascending: true, nullsFirst: false })
        .order("property_folder", { ascending: true, nullsFirst: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as StyleGuideFile[], total: count ?? 0 };
    },
  });

  const groups = groupResults?.rows ?? [];
  const rows = fileResults?.rows ?? [];
  const total = displayMode === "guides" ? groupResults?.total ?? 0 : fileResults?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters =
    licensor !== "all" ||
    property !== "all" ||
    !!nameSearch.trim() ||
    fileTypes.length > 0 ||
    thumbStatus !== "any";
  const hasAnyData = tree.length > 0;
  const queryError = (displayMode === "guides" ? groupsError : filesError) || treeError;
  const isLoading = displayMode === "guides" ? groupsLoading : filesLoading;
  const isFetching = displayMode === "guides" ? groupsFetching : filesFetching;
  const refetch = displayMode === "guides" ? refetchGroups : refetchFiles;

  const toggleFileType = (ext: string) => {
    setFileTypes((prev) => prev.includes(ext) ? prev.filter((t) => t !== ext) : [...prev, ext]);
    setPage(0);
  };

  const clearAllFilters = () => {
    setLicensor("all");
    setProperty("all");
    setNameSearch("");
    setFileTypes([]);
    setThumbStatus("any");
    setPage(0);
  };

  const handleDisplayModeChange = (mode: PopSGDisplayMode) => {
    setDisplayMode(mode);
    if (mode === "guides") setFileTypes([]);
    setPage(0);
  };

  const handleTreeSelect = (l: string, p: string) => {
    setLicensor(l);
    setProperty(p);
    setPage(0);
  };

  const handlePageSizeChange = (val: string) => {
    setPageSize(Number(val) as PageSize);
    setPage(0);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* ── Sidebar ── */}
      {hasAnyData && (
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-background lg:flex">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Filters
            </span>
            {hasFilters && (
              <button
                onClick={clearAllFilters}
                className="text-[10px] text-primary hover:underline"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {displayMode === "files" && (
              <div className="border-b border-border px-3 py-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  File type
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {FILE_TYPE_OPTIONS.map((ext) => (
                    <label
                      key={ext}
                      className="flex items-center gap-1.5 cursor-pointer text-xs hover:text-foreground"
                    >
                      <Checkbox
                        checked={fileTypes.includes(ext)}
                        onCheckedChange={() => toggleFileType(ext)}
                        className="h-3.5 w-3.5"
                      />
                      <span className="uppercase">{ext}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Thumbnail status */}
            <div className="border-b border-border px-3 py-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Preview
              </p>
              <div className="space-y-1">
                {([
                  { value: "any", label: "Any" },
                  { value: "has", label: "Has preview" },
                  { value: "missing", label: "No preview" },
                ] as const).map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-1.5 cursor-pointer text-xs hover:text-foreground"
                  >
                    <input
                      type="radio"
                      name="thumb-status"
                      checked={thumbStatus === opt.value}
                      onChange={() => { setThumbStatus(opt.value); setPage(0); }}
                      className="h-3 w-3"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Folder tree */}
            <div className="px-3 py-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Folders
                </p>
                <span className="text-[10px] text-muted-foreground">
                  {total.toLocaleString()} {displayMode === "guides" ? "guides" : "files"}
                </span>
              </div>
              <FolderTree
                tree={tree}
                licensor={licensor}
                property={property}
                onSelect={handleTreeSelect}
              />
            </div>
          </div>
        </aside>
      )}

      {/* ── Main ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Crawl in-progress banner */}
        {crawlActive && (
          <div className="relative border-b border-border bg-card overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-[2px]">
              <div className="h-full w-[200%] bg-gradient-to-r from-transparent via-primary to-transparent animate-[shimmer_2s_linear_infinite]" />
            </div>
            <div className="flex items-center gap-2 px-4 py-2 text-xs">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse shrink-0" />
              <span className="font-medium">
                {crawlProgress.status === "queued" || crawlTriggered ? "Crawl queued" : "Crawling"}
              </span>
              <span className="text-muted-foreground">
                — Bridge Agent is scanning the NAS. Files will appear when complete.
              </span>
            </div>
          </div>
        )}

        {/* Header bar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <h1 className="text-sm font-semibold text-foreground shrink-0">Style Guide Library</h1>

          {/* Breadcrumb of active filter */}
          {licensor !== "all" && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <ChevronRight className="h-3.5 w-3.5" />
              <button onClick={() => handleTreeSelect(licensor, "all")} className="hover:text-foreground">
                {licensor}
              </button>
              {property !== "all" && (
                <>
                  <ChevronRight className="h-3.5 w-3.5" />
                  <span className="text-foreground font-medium">{property}</span>
                </>
              )}
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-md border border-border">
              <Button
                variant="ghost"
                size="sm"
                className={cn("h-8 rounded-r-none gap-1.5 px-2.5 text-xs", displayMode === "guides" && "bg-accent")}
                onClick={() => handleDisplayModeChange("guides")}
              >
                <Layers className="h-3.5 w-3.5" />
                Style Guides
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn("h-8 rounded-l-none border-l border-border gap-1.5 px-2.5 text-xs", displayMode === "files" && "bg-accent")}
                onClick={() => handleDisplayModeChange("files")}
              >
                <Files className="h-3.5 w-3.5" />
                Files
              </Button>
            </div>

            {/* Filename search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 w-48 pl-8 text-xs"
                placeholder={displayMode === "guides" ? "Search guides…" : "Search filename…"}
                value={nameSearch}
                onChange={(e) => { setNameSearch(e.target.value); setPage(0); }}
              />
            </div>

            <Select value={sortField} onValueChange={(v) => { setSortField(v as PopSGSortField); setPage(0); }}>
              <SelectTrigger className="h-8 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => { setSortDirection((v) => v === "asc" ? "desc" : "asc"); setPage(0); }}
              className="h-8 w-10 px-0 font-mono text-xs"
              title={sortDirection === "asc" ? "Ascending" : "Descending"}
            >
              {sortDirection === "asc" ? "↑" : "↓"}
            </Button>

            {/* Page size */}
            <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
              <SelectTrigger className="h-8 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-8 gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleTriggerCrawl}
              disabled={crawlActive}
              className="h-8 gap-1.5"
              title="Trigger NAS crawl"
            >
              <RotateCw className={cn("h-3.5 w-3.5", crawlActive && "animate-spin")} />
              <span className="hidden sm:inline">Sync</span>
            </Button>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {queryError ? (
            <ErrorState
              error={queryError}
              onRetry={() => {
                refetchTree();
                refetch();
              }}
            />
          ) : isLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : (displayMode === "guides" ? groups.length === 0 : rows.length === 0) ? (
            <EmptyState hasFilters={hasFilters || hasAnyData} />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {displayMode === "guides"
                  ? groups.map((group) => (
                    <GuideCard key={group.group_key} group={group} onClick={() => setSelectedGroup(group)} />
                  ))
                  : rows.map((f) => (
                    <FileCard key={f.id} file={f} onClick={() => setSelectedFile(f)} />
                  ))}
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {(displayMode === "guides" ? groups.length : rows.length)} of {total.toLocaleString()}{" "}
                  {displayMode === "guides" ? `style guide${total === 1 ? "" : "s"}` : `file${total === 1 ? "" : "s"}`}
                </span>
                <div className="flex items-center gap-2">
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => { setPageSize(Number(v)); setPage(0); }}
                  >
                    <SelectTrigger className="h-7 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)} className="text-xs">
                          {n} / page
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <span className="px-1">
                    {page + 1} / {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={page >= pageCount - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Detail panel ── */}
      <GuideDetailSheet
        group={selectedGroup}
        onClose={() => setSelectedGroup(null)}
        onOpenFile={(file) => setSelectedFile(file)}
      />
      <FileDetailSheet file={selectedFile} onClose={() => setSelectedFile(null)} />
    </div>
  );
}
