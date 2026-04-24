import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  ImageOff,
  FolderOpen,
  Folder,
  FileText,
  CalendarDays,
  HardDrive,
  LayoutList,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface StyleGuideFile {
  id: string;
  filename: string;
  relative_path: string;
  directory_path: string;
  file_extension: string | null;
  path_segments: string[];
  licensor_name: string | null;
  property_name: string | null;
  depth: number;
  thumbnail_url: string | null;
  thumbnail_error: string | null;
  size_bytes: number | null;
  modified_at: string | null;
}

interface TreeNode {
  licensor: string;
  properties: string[];
}

const PAGE_SIZE = 60;

function formatBytes(n: number | null): string {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[u]}`;
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
      next.has(l) ? next.delete(l) : next.add(l);
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
        {file && (
          <>
            <SheetHeader className="mb-4">
              <SheetTitle className="truncate text-sm font-semibold">{file.filename}</SheetTitle>
            </SheetHeader>

            {/* Thumbnail */}
            <div className="mb-4 overflow-hidden rounded-lg border border-border bg-muted/30 aspect-square flex items-center justify-center">
              {file.thumbnail_url ? (
                <img
                  src={file.thumbnail_url}
                  alt={file.filename}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <ImageOff className="h-10 w-10" />
                  <span className="text-xs">No preview available</span>
                </div>
              )}
            </div>

            {/* Path breadcrumbs */}
            <div className="mb-4">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Location
              </p>
              <div className="flex flex-wrap items-center gap-1">
                {file.path_segments.map((seg, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px]",
                        i === file.path_segments.length - 1
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
                  value: file.property_name ?? "—",
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
        A bridge agent needs to scan your NAS and push file metadata here. Three steps:
      </p>

      <ol className="space-y-4 text-left">
        {[
          {
            n: 1,
            title: "Pair a bridge agent",
            body: "Go to Settings → Generate a pairing code → give it to the bridge agent container.",
          },
          {
            n: 2,
            title: "Set scan roots",
            body: "In Settings, the agent reads scan_roots from admin_config. Default: /nas/styleguides.",
          },
          {
            n: 3,
            title: "Wait for the first crawl",
            body: "Once paired, the agent heartbeats and will pick up a STYLE_GUIDE_CRAWL_REQUEST. Files appear here when the crawl completes.",
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

// ── File card ─────────────────────────────────────────────────────────

function FileCard({ file, onClick }: { file: StyleGuideFile; onClick: () => void }) {
  const propertyLabel = file.property_name ?? file.path_segments[1] ?? "";
  const subfolders = file.path_segments.slice(2, -1);

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

// ── Main page ─────────────────────────────────────────────────────────

export default function PopSGLibraryPage() {
  const [licensor, setLicensor] = useState<string>("all");
  const [property, setProperty] = useState<string>("all");
  const [nameSearch, setNameSearch] = useState<string>("");
  const [page, setPage] = useState(0);
  const [selectedFile, setSelectedFile] = useState<StyleGuideFile | null>(null);

  // Build folder tree for sidebar
  const { data: tree = [] } = useQuery<TreeNode[]>({
    queryKey: ["popsg", "tree"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("style_guide_files")
        .select("licensor_name,property_name")
        .eq("is_active", true)
        .not("licensor_name", "is", null)
        .order("licensor_name")
        .order("property_name");
      if (error) throw error;

      const map = new Map<string, Set<string>>();
      for (const r of (data ?? []) as { licensor_name: string | null; property_name: string | null }[]) {
        if (!r.licensor_name) continue;
        if (!map.has(r.licensor_name)) map.set(r.licensor_name, new Set());
        if (r.property_name) map.get(r.licensor_name)!.add(r.property_name);
      }
      return Array.from(map.entries())
        .map(([l, props]) => ({ licensor: l, properties: Array.from(props).sort() }))
        .sort((a, b) => a.licensor.localeCompare(b.licensor));
    },
    staleTime: 60_000,
  });

  const filters = useMemo(
    () => ({ licensor, property, nameSearch: nameSearch.trim() }),
    [licensor, property, nameSearch],
  );

  const { data: results, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["popsg", "files", filters, page],
    queryFn: async () => {
      let q = supabase
        .from("style_guide_files")
        .select(
          "id,filename,relative_path,directory_path,file_extension,path_segments,licensor_name,property_name,depth,thumbnail_url,thumbnail_error,size_bytes,modified_at",
          { count: "exact" },
        )
        .eq("is_active", true);

      if (filters.licensor !== "all") q = q.eq("licensor_name", filters.licensor);
      if (filters.property !== "all") q = q.eq("property_name", filters.property);
      if (filters.nameSearch) q = q.ilike("filename", `%${filters.nameSearch}%`);

      q = q
        .order("licensor_name", { ascending: true, nullsFirst: false })
        .order("property_name", { ascending: true, nullsFirst: false })
        .order("filename", { ascending: true });
      q = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as StyleGuideFile[], total: count ?? 0 };
    },
  });

  const rows = results?.rows ?? [];
  const total = results?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = licensor !== "all" || property !== "all" || !!nameSearch.trim();
  const hasAnyData = tree.length > 0;

  const handleTreeSelect = (l: string, p: string) => {
    setLicensor(l);
    setProperty(p);
    setPage(0);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* ── Sidebar ── */}
      {hasAnyData && (
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-background lg:flex">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Folders
            </span>
            <span className="text-[10px] text-muted-foreground">{total.toLocaleString()} files</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            <FolderTree
              tree={tree}
              licensor={licensor}
              property={property}
              onSelect={handleTreeSelect}
            />
          </div>
        </aside>
      )}

      {/* ── Main ── */}
      <div className="flex min-w-0 flex-1 flex-col">
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
            {/* Filename search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 w-48 pl-8 text-xs"
                placeholder="Search filename…"
                value={nameSearch}
                onChange={(e) => { setNameSearch(e.target.value); setPage(0); }}
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-8 gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState hasFilters={hasFilters || hasAnyData} />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {rows.map((f) => (
                  <FileCard key={f.id} file={f} onClick={() => setSelectedFile(f)} />
                ))}
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {rows.length} of {total.toLocaleString()} file{total === 1 ? "" : "s"}
                </span>
                <div className="flex items-center gap-2">
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
      <FileDetailSheet file={selectedFile} onClose={() => setSelectedFile(null)} />
    </div>
  );
}
