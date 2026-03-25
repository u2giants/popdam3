import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, FolderSearch, CheckCircle2, XCircle, Clock, ChevronLeft, ChevronRight, Search, FolderOpen } from "lucide-react";
import { toast } from "sonner";

export default function StyleGuideCrawlTab() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  // Crawl status
  const { data } = useQuery({
    queryKey: ["style-guide-crawl-status"],
    queryFn: () => call("get-style-guide-crawl-status"),
    refetchInterval: 5_000,
  });

  const triggerMutation = useMutation({
    mutationFn: () => call("trigger-style-guide-crawl"),
    onSuccess: () => {
      toast.success("Style guide crawl requested — waiting for agent to pick it up");
      queryClient.invalidateQueries({ queryKey: ["style-guide-crawl-status"] });
    },
    onError: (e) => toast.error(e.message),
  });

  // File browser state
  const [showFiles, setShowFiles] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [extFilter, setExtFilter] = useState("");

  const { data: fileData, isLoading: filesLoading } = useQuery({
    queryKey: ["style-guide-files", page, search, folderFilter, extFilter],
    queryFn: () => call("browse-style-guide-files", {
      page,
      page_size: 50,
      search: search || undefined,
      parent_folder: folderFilter || undefined,
      extension: extFilter || undefined,
    }),
    enabled: showFiles,
  });

  const request = data?.request as Record<string, unknown> | null;
  const lastRun = data?.last_run as Record<string, unknown> | null;
  const totalActive = (data?.total_active_files as number) ?? 0;
  const status = request?.status as string | null;
  const isActive = status === "pending" || status === "claimed" || status === "running";

  const files = (fileData?.files || []) as Array<Record<string, unknown>>;
  const totalFiles = (fileData?.total as number) ?? 0;
  const totalPages = Math.ceil(totalFiles / 50);
  const folders = (fileData?.folders || []) as string[];
  const extensions = (fileData?.extensions || []) as string[];

  function formatBytes(bytes: number | null): string {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FolderSearch className="h-4 w-4" /> Style Guide Crawl
          </CardTitle>
          <Button
            variant="default"
            size="sm"
            className="gap-1.5"
            onClick={() => triggerMutation.mutate()}
            disabled={isActive || triggerMutation.isPending}
          >
            {isActive ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderSearch className="h-3.5 w-3.5" />
            )}
            {isActive ? "Crawling..." : "Crawl Style Guides"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Recursively scan the Style Guides NAS folder and record all file names for matching against licensing sheets.
          </p>

          {/* Status */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Status:</span>
            {!status || status === "completed" ? (
              <Badge variant="outline" className="gap-1 text-[hsl(var(--success))]">
                <CheckCircle2 className="h-3 w-3" /> Idle
              </Badge>
            ) : status === "failed" ? (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3 w-3" /> Failed
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 animate-pulse">
                <Loader2 className="h-3 w-3 animate-spin" />
                {status === "pending" ? "Waiting for agent..." : status === "claimed" ? "Starting..." : "Running..."}
              </Badge>
            )}
          </div>

          {status === "failed" && request?.error && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-md p-2">
              {request.error as string}
            </div>
          )}

          {/* Results */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/50 rounded-md p-3 text-center">
              <div className="text-2xl font-bold text-foreground">{totalActive.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Active Files</div>
            </div>
            <div className="bg-muted/50 rounded-md p-3 text-center">
              <div className="text-2xl font-bold text-foreground">
                {lastRun?.files_found != null ? (lastRun.files_found as number).toLocaleString() : "—"}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Last Crawl Found</div>
            </div>
            <div className="bg-muted/50 rounded-md p-3 text-center">
              <div className="text-sm font-medium text-foreground flex items-center justify-center gap-1">
                <Clock className="h-3 w-3" />
                {lastRun?.completed_at
                  ? new Date(lastRun.completed_at as string).toLocaleDateString()
                  : "Never"}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Last Completed</div>
            </div>
          </div>

          {lastRun?.roots_scanned && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Roots scanned:</span>{" "}
              {(lastRun.roots_scanned as string[]).join(", ")}
            </div>
          )}

          {/* Toggle file browser */}
          {totalActive > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 w-full"
              onClick={() => setShowFiles(!showFiles)}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {showFiles ? "Hide Files" : `Browse ${totalActive.toLocaleString()} Files`}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* File browser */}
      {showFiles && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Crawled Files</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              <div className="flex-1 min-w-[180px]">
                <form onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(1); }}>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search filename..."
                      className="pl-8 h-9 text-sm"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                    />
                  </div>
                </form>
              </div>
              {folders.length > 0 && (
                <Select value={folderFilter} onValueChange={(v) => { setFolderFilter(v === "__all__" ? "" : v); setPage(1); }}>
                  <SelectTrigger className="w-[180px] h-9 text-sm">
                    <SelectValue placeholder="All folders" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    <SelectItem value="__all__">All folders</SelectItem>
                    {folders.map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {extensions.length > 0 && (
                <Select value={extFilter} onValueChange={(v) => { setExtFilter(v === "__all__" ? "" : v); setPage(1); }}>
                  <SelectTrigger className="w-[120px] h-9 text-sm">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All types</SelectItem>
                    {extensions.map((e) => (
                      <SelectItem key={e} value={e}>.{e}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Table */}
            {filesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : files.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">No files found</div>
            ) : (
              <div className="border rounded-md overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Filename</TableHead>
                      <TableHead className="text-xs">Parent Folder</TableHead>
                      <TableHead className="text-xs">Grandparent</TableHead>
                      <TableHead className="text-xs">Ext</TableHead>
                      <TableHead className="text-xs text-right">Size</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((f) => (
                      <TableRow key={f.id as string}>
                        <TableCell className="text-xs font-mono max-w-[250px] truncate" title={f.relative_path as string}>
                          {f.basename_no_ext as string}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {f.parent_folder as string}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {(f.grandparent_folder as string) || "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {f.file_extension ? `.${f.file_extension}` : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">
                          {formatBytes(f.size_bytes as number | null)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {((page - 1) * 50 + 1).toLocaleString()}–{Math.min(page * 50, totalFiles).toLocaleString()} of {totalFiles.toLocaleString()}
                </span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
