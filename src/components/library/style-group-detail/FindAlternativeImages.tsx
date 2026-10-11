import { useState, useEffect, useRef } from "react";
import type { StyleGroup } from "@/hooks/useStyleGroups";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";
import { ImageOff, Check, Loader2, FolderSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminApi } from "@/hooks/useAdminApi";
import { SectionLabel } from "./parts";

export interface SiblingImage {
  filename: string;
  relative_path: string;
  file_size: number;
  thumbnail_url?: string;
}

export function FindAlternativeImages({ group, onIngested }: { group: StyleGroup; onIngested?: () => void }) {
  const { call } = useAdminApi();
  const [loading, setLoading] = useState(false);
  const [siblings, setSiblings] = useState<SiblingImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ingesting, setIngesting] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setPolling(false);
    pollCountRef.current = 0;
  };

  const startPolling = (reqId: string) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollCountRef.current = 0;
    setPolling(true);
    setRequestId(reqId);

    pollTimerRef.current = setInterval(async () => {
      pollCountRef.current++;
      if (pollCountRef.current > 30) {
        stopPolling();
        setError("Scan timed out — the Bridge Agent may be offline. Try again later.");
        return;
      }
      try {
        const result = await call("get-sibling-scan-result", { request_id: reqId });
        if (result?.status === "completed") {
          stopPolling();
          const images = (result.images ?? []) as SiblingImage[];
          setSiblings(images);
          setSelected(new Set());
          if (images.length === 0) {
            toast("No alternative images found", { description: "No JPG, PNG, or eligible PDF files exist in this folder on the NAS." });
          } else {
            toast(`Found ${images.length} image${images.length !== 1 ? "s" : ""}`);
          }
        } else if (result?.status === "failed") {
          stopPolling();
          const msg = result.error_message || "Scan failed";
          setError(msg);
          toast.error("Folder scan failed", { description: msg });
        }
      } catch (e) {
        console.warn("Poll error:", (e as Error).message);
      }
    }, 5000);
  };

  useEffect(() => {
    if (initialLoaded || !group.folder_path) return;
    setInitialLoaded(true);
    (async () => {
      try {
        const result = await call("get-sibling-scan-by-folder", { folder_path: group.folder_path });
        if (!result?.found) return;
        if (result.status === "completed") {
          const images = (result.images ?? []) as SiblingImage[];
          setSiblings(images);
        } else if (result.status === "failed") {
          setError(result.error_message || "Previous scan failed");
        } else if (result.status === "pending") {
          startPolling(result.request_id as string);
        }
      } catch {
        // Non-fatal
      }
    })();
  }, [group.folder_path]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFind = async () => {
    setLoading(true);
    setError(null);
    setSiblings(null);
    setSelected(new Set());
    stopPolling();
    try {
      const result = await call("list-sibling-images", {
        folder_path: group.folder_path,
        style_group_id: group.id,
      });
      if (result?.status === "completed") {
        const images = (result.images ?? []) as SiblingImage[];
        setSiblings(images);
        if (images.length === 0) {
          toast("No alternative images found", { description: "No JPG, PNG, or eligible PDF files exist in this folder on the NAS." });
        }
      } else if (result?.status === "failed") {
        setError(result.error_message || "Scan failed");
      } else if (result?.status === "pending") {
        toast("Scan requested", { description: "The Bridge Agent will scan this folder shortly. Waiting for results…" });
        startPolling(result.request_id as string);
      }
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error("Failed to scan folder", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (!siblings) return;
    if (selected.size === siblings.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(siblings.map(s => s.relative_path)));
    }
  };

  const handleIngest = async () => {
    if (!siblings || selected.size === 0) return;
    setIngesting(true);
    try {
      const selectedImages = siblings.filter(s => selected.has(s.relative_path));
      const result = await call("ingest-sibling-images", {
        style_group_id: group.id,
        images: selectedImages,
      });
      const summary = result?.summary as { created: number; linked: number; errors: number } | undefined;
      if (summary) {
        const parts: string[] = [];
        if (summary.created > 0) parts.push(`${summary.created} added`);
        if (summary.linked > 0) parts.push(`${summary.linked} linked`);
        if (summary.errors > 0) parts.push(`${summary.errors} failed`);
        toast("Images ingested", { description: parts.join(", ") });
      } else {
        toast("Images ingested");
      }
      setSiblings(prev => prev?.filter(s => !selected.has(s.relative_path)) ?? null);
      setSelected(new Set());
      onIngested?.();
    } catch (e) {
      toast.error("Ingestion failed", { description: (e as Error).message });
    } finally {
      setIngesting(false);
    }
  };

  return (
    <section className="space-y-2.5 pt-4">
      <SectionLabel>
        <span className="flex items-center gap-1.5"><FolderSearch className="h-3 w-3" /> Alternative Images</span>
      </SectionLabel>
      <p className="text-[11px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))] leading-relaxed">
        Scan the NAS folder for sibling JPG, PNG, or eligible PDF files that could serve as product images.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs h-7"
        onClick={handleFind}
        disabled={loading || polling}
      >
        {loading || polling ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderSearch className="h-3 w-3" />}
        {loading ? "Scanning…" : polling ? "Waiting for results…" : siblings ? "Re-scan Folder" : "Find Sibling Files"}
      </Button>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {siblings && siblings.length > 0 && (
        <div className="space-y-2 rounded-lg border border-[var(--pd-border,hsl(var(--border)))] p-2 bg-[var(--pd-surface-2,hsl(var(--muted)/0.3))]">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))] font-medium">
              Found {siblings.length} image{siblings.length !== 1 ? "s" : ""}
            </p>
            <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={toggleAll}>
              {selected.size === siblings.length ? "Deselect All" : "Select All"}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {siblings.map((img) => {
              const isSelected = selected.has(img.relative_path);
              return (
                <div
                  key={img.relative_path}
                  className={cn(
                    "rounded-md border overflow-hidden bg-background cursor-pointer transition-colors",
                    isSelected ? "border-primary ring-1 ring-primary/30" : "border-border/50 hover:border-border"
                  )}
                  onClick={() => toggleSelect(img.relative_path)}
                >
                  {img.thumbnail_url ? (
                    <div className="aspect-square w-full bg-muted/30 overflow-hidden relative">
                      <img src={img.thumbnail_url} alt={img.filename} className="h-full w-full object-contain" loading="lazy" />
                      {isSelected && (
                        <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="aspect-square w-full bg-muted/30 flex items-center justify-center relative">
                      <ImageOff className="h-6 w-6 text-muted-foreground/20" />
                      {isSelected && (
                        <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  )}
                  <div className="p-1.5 space-y-0.5">
                    <p className="font-mono text-[10px] truncate" title={img.relative_path}>{img.filename}</p>
                    <p className="text-[9px] text-muted-foreground">
                      {img.file_size ? `${(img.file_size / 1024).toFixed(0)} KB` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          {selected.size > 0 && (
            <Button size="sm" className="w-full gap-1.5 text-xs h-7" onClick={handleIngest} disabled={ingesting}>
              {ingesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Add {selected.size} Image{selected.size !== 1 ? "s" : ""} to Group
            </Button>
          )}
        </div>
      )}

      {polling && (
        <div className="rounded-md border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.05)] p-2.5 space-y-1">
          <p className="text-[11px] text-[hsl(var(--warning))] font-medium flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Waiting for Bridge Agent…
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Scanning <span className="font-mono">{group.folder_path}</span> — typically 10–30 s.
          </p>
        </div>
      )}

      {siblings && siblings.length === 0 && !polling && (
        <p className="text-[11px] text-muted-foreground/60">No sibling files found in this folder.</p>
      )}
    </section>
  );
}
