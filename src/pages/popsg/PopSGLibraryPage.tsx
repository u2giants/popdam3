import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Folder, RefreshCw, ImageOff } from "lucide-react";

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

const PAGE_SIZE = 60;

function formatBytes(n: number | null): string {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[u]}`;
}

export default function PopSGLibraryPage() {
  const [licensor, setLicensor] = useState<string>("all");
  const [property, setProperty] = useState<string>("all");
  const [folderSearch, setFolderSearch] = useState<string>("");
  const [nameSearch, setNameSearch] = useState<string>("");
  const [page, setPage] = useState(0);

  // Distinct licensor list (path_segments[1], 1-indexed in Postgres → idx 0 in JS)
  const { data: licensors = [] } = useQuery({
    queryKey: ["popsg", "licensors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("style_guide_files")
        .select("licensor_name")
        .eq("is_active", true)
        .not("licensor_name", "is", null)
        .order("licensor_name", { ascending: true });
      if (error) throw error;
      const set = new Set<string>();
      for (const r of (data ?? []) as { licensor_name: string | null }[]) {
        if (r.licensor_name) set.add(r.licensor_name);
      }
      return Array.from(set).sort();
    },
  });

  const { data: properties = [] } = useQuery({
    queryKey: ["popsg", "properties", licensor],
    queryFn: async () => {
      let q = supabase
        .from("style_guide_files")
        .select("property_name")
        .eq("is_active", true)
        .not("property_name", "is", null);
      if (licensor !== "all") q = q.eq("licensor_name", licensor);
      const { data, error } = await q.order("property_name", { ascending: true });
      if (error) throw error;
      const set = new Set<string>();
      for (const r of (data ?? []) as { property_name: string | null }[]) {
        if (r.property_name) set.add(r.property_name);
      }
      return Array.from(set).sort();
    },
  });

  const filters = useMemo(
    () => ({ licensor, property, folderSearch: folderSearch.trim(), nameSearch: nameSearch.trim() }),
    [licensor, property, folderSearch, nameSearch],
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
      if (filters.folderSearch) q = q.contains("path_segments", [filters.folderSearch]);
      if (filters.nameSearch) q = q.ilike("filename", `%${filters.nameSearch}%`);

      q = q.order("modified_at", { ascending: false, nullsFirst: false });
      q = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as StyleGuideFile[], total: count ?? 0 };
    },
  });

  const rows = results?.rows ?? [];
  const total = results?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Style Guide Library</h1>
          <p className="text-xs text-muted-foreground">
            {total.toLocaleString()} file{total === 1 ? "" : "s"} across {licensors.length} licensor
            {licensors.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-1.5"
        >
          <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="licensor" className="text-xs">Licensor (folder level 1)</Label>
              <Select
                value={licensor}
                onValueChange={(v) => {
                  setLicensor(v);
                  setProperty("all");
                  setPage(0);
                }}
              >
                <SelectTrigger id="licensor">
                  <SelectValue placeholder="All licensors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All licensors</SelectItem>
                  {licensors.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="property" className="text-xs">Property (folder level 2)</Label>
              <Select
                value={property}
                onValueChange={(v) => {
                  setProperty(v);
                  setPage(0);
                }}
              >
                <SelectTrigger id="property">
                  <SelectValue placeholder="All properties" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All properties</SelectItem>
                  {properties.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="folder" className="text-xs">Any folder named</Label>
              <div className="relative">
                <Folder className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="folder"
                  className="pl-8"
                  placeholder="e.g. Characters"
                  value={folderSearch}
                  onChange={(e) => {
                    setFolderSearch(e.target.value);
                    setPage(0);
                  }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="name" className="text-xs">Filename contains</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="name"
                  className="pl-8"
                  placeholder="Part of filename"
                  value={nameSearch}
                  onChange={(e) => {
                    setNameSearch(e.target.value);
                    setPage(0);
                  }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No style guide files yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              {total === 0 && licensors.length === 0
                ? "No scans have run yet. Pair a bridge agent with this PopSG project, point it at /volume1/styleguides, and run a scan."
                : "No files match these filters. Try widening them."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {rows.map((f) => (
              <FileCard key={f.id} file={f} />
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Page {page + 1} of {pageCount} — showing {rows.length} of {total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FileCard({ file }: { file: StyleGuideFile }) {
  // style-guide path is path_segments joined, most relevant label is last 1-2 segments
  const lastFolder = file.path_segments[file.path_segments.length - 1] ?? "";
  const propertyLabel = file.property_name ?? file.path_segments[1] ?? "";

  return (
    <div className="group overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/40">
      <div className="relative aspect-square bg-muted/30">
        {file.thumbnail_url ? (
          // Thumbnails are on DO Spaces, same pattern as popdam
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
          {file.licensor_name ?? "?"} / {propertyLabel} {lastFolder && lastFolder !== propertyLabel ? `… / ${lastFolder}` : ""}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{formatBytes(file.size_bytes)}</span>
          <span>depth {file.depth}</span>
        </div>
      </div>
    </div>
  );
}
