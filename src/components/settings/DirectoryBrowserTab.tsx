import { useState, useCallback, useRef, useEffect } from "react";
import { useAdminApi } from "@/hooks/useAdminApi";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { FolderOpen, FileText, RefreshCw, ChevronRight, Loader2, Home, ArrowLeft, Monitor } from "lucide-react";

const LOCAL_HELPER = "http://localhost:47380";

interface DirEntry {
  name: string;
  is_dir: boolean;
  size?: number;
  modified?: string;
}

interface BrowseResult {
  request_id: string;
  path: string;
  entries: DirEntry[];
  listed_at: string;
}

async function browseViaHelper(path: string): Promise<BrowseResult> {
  const url = `${LOCAL_HELPER}/browse?path=${encodeURIComponent(path)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Helper returned ${resp.status}`);
  const data = await resp.json();
  if (!data.ok) throw new Error(data.error ?? "Helper error");
  return { request_id: "local", path: data.path, entries: data.entries, listed_at: data.listed_at };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function DirectoryBrowserTab() {
  const { call } = useAdminApi();
  const [pathInput, setPathInput] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [helperAvailable, setHelperAvailable] = useState<boolean | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Detect whether the local helper is running
  useEffect(() => {
    fetch(`${LOCAL_HELPER}/status`, { signal: AbortSignal.timeout(2000) })
      .then((r) => r.json())
      .then((d) => setHelperAvailable(d.ok === true))
      .catch(() => setHelperAvailable(false));
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const browseViaAgent = useCallback(async (path: string): Promise<BrowseResult> => {
    const { request_id } = await call("request-dir-browse", { path });

    return new Promise<BrowseResult>((resolve, reject) => {
      let done = false;

      const finish = (r: BrowseResult) => {
        if (done) return;
        done = true;
        stopPolling();
        channel.unsubscribe();
        clearTimeout(timeoutHandle);
        resolve(r);
      };

      const fail = (msg: string) => {
        if (done) return;
        done = true;
        stopPolling();
        channel.unsubscribe();
        reject(new Error(msg));
      };

      // Primary: Realtime — fires the instant the agent writes DIR_BROWSE_RESULT
      const channel = supabase
        .channel(`dir-browse-${request_id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "admin_config", filter: "key=eq.DIR_BROWSE_RESULT" },
          (payload) => {
            const v = (payload.new as Record<string, unknown>).value as Record<string, unknown> | null;
            if (!v || v.request_id !== request_id) return;
            finish({ request_id: v.request_id as string, path: v.path as string, entries: v.entries as DirEntry[], listed_at: v.listed_at as string });
          }
        )
        .subscribe();

      // Fallback: poll every 500ms in case Realtime misses the event
      pollRef.current = setInterval(async () => {
        try {
          const resp = await call("get-dir-browse-result");
          const r = resp?.result as BrowseResult | null;
          if (r?.request_id === request_id) finish(r);
        } catch { /* keep polling */ }
      }, 500);

      const timeoutHandle = setTimeout(() => fail("Timed out — agent did not respond within 60s"), 60_000);
    });
  }, [call]);

  const browse = useCallback(async (path: string) => {
    stopPolling();
    setLoading(true);
    try {
      let r: BrowseResult;
      if (helperAvailable) {
        r = await browseViaHelper(path);
      } else {
        r = await browseViaAgent(path);
      }
      setResult(r);
      setCurrentPath(r.path);
      setPathInput(r.path);
    } catch (e) {
      // If helper failed mid-session, retry via agent
      if (helperAvailable) {
        setHelperAvailable(false);
        try {
          const r = await browseViaAgent(path);
          setResult(r);
          setCurrentPath(r.path);
          setPathInput(r.path);
          return;
        } catch { /* fall through to original error */ }
      }
      toast.error(e instanceof Error ? e.message : "Browse failed");
    } finally {
      setLoading(false);
    }
  }, [helperAvailable, browseViaAgent]);

  // Auto-load scan roots once helper detection completes
  useEffect(() => {
    if (helperAvailable !== null) browse("");
  }, [helperAvailable]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBrowse = (path: string) => {
    if (currentPath && path !== currentPath) {
      setHistory((h) => [...h, currentPath]);
    }
    browse(path);
  };

  const handleBack = () => {
    const prev = history[history.length - 1];
    if (prev !== undefined) {
      setHistory((h) => h.slice(0, -1));
      browse(prev);
    }
  };

  const handleHome = () => {
    setHistory([]);
    browse("");
  };

  const handleEntryClick = (entry: DirEntry) => {
    if (!entry.is_dir) return;
    const base = currentPath.endsWith("/") ? currentPath : currentPath ? currentPath + "/" : "";
    const next = base + entry.name;
    handleBrowse(next);
  };

  const sorted = result
    ? [...result.entries].sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderOpen className="h-4 w-4" />
          Directory Browser
          {helperAvailable && (
            <span className="ml-auto flex items-center gap-1 text-xs font-normal text-green-600">
              <Monitor className="h-3 w-3" />
              Local helper
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {helperAvailable
            ? "Browsing via local POP DAM Helper — fast local filesystem access."
            : "Browse the directory structure as seen by the bridge agent on the server. Leave the path empty to list scan roots."}
        </p>

        <div className="flex gap-2">
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleBrowse(pathInput)}
            placeholder="e.g. /mnt/nas/assets  — leave empty for scan roots"
            className="font-mono text-sm"
            disabled={loading}
          />
          <Button onClick={() => handleBrowse(pathInput)} disabled={loading} size="sm">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1.5">Browse</span>
          </Button>
        </div>

        {result && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleHome}
                disabled={loading}
                className="h-7 px-2 text-xs"
              >
                <Home className="h-3 w-3 mr-1" />
                Roots
              </Button>
              {history.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                  disabled={loading}
                  className="h-7 px-2 text-xs"
                >
                  <ArrowLeft className="h-3 w-3 mr-1" />
                  Back
                </Button>
              )}
              <span className="text-xs font-mono text-muted-foreground truncate">
                {result.path || "(scan roots)"}
              </span>
              <span className="text-xs text-muted-foreground ml-auto">
                {sorted.length} item{sorted.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="border rounded-md divide-y max-h-[60vh] overflow-y-auto">
              {sorted.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Empty directory</p>
              ) : (
                sorted.map((entry) => (
                  <div
                    key={entry.name}
                    className={`flex items-center gap-3 px-3 py-2 text-sm ${entry.is_dir ? "cursor-pointer hover:bg-muted/50" : ""}`}
                    onClick={() => handleEntryClick(entry)}
                  >
                    {entry.is_dir ? (
                      <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className={`flex-1 font-mono truncate ${entry.is_dir ? "font-medium" : ""}`}>
                      {entry.name}
                    </span>
                    {entry.size !== undefined && !entry.is_dir && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatBytes(entry.size)}
                      </span>
                    )}
                    {entry.modified && (
                      <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                        {new Date(entry.modified).toLocaleDateString()}
                      </span>
                    )}
                    {entry.is_dir && (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {!result && !loading && (
          <p className="text-center text-sm text-muted-foreground py-8">
            Click Browse to list directories.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
