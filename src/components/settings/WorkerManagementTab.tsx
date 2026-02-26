import { useState, useEffect, useCallback } from "react";
import { HardDrive, FolderPlus, Trash2, Save, Gauge, Clock, Calendar as CalendarIcon, ArrowRight, FlaskConical, CheckCircle2, XCircle, Loader2, RefreshCw, Square, FolderOpen, AlertTriangle, FolderX } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminApi } from "@/hooks/useAdminApi";
import { useScanProgress, type ScanProgress } from "@/hooks/useScanProgress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── DigitalOcean Spaces ──────────────────────────────────────────────

function SpacesConfigSettings() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config", "SPACES_CONFIG", "DO_SPACES_KEY", "DO_SPACES_SECRET"],
    queryFn: () => call("get-config", { keys: ["SPACES_CONFIG", "DO_SPACES_KEY", "DO_SPACES_SECRET"] }),
  });

  const currentConfig = (data?.config?.SPACES_CONFIG?.value ?? data?.config?.SPACES_CONFIG ?? {
    bucket: "popdam", region: "nyc3", endpoint: "https://nyc3.digitaloceanspaces.com", public_base_url: "https://popdam.nyc3.digitaloceanspaces.com"
  }) as Record<string, string>;

  const currentKey = (data?.config?.DO_SPACES_KEY?.value ?? data?.config?.DO_SPACES_KEY ?? "") as string;
  const currentSecret = (data?.config?.DO_SPACES_SECRET?.value ?? data?.config?.DO_SPACES_SECRET ?? "") as string;

  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [keyForm, setKeyForm] = useState<string | null>(null);
  const [secretForm, setSecretForm] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const values = form ?? currentConfig;
  const keyValue = keyForm ?? currentKey;
  const secretValue = secretForm ?? currentSecret;
  const isDirty = form !== null || keyForm !== null || secretForm !== null;

  const saveMutation = useMutation({
    mutationFn: () => {
      const entries: Record<string, unknown> = { SPACES_CONFIG: values };
      if (keyForm !== null) entries.DO_SPACES_KEY = keyForm;
      if (secretForm !== null) entries.DO_SPACES_SECRET = secretForm;
      return call("set-config", { entries });
    },
    onSuccess: () => {
      toast.success("Spaces config saved — agent picks up on next heartbeat");
      setForm(null);
      setKeyForm(null);
      setSecretForm(null);
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const update = (key: string, val: string) => {
    setForm({ ...values, [key]: val });
  };

  if (isLoading) return <Card><CardContent className="py-6"><p className="text-sm text-muted-foreground">Loading...</p></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <HardDrive className="h-4 w-4" /> DigitalOcean Spaces
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Spaces Access Key</Label>
            <div className="flex gap-1.5">
              <Input className="font-mono text-xs flex-1" type={showKey ? "text" : "password"} value={keyValue} onChange={(e) => setKeyForm(e.target.value)} placeholder="DO00..." />
              <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={() => setShowKey(!showKey)}>{showKey ? "Hide" : "Show"}</Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Spaces Secret Key</Label>
            <div className="flex gap-1.5">
              <Input className="font-mono text-xs flex-1" type={showSecret ? "text" : "password"} value={secretValue} onChange={(e) => setSecretForm(e.target.value)} placeholder="••••••••" />
              <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={() => setShowSecret(!showSecret)}>{showSecret ? "Hide" : "Show"}</Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Bucket</Label>
            <Input className="font-mono text-xs" value={values.bucket || ""} onChange={(e) => update("bucket", e.target.value)} placeholder="popdam" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Region</Label>
            <Input className="font-mono text-xs" value={values.region || ""} onChange={(e) => update("region", e.target.value)} placeholder="nyc3" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs">Endpoint</Label>
            <Input className="font-mono text-xs" value={values.endpoint || ""} onChange={(e) => update("endpoint", e.target.value)} placeholder="https://nyc3.digitaloceanspaces.com" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs">Public Base URL (for thumbnail URLs)</Label>
            <Input className="font-mono text-xs" value={values.public_base_url || ""} onChange={(e) => update("public_base_url", e.target.value)} placeholder="https://popdam.nyc3.digitaloceanspaces.com" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Stored securely in your private database. Delivered to the agent automatically — no .env editing required.
        </p>
        {isDirty && (
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Save Spaces Config
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Path Test Button ─────────────────────────────────────────────────

function PathTestButton({ hostPath, mountRoot, scanRoots }: { hostPath: string; mountRoot: string; scanRoots: string[] }) {
  const { call } = useAdminApi();
  const [status, setStatus] = useState<"idle" | "waiting" | "done">("idle");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  // Poll for result when waiting
  useEffect(() => {
    if (status !== "waiting" || !requestId) return;
    let pollCount = 0;
    const interval = setInterval(async () => {
      pollCount++;
      try {
        const resp = await call("get-config", { keys: ["PATH_TEST_RESULT"] });
        const testResult = resp?.config?.PATH_TEST_RESULT?.value ?? resp?.config?.PATH_TEST_RESULT;
        if (testResult && typeof testResult === "object" && (testResult as Record<string, unknown>).request_id === requestId) {
          setResult(testResult as Record<string, unknown>);
          setStatus("done");
        }
      } catch { /* keep polling */ }
    }, 3000);
    // Timeout after 60s
    const timeout = setTimeout(() => {
      if (status === "waiting") {
        setResult({ agent_offline: true });
        setStatus("done");
      }
    }, 60000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [status, requestId, call]);

  const startTest = async () => {
    const id = crypto.randomUUID();
    setRequestId(id);
    setResult(null);
    setStatus("waiting");
    try {
      await call("set-config", {
        entries: {
          PATH_TEST_REQUEST: { request_id: id, status: "pending", host_path: hostPath, container_mount_root: mountRoot, scan_roots: scanRoots },
        },
      });
    } catch (e) {
      setResult({ error: `Failed to send test request: ${e instanceof Error ? e.message : String(e)}` });
      setStatus("done");
    }
  };

  const isAgentOffline = result && (result as Record<string, unknown>).agent_offline === true;
  const hasError = result && typeof result.error === "string";
  const hasResults = result && !isAgentOffline && !hasError;

  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        onClick={startTest}
        disabled={status === "waiting" || !mountRoot}
        className="gap-1.5"
      >
        {status === "waiting" ? (
          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for agent...</>
        ) : (
          <><FlaskConical className="h-3.5 w-3.5" /> Test Paths</>
        )}
      </Button>
      {status === "waiting" && (
        <p className="text-[11px] text-muted-foreground">
          Request sent. The agent will validate paths on its next heartbeat (up to ~30s).
        </p>
      )}

      {/* Agent offline */}
      {status === "done" && isAgentOffline && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 space-y-1">
          <div className="flex items-center gap-2 text-destructive font-medium text-sm">
            <XCircle className="h-4 w-4 shrink-0" />
            NAS Agent Not Reachable
          </div>
          <p className="text-xs text-muted-foreground ml-6">
            The Bridge Agent did not respond within 60 seconds. Make sure the Docker container is running on your Synology NAS and can reach the internet.
          </p>
        </div>
      )}

      {/* Generic error */}
      {status === "done" && hasError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
          <div className="flex items-center gap-2 text-destructive text-sm">
            <XCircle className="h-4 w-4 shrink-0" />
            {String(result!.error)}
          </div>
        </div>
      )}

      {/* Successful results panel */}
      {status === "done" && hasResults && (
        <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/50">
            <p className="text-xs font-semibold text-foreground">Path Test Results</p>
            {result!.tested_at && (
              <p className="text-[10px] text-muted-foreground">
                Tested at {new Date(result!.tested_at as string).toLocaleString()}
              </p>
            )}
          </div>
          <div className="px-4 py-3 space-y-3">
            {/* Mount root */}
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Container Mount Root</p>
              <div className="flex items-center gap-2">
                {(result!.mount_root_valid as boolean) ? (
                  <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))] shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                )}
                <code className="text-xs font-mono">{mountRoot}</code>
                <Badge variant={(result!.mount_root_valid as boolean) ? "secondary" : "destructive"} className="text-[10px]">
                  {(result!.mount_root_valid as boolean) ? "Valid" : "Not Found"}
                </Badge>
              </div>
            </div>

            {/* Scan roots */}
            {Array.isArray(result!.scan_root_results) && (result!.scan_root_results as Array<Record<string, unknown>>).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Scan Folders</p>
                <div className="space-y-1.5">
                  {(result!.scan_root_results as Array<Record<string, unknown>>).map((sr, i) => {
                    const isValid = sr.valid === true;
                    const fileCount = sr.file_count as number | undefined;
                    const isEmpty = isValid && fileCount === 0;
                    return (
                      <div key={i} className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
                        isEmpty ? "bg-[hsl(var(--warning)/0.08)] border border-[hsl(var(--warning)/0.3)]"
                          : isValid ? "bg-[hsl(var(--success)/0.06)] border border-[hsl(var(--success)/0.2)]"
                          : "bg-destructive/5 border border-destructive/20"
                      }`}>
                        {isEmpty ? (
                          <span className="text-[hsl(var(--warning))] shrink-0 text-base leading-none">⚠</span>
                        ) : isValid ? (
                          <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))] shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive shrink-0" />
                        )}
                        <code className="font-mono flex-1 truncate">{String(sr.path)}</code>
                        {isValid ? (
                          <span className={`shrink-0 font-medium ${isEmpty ? "text-[hsl(var(--warning))]" : "text-[hsl(var(--success))]"}`}>
                            {fileCount} item{fileCount !== 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="shrink-0 text-destructive">{String(sr.error || "not found")}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Folder Manager (Scan Roots) ─────────────────────────────────────

function FolderManager() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [newFolder, setNewFolder] = useState("");
  const [newSubfilter, setNewSubfilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config", "SCAN_ROOTS", "NAS_CONTAINER_MOUNT_ROOT", "NAS_HOST_PATH", "SCAN_ALLOWED_SUBFOLDERS"],
    queryFn: () => call("get-config", { keys: ["SCAN_ROOTS", "NAS_CONTAINER_MOUNT_ROOT", "NAS_HOST_PATH", "SCAN_ALLOWED_SUBFOLDERS"] }),
  });

  const mountRoot: string = (() => {
    const val = data?.config?.NAS_CONTAINER_MOUNT_ROOT?.value ?? data?.config?.NAS_CONTAINER_MOUNT_ROOT;
    return typeof val === "string" ? val : "/mnt/nas";
  })();

  const hostPath: string = (() => {
    const val = data?.config?.NAS_HOST_PATH?.value ?? data?.config?.NAS_HOST_PATH;
    return typeof val === "string" ? val : "";
  })();

  const roots: string[] = (() => {
    const val = data?.config?.SCAN_ROOTS?.value ?? data?.config?.SCAN_ROOTS;
    return Array.isArray(val) ? val : [];
  })();

  const allowedSubfolders: string[] = (() => {
    const val = data?.config?.SCAN_ALLOWED_SUBFOLDERS?.value ?? data?.config?.SCAN_ALLOWED_SUBFOLDERS;
    return Array.isArray(val) ? val : [];
  })();

  const [hostPathForm, setHostPathForm] = useState<string | null>(null);
  const [mountRootForm, setMountRootForm] = useState<string | null>(null);
  const hostPathValue = hostPathForm ?? hostPath;
  const mountRootValue = mountRootForm ?? mountRoot;
  const pathsDirty = hostPathForm !== null || mountRootForm !== null;

  const savePathsMutation = useMutation({
    mutationFn: () => {
      const entries: Record<string, string> = {};
      if (hostPathForm !== null) entries.NAS_HOST_PATH = hostPathForm;
      if (mountRootForm !== null) entries.NAS_CONTAINER_MOUNT_ROOT = mountRootForm;
      return call("set-config", { entries });
    },
    onSuccess: () => {
      toast.success("Volume mapping saved");
      setHostPathForm(null);
      setMountRootForm(null);
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const saveMutation = useMutation({
    mutationFn: (newRoots: string[]) => call("set-config", { entries: { SCAN_ROOTS: newRoots } }),
    onSuccess: () => {
      toast.success("Scan folders updated — agent picks up on next heartbeat");
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const saveSubfolderMutation = useMutation({
    mutationFn: (newSubs: string[]) => call("set-config", { entries: { SCAN_ALLOWED_SUBFOLDERS: newSubs } }),
    onSuccess: () => {
      toast.success("Subfolder filter updated");
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  // Convert a subfolder name to a full container path
  const toContainerPath = (subfolder: string) => {
    const mr = mountRootValue.replace(/\/+$/, "");
    const sf = subfolder.replace(/^\/+/, "").replace(/\/+$/, "");
    return sf ? `${mr}/${sf}` : mr;
  };

  // Extract subfolder from a full container path
  const toSubfolder = (fullPath: string) => {
    const mr = mountRootValue.replace(/\/+$/, "");
    if (fullPath.startsWith(mr + "/")) return fullPath.slice(mr.length + 1);
    if (fullPath === mr) return "";
    return fullPath; // fallback — show raw
  };

  const addFolder = () => {
    const trimmed = newFolder.trim().replace(/^\/+/, "").replace(/\/+$/, "");
    if (!trimmed) return;
    const containerPath = toContainerPath(trimmed);
    if (roots.includes(containerPath)) {
      toast.error("This folder is already in the list");
      return;
    }
    saveMutation.mutate([...roots, containerPath]);
    setNewFolder("");
  };

  const removeRoot = (path: string) => {
    saveMutation.mutate(roots.filter((r) => r !== path));
  };

  const addSubfilter = () => {
    const trimmed = newSubfilter.trim().toLowerCase();
    if (!trimmed) return;
    if (allowedSubfolders.includes(trimmed)) {
      toast.error("This subfolder is already in the filter");
      return;
    }
    saveSubfolderMutation.mutate([...allowedSubfolders, trimmed]);
    setNewSubfilter("");
  };

  const removeSubfilter = (name: string) => {
    saveSubfolderMutation.mutate(allowedSubfolders.filter((s) => s !== name));
  };

  if (isLoading) return <Card><CardContent className="py-6"><p className="text-sm text-muted-foreground">Loading...</p></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FolderPlus className="h-4 w-4" /> Volume Mapping &amp; Scan Folders
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Volume Mapping */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Docker Volume Mapping</Label>
          <p className="text-xs text-muted-foreground">
            This mirrors the <code>volumes:</code> line in your Synology Container Manager.
            The <strong>Synology path</strong> is the shared folder you see in DSM File Station.
            The <strong>Container path</strong> is where the agent sees it internally.
          </p>
          <div className="flex items-center gap-2 bg-muted/50 rounded-md p-3">
            <div className="flex-1 space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Synology Path (DSM File Station)</Label>
              <Input
                className="font-mono text-xs"
                value={hostPathValue}
                onChange={(e) => setHostPathForm(e.target.value)}
                placeholder="/volume1/Design"
              />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-5" />
            <div className="flex-1 space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Container Path (inside Docker)</Label>
              <Input
                className="font-mono text-xs"
                value={mountRootValue}
                onChange={(e) => setMountRootForm(e.target.value)}
                placeholder="/mnt/nas"
              />
            </div>
          </div>
          {hostPathValue && mountRootValue && (
            <div className="text-[11px] font-mono text-muted-foreground bg-muted/30 rounded px-3 py-1.5">
              docker-compose: <span className="text-primary">{hostPathValue}:{mountRootValue}:ro</span>
            </div>
          )}
          <PathTestButton hostPath={hostPathValue} mountRoot={mountRootValue} scanRoots={roots} />
          {pathsDirty && (
            <Button size="sm" onClick={() => savePathsMutation.mutate()} disabled={savePathsMutation.isPending}>
              <Save className="h-3.5 w-3.5 mr-1.5" /> Save Mapping
            </Button>
          )}
        </div>

        <Separator />

        {/* Scan Folders */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Folders to Scan</Label>
          <p className="text-xs text-muted-foreground">
            Which subfolders inside <strong>{hostPathValue || "/volume1/Design"}</strong> should the agent scan for <code>.psd</code> / <code>.ai</code> files?
            Enter folder names as you see them in <strong>DSM File Station</strong>.
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            className="font-mono text-xs"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            placeholder="Decor/Projects"
            onKeyDown={(e) => e.key === "Enter" && addFolder()}
          />
          <Button size="sm" onClick={addFolder} disabled={!newFolder.trim()}>
            <FolderPlus className="h-3.5 w-3.5 mr-1.5" /> Add Folder
          </Button>
        </div>
        {roots.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No folders configured. Add at least one subfolder to start scanning.</p>
        ) : (
          <div className="space-y-1">
            {roots.map((root) => {
              const subfolder = toSubfolder(root);
              const synPath = hostPathValue ? `${hostPathValue.replace(/\/+$/, "")}/${subfolder}` : subfolder;
              return (
                <div key={root} className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
                  <div className="min-w-0">
                    <code className="text-xs font-mono text-foreground block truncate">📁 {synPath || root}</code>
                    <code className="text-[10px] font-mono text-muted-foreground block truncate">→ {root}</code>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive shrink-0" onClick={() => removeRoot(root)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <Separator />

        {/* Subfolder Filter */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Subfolder Filter</Label>
          <p className="text-xs text-muted-foreground">
            If set, only files under these subfolders of <code>Decor/</code> will be ingested.
            Leave empty to ingest <strong>all files</strong> in your scan roots.
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            className="font-mono text-xs"
            value={newSubfilter}
            onChange={(e) => setNewSubfilter(e.target.value)}
            placeholder="Character Licensed"
            onKeyDown={(e) => e.key === "Enter" && addSubfilter()}
          />
          <Button size="sm" onClick={addSubfilter} disabled={!newSubfilter.trim()}>
            Add
          </Button>
        </div>
        {allowedSubfolders.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No filter — all files in scan roots will be ingested.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {allowedSubfolders.map((sub) => (
              <Badge key={sub} variant="secondary" className="gap-1 font-mono text-xs">
                {sub}
                <button
                  className="ml-0.5 hover:text-destructive"
                  onClick={() => removeSubfilter(sub)}
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Resource Guard ──────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Schedule {
  name: string;
  days: number[];
  start_hour: number;
  end_hour: number;
  cpu_shares: number;
  memory_limit_mb: number;
  thumb_concurrency: number;
}

function ResourceGuardSettings() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config", "RESOURCE_GUARD"],
    queryFn: () => call("get-config", { keys: ["RESOURCE_GUARD"] }),
  });

  const guardConfig = (() => {
    const val = data?.config?.RESOURCE_GUARD?.value ?? data?.config?.RESOURCE_GUARD;
    return (val && typeof val === "object" ? val : {}) as Record<string, unknown>;
  })();

  const [cpuLimit, setCpuLimit] = useState<number>((guardConfig.default_cpu_shares as number) || 50);
  const [memLimit, setMemLimit] = useState<number>((guardConfig.default_memory_limit_mb as number) || 512);
  const [concurrency, setConcurrency] = useState<number>((guardConfig.default_thumb_concurrency as number) || 2);
  const [batchSize, setBatchSize] = useState<number>((guardConfig.batch_size as number) || 100);
  const [schedules, setSchedules] = useState<Schedule[]>((guardConfig.schedules as Schedule[]) || []);
  const [dirty, setDirty] = useState(false);

  // Sync from fetched data
  const loaded = !isLoading && data;
  useEffect(() => {
    if (loaded) {
      setCpuLimit((guardConfig.default_cpu_shares as number) || 50);
      setMemLimit((guardConfig.default_memory_limit_mb as number) || 512);
      setConcurrency((guardConfig.default_thumb_concurrency as number) || 2);
      setBatchSize((guardConfig.batch_size as number) || 100);
      setSchedules((guardConfig.schedules as Schedule[]) || []);
      setDirty(false);
    }
  }, [loaded]);

  const saveMutation = useMutation({
    mutationFn: () => call("set-config", {
      entries: {
        RESOURCE_GUARD: {
          default_cpu_shares: cpuLimit,
          default_memory_limit_mb: memLimit,
          default_thumb_concurrency: concurrency,
          batch_size: batchSize,
          schedules,
        }
      }
    }),
    onSuccess: () => {
      toast.success("Resource Guard saved");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const addSchedule = () => {
    setSchedules([...schedules, {
      name: `Schedule ${schedules.length + 1}`,
      days: [1, 2, 3, 4, 5],
      start_hour: 9,
      end_hour: 17,
      cpu_shares: 25,
      memory_limit_mb: 256,
      thumb_concurrency: 1,
    }]);
    setDirty(true);
  };

  const removeSchedule = (idx: number) => {
    setSchedules(schedules.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const updateSchedule = (idx: number, updates: Partial<Schedule>) => {
    setSchedules(schedules.map((s, i) => i === idx ? { ...s, ...updates } : s));
    setDirty(true);
  };

  const toggleDay = (idx: number, day: number) => {
    const sched = schedules[idx];
    const days = sched.days.includes(day) ? sched.days.filter((d) => d !== day) : [...sched.days, day].sort();
    updateSchedule(idx, { days });
  };

  if (isLoading) return <Card><CardContent className="py-6"><p className="text-sm text-muted-foreground">Loading...</p></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4" /> Resource Guard
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h4 className="text-sm font-medium mb-3">Default Limits (when no schedule is active)</h4>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">CPU Limit</Label>
                <Badge variant="secondary" className="font-mono text-xs">{cpuLimit}%</Badge>
              </div>
              <Slider value={[cpuLimit]} onValueChange={(v) => { setCpuLimit(v[0]); setDirty(true); }} min={10} max={100} step={5} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Memory Limit</Label>
                <Badge variant="secondary" className="font-mono text-xs">{memLimit} MB</Badge>
              </div>
              <Slider value={[memLimit]} onValueChange={(v) => { setMemLimit(v[0]); setDirty(true); }} min={128} max={2048} step={64} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Thumbnail Concurrency</Label>
                <Badge variant="secondary" className="font-mono text-xs">{concurrency}</Badge>
              </div>
              <Slider value={[concurrency]} onValueChange={(v) => { setConcurrency(v[0]); setDirty(true); }} min={1} max={8} step={1} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Files per Ingest Batch</Label>
                <Badge variant="secondary" className="font-mono text-xs">{batchSize}</Badge>
              </div>
              <Slider value={[batchSize]} onValueChange={(v) => { setBatchSize(v[0]); setDirty(true); }} min={50} max={1000} step={50} />
              <p className="text-[11px] text-muted-foreground">Higher = faster scans, more memory per batch. Recommended: 200–500.</p>
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" /> Schedules (UTC)
            </h4>
            <Button size="sm" variant="outline" onClick={addSchedule}>Add Schedule</Button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Define time windows with different resource limits. During office hours you might want lower limits.
          </p>

          {schedules.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No schedules — default limits apply 24/7.</p>
          ) : (
            <div className="space-y-4">
              {schedules.map((sched, idx) => (
                <div key={idx} className="border border-border rounded-md p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <Input className="text-xs font-medium w-40" value={sched.name} onChange={(e) => updateSchedule(idx, { name: e.target.value })} />
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeSchedule(idx)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="flex gap-1">
                    {DAY_NAMES.map((name, day) => (
                      <Button key={day} size="sm" variant={sched.days.includes(day) ? "default" : "outline"} className="h-7 w-10 text-xs px-0" onClick={() => toggleDay(idx, day)}>
                        {name}
                      </Button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Start Hour (UTC)</Label>
                      <Input type="number" className="text-xs" min={0} max={23} value={sched.start_hour} onChange={(e) => updateSchedule(idx, { start_hour: parseInt(e.target.value) || 0 })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">End Hour (UTC)</Label>
                      <Input type="number" className="text-xs" min={0} max={24} value={sched.end_hour} onChange={(e) => updateSchedule(idx, { end_hour: parseInt(e.target.value) || 24 })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">CPU %</Label>
                      <Slider value={[sched.cpu_shares]} onValueChange={(v) => updateSchedule(idx, { cpu_shares: v[0] })} min={10} max={100} step={5} />
                      <span className="text-xs text-muted-foreground">{sched.cpu_shares}%</span>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Memory MB</Label>
                      <Slider value={[sched.memory_limit_mb]} onValueChange={(v) => updateSchedule(idx, { memory_limit_mb: v[0] })} min={128} max={2048} step={64} />
                      <span className="text-xs text-muted-foreground">{sched.memory_limit_mb} MB</span>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Concurrency</Label>
                      <Slider value={[sched.thumb_concurrency]} onValueChange={(v) => updateSchedule(idx, { thumb_concurrency: v[0] })} min={1} max={8} step={1} />
                      <span className="text-xs text-muted-foreground">{sched.thumb_concurrency}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {dirty && (
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Save Resource Guard
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Polling Config ──────────────────────────────────────────────────

function PollingConfig() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config", "POLLING_CONFIG"],
    queryFn: () => call("get-config", { keys: ["POLLING_CONFIG"] }),
  });

  const pollingConfig = (() => {
    const val = data?.config?.POLLING_CONFIG?.value ?? data?.config?.POLLING_CONFIG;
    return (val && typeof val === "object" ? val : { idle_seconds: 30, active_seconds: 5, batch_size: 100 }) as Record<string, number>;
  })();

  const [form, setForm] = useState<Record<string, number> | null>(null);
  const values = form ?? pollingConfig;

  const saveMutation = useMutation({
    mutationFn: () => call("set-config", { entries: { POLLING_CONFIG: values } }),
    onSuccess: () => {
      toast.success("Polling config saved");
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const update = (key: string, val: number) => {
    setForm({ ...values, [key]: val });
  };

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" /> Polling & Batch Config
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Idle Poll Interval (seconds)</Label>
            <Input type="number" className="text-xs" value={values.idle_seconds ?? 30} onChange={(e) => update("idle_seconds", parseInt(e.target.value) || 30)} min={5} max={300} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Active Poll Interval (seconds)</Label>
            <Input type="number" className="text-xs" value={values.active_seconds ?? 5} onChange={(e) => update("active_seconds", parseInt(e.target.value) || 5)} min={1} max={60} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ingest Batch Size</Label>
            <Input type="number" className="text-xs" value={values.batch_size ?? 100} onChange={(e) => update("batch_size", parseInt(e.target.value) || 100)} min={10} max={1000} />
          </div>
        </div>
        {form && (
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Save Polling Config
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Export ───────────────────────────────────────────────────────────

// ── Date Cutoffs ────────────────────────────────────────────────────

function DateCutoffSettings() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config", "DATE_CUTOFFS"],
    queryFn: () => call("get-config", { keys: ["SCAN_MIN_DATE", "THUMBNAIL_MIN_DATE"] }),
  });

  const currentScan = (() => {
    const val = data?.config?.SCAN_MIN_DATE?.value ?? data?.config?.SCAN_MIN_DATE;
    return typeof val === "string" ? val : "2010-01-01";
  })();
  const currentThumb = (() => {
    const val = data?.config?.THUMBNAIL_MIN_DATE?.value ?? data?.config?.THUMBNAIL_MIN_DATE;
    return typeof val === "string" ? val : "2020-01-01";
  })();

  const [scanDate, setScanDate] = useState<string | null>(null);
  const [thumbDate, setThumbDate] = useState<string | null>(null);

  const scanVal = scanDate ?? currentScan;
  const thumbVal = thumbDate ?? currentThumb;
  const dirty = scanDate !== null || thumbDate !== null;

  const saveMutation = useMutation({
    mutationFn: () => {
      const entries: Record<string, string> = {};
      if (scanDate !== null) entries.SCAN_MIN_DATE = scanDate;
      if (thumbDate !== null) entries.THUMBNAIL_MIN_DATE = thumbDate;
      return call("set-config", { entries });
    },
    onSuccess: () => {
      toast.success("Date cutoffs saved");
      setScanDate(null);
      setThumbDate(null);
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const [isPurging, setIsPurging] = useState(false);

  const { data: purgePreview } = useQuery({
    queryKey: ["purge-preview", thumbVal],
    queryFn: async () => {
      const result = await call("run-query", {
        sql: `SELECT COUNT(*) as count FROM assets WHERE is_deleted = false AND modified_at < '${thumbVal}'`,
      });
      return Number(result.rows?.[0]?.count ?? 0);
    },
    enabled: !!thumbVal,
  });

  async function handlePurge() {
    if (!window.confirm(
      `This will permanently remove ${purgePreview?.toLocaleString()} assets ` +
      `with a file date before ${thumbVal} from the library. ` +
      `This cannot be undone. Continue?`
    )) return;
    setIsPurging(true);
    let totalPurged = 0;
    let totalGroupsRemoved = 0;
    let totalGroupsUpdated = 0;
    try {
      while (true) {
        const result = await call("purge-old-assets", {
          cutoff_date: thumbVal,
        });
        totalPurged += result.assets_purged ?? 0;
        totalGroupsRemoved += result.groups_removed ?? 0;
        totalGroupsUpdated += result.groups_updated ?? 0;
        if (result.done) break;
      }
      toast.success(
        `Purged ${totalPurged.toLocaleString()} assets. ` +
        `Removed ${totalGroupsRemoved} empty groups, ` +
        `updated ${totalGroupsUpdated} groups.`
      );
      queryClient.invalidateQueries({ queryKey: ["style-groups"] });
      queryClient.invalidateQueries({ queryKey: ["purge-preview"] });
      queryClient.invalidateQueries({ queryKey: ["style-group-stats"] });
      queryClient.invalidateQueries({ queryKey: ["ungrouped-asset-count"] });
    } catch (e: any) {
      toast.error(e.message || "Purge failed");
    } finally {
      setIsPurging(false);
    }
  }

  if (isLoading) return <Card><CardContent className="py-6"><p className="text-sm text-muted-foreground">Loading...</p></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarIcon className="h-4 w-4" /> Date Cutoffs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Files older than <strong>Scan Min Date</strong> are skipped during ingestion entirely. 
          Files older than <strong>Thumbnail Min Date</strong> are ingested but hidden from the library unless they have a thumbnail.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Scan Min Date (don't ingest files older than this)</Label>
            <Input
              type="date"
              className="font-mono text-xs"
              value={scanVal}
              onChange={(e) => setScanDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Thumbnail Min Date (visibility threshold)</Label>
            <Input
              type="date"
              className="font-mono text-xs"
              value={thumbVal}
              onChange={(e) => setThumbDate(e.target.value)}
            />
            {purgePreview != null && purgePreview > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                {purgePreview.toLocaleString()} assets older than this date are currently in the library
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {dirty && (
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save className="h-3.5 w-3.5 mr-1.5" /> Save Date Cutoffs
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={handlePurge}
            disabled={isPurging || !thumbVal || !purgePreview}
          >
            {isPurging ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
            Purge {purgePreview?.toLocaleString() ?? "…"} assets older than {thumbVal}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Image Output Settings ───────────────────────────────────────────

function ImageOutputSettings() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config", "IMAGE_OUTPUT"],
    queryFn: () => call("get-config", { keys: ["IMAGE_OUTPUT"] }),
  });

  const currentConfig = (() => {
    const val = data?.config?.IMAGE_OUTPUT?.value ?? data?.config?.IMAGE_OUTPUT;
    return (val && typeof val === "object" ? val : {
      thumbnail_height: 400,
      preview_height: 1200,
      jpeg_quality: 85,
    }) as Record<string, number>;
  })();

  const [form, setForm] = useState<Record<string, number> | null>(null);
  const values = form ?? currentConfig;
  const dirty = form !== null;

  const update = (key: string, val: number) => {
    setForm({ ...values, [key]: val });
  };

  const saveMutation = useMutation({
    mutationFn: () => call("set-config", { entries: { IMAGE_OUTPUT: values } }),
    onSuccess: () => {
      toast.success("Image output settings saved — agent picks up on next heartbeat");
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Card><CardContent className="py-6"><p className="text-sm text-muted-foreground">Loading...</p></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4" /> Image Output Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-xs text-muted-foreground">
          Control the output resolution (by height — width scales proportionally) and JPEG compression quality for generated thumbnails and previews.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Thumbnail Height</Label>
            <Badge variant="secondary" className="font-mono text-xs">{values.thumbnail_height ?? 400}px</Badge>
          </div>
          <Slider
            value={[values.thumbnail_height ?? 400]}
            onValueChange={(v) => update("thumbnail_height", v[0])}
            min={200}
            max={800}
            step={50}
          />
          <p className="text-[10px] text-muted-foreground">Used for grid view cards. Default: 400px.</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Preview Height</Label>
            <Badge variant="secondary" className="font-mono text-xs">{values.preview_height ?? 1200}px</Badge>
          </div>
          <Slider
            value={[values.preview_height ?? 1200]}
            onValueChange={(v) => update("preview_height", v[0])}
            min={600}
            max={2400}
            step={100}
          />
          <p className="text-[10px] text-muted-foreground">Used for detail panel / lightbox. Default: 1200px.</p>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">JPEG Quality</Label>
            <Badge variant="secondary" className="font-mono text-xs">{values.jpeg_quality ?? 85}%</Badge>
          </div>
          <Slider
            value={[values.jpeg_quality ?? 85]}
            onValueChange={(v) => update("jpeg_quality", v[0])}
            min={50}
            max={100}
            step={5}
          />
          <p className="text-[10px] text-muted-foreground">Higher = better quality, larger files. Default: 85%.</p>
        </div>

        {dirty && (
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Save Image Settings
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Grouped Tab Exports ──────────────────────────────────────────────

/** NAS & Storage tab: Volume mapping, scan folders, DO Spaces config */
export function NasStorageTab() {
  return (
    <div className="space-y-4">
      <FolderManager />
      <SpacesConfigSettings />
    </div>
  );
}

/** Image Output tab: Thumbnail/preview resolution, JPEG quality */
export function ImageOutputTab() {
  return (
    <div className="space-y-4">
      <ImageOutputSettings />
    </div>
  );
}

// ── Auto-Scan Toggle ────────────────────────────────────────────────

function AutoScanSettings() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config", "AUTO_SCAN_CONFIG"],
    queryFn: () => call("get-config", { keys: ["AUTO_SCAN_CONFIG"] }),
  });

  const currentConfig = (() => {
    const val = data?.config?.AUTO_SCAN_CONFIG?.value ?? data?.config?.AUTO_SCAN_CONFIG;
    return (val && typeof val === "object" ? val : { enabled: false, interval_hours: 6 }) as { enabled: boolean; interval_hours: number };
  })();

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [intervalHours, setIntervalHours] = useState<number | null>(null);

  const effectiveEnabled = enabled ?? currentConfig.enabled;
  const effectiveInterval = intervalHours ?? currentConfig.interval_hours;
  const dirty = enabled !== null || intervalHours !== null;

  const saveMutation = useMutation({
    mutationFn: () => call("set-config", {
      entries: {
        AUTO_SCAN_CONFIG: {
          enabled: effectiveEnabled,
          interval_hours: effectiveInterval,
        },
      },
    }),
    onSuccess: () => {
      toast.success(effectiveEnabled ? "Auto-scan enabled" : "Auto-scan disabled");
      setEnabled(null);
      setIntervalHours(null);
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  // Auto-save on toggle
  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    // Save immediately on toggle
    call("set-config", {
      entries: {
        AUTO_SCAN_CONFIG: {
          enabled: checked,
          interval_hours: effectiveInterval,
        },
      },
    }).then(() => {
      toast.success(checked ? "Auto-scan enabled — agent will scan automatically" : "Auto-scan disabled — manual scans only");
      setEnabled(null);
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    }).catch((e) => toast.error((e as Error).message));
  };

  if (isLoading) return <Card><CardContent className="py-6"><p className="text-sm text-muted-foreground">Loading...</p></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <RefreshCw className="h-4 w-4" /> Auto-Scan Mode
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Automatic Scanning</Label>
            <p className="text-xs text-muted-foreground">
              {effectiveEnabled
                ? `Agent will automatically scan every ${effectiveInterval} hour${effectiveInterval !== 1 ? "s" : ""}`
                : "Scans must be triggered manually from the library toolbar"}
            </p>
          </div>
          <Switch
            checked={effectiveEnabled}
            onCheckedChange={handleToggle}
          />
        </div>

        {effectiveEnabled && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Scan Interval</Label>
              <Badge variant="secondary" className="font-mono text-xs">{effectiveInterval}h</Badge>
            </div>
            <Slider
              value={[effectiveInterval]}
              onValueChange={(v) => setIntervalHours(v[0])}
              min={1}
              max={48}
              step={1}
            />
            <p className="text-[10px] text-muted-foreground">
              How often the agent re-scans all configured folders. Default: 6 hours.
            </p>
            {intervalHours !== null && (
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                <Save className="h-3.5 w-3.5 mr-1.5" /> Save Interval
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Scanning tab: Auto-scan mode, date cutoffs, resource guard, polling config */
export function ScanningTab() {
  return (
    <div className="space-y-4">
      <AutoScanSettings />
      <DateCutoffSettings />
      <ResourceGuardSettings />
      <PollingConfig />
    </div>
  );
}

// ── Update Bridge Agent ─────────────────────────────────────────────

export function UpdateAgentButton() {
  const { call } = useAdminApi();
  const [isPending, setIsPending] = useState(false);

  const handleUpdate = async () => {
    setIsPending(true);
    try {
      await call("trigger-agent-update", { action: "apply" });
      toast.success("Update requested — agent will restart in ~60 seconds");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to trigger update");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <RefreshCw className="h-4 w-4" /> Bridge Agent Update
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Pull the latest Docker image from GHCR and restart the bridge agent container.
          The agent will be unavailable for ~60 seconds during the restart.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleUpdate}
          disabled={isPending}
          className="gap-1.5"
        >
          {isPending ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Requesting...</>
          ) : (
            <><RefreshCw className="h-3.5 w-3.5" /> Update to Latest</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Live Scan Monitor ────────────────────────────────────────────────

function useElapsed(updatedAt: string | undefined, active: boolean): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  if (!updatedAt) return "0:00";
  const elapsed = Math.max(0, now - new Date(updatedAt).getTime());
  const totalSec = Math.floor(elapsed / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min >= 60) {
    const hr = Math.floor(min / 60);
    const rm = min % 60;
    return `${hr}:${String(rm).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function formatTimeAgo(ts: string | undefined): string {
  if (!ts) return "—";
  const ms = Date.now() - new Date(ts).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m ago`;
}

function CounterCell({ label, value, variant, onClick }: { label: string; value: number; variant?: "error" | "warning"; onClick?: () => void }) {
  const content = (
    <div className={cn("flex justify-between items-baseline", onClick && "cursor-pointer hover:bg-muted/50 -mx-1 px-1 rounded")}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn(
        "text-sm font-semibold tabular-nums",
        variant === "error" && value > 0 && "text-destructive",
        variant === "warning" && value > 0 && "text-[hsl(var(--warning))]",
        onClick && value > 0 && "underline decoration-dotted underline-offset-2",
      )}>
        {(value ?? 0).toLocaleString()}
      </span>
    </div>
  );
  return onClick ? <button type="button" onClick={onClick} className="text-left">{content}</button> : content;
}

export function LiveScanMonitor() {
  const scanProgress = useScanProgress();
  const { call } = useAdminApi();
  const [lastCompleted, setLastCompleted] = useState<ScanProgress | null>(null);
  const [showSkippedDirs, setShowSkippedDirs] = useState(false);

  // Store last completed/failed scan
  useEffect(() => {
    if (scanProgress.status === "completed" || scanProgress.status === "failed") {
      setLastCompleted(scanProgress);
    }
  }, [scanProgress.status]);

  const isRunning = scanProgress.status === "running";
  const isStale = scanProgress.status === "stale";
  const isActive = isRunning || isStale;
  const elapsed = useElapsed(scanProgress.updated_at, isActive);

  const displayProgress = isActive ? scanProgress : (lastCompleted ?? scanProgress);
  const c = displayProgress.counters;

  const handleStop = async () => {
    try {
      await call("stop-scan");
      toast.success("Stop requested — agent will abort shortly.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to stop scan");
    }
  };

  const handleReset = async () => {
    try {
      await call("reset-scan-state");
      toast.success("Scan state reset.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset scan state");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4" /> Live Scan Monitor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status indicator */}
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full shrink-0",
              isRunning && "bg-[hsl(var(--success))] animate-pulse",
              isStale && "bg-[hsl(var(--warning))]",
              scanProgress.status === "completed" && "bg-[hsl(var(--success))]",
              scanProgress.status === "failed" && "bg-destructive",
              scanProgress.status === "idle" && "bg-muted-foreground/40",
            )}
          />
          <span className="text-sm font-medium">
            {isRunning && "Scanning"}
            {isStale && "Scan appears stuck"}
            {scanProgress.status === "completed" && "Last scan completed"}
            {scanProgress.status === "failed" && "Last scan failed"}
            {scanProgress.status === "idle" && "No scan in progress"}
          </span>
          {isActive && (
            <span className="text-xs text-muted-foreground tabular-nums">{elapsed} elapsed</span>
          )}
          {!isActive && displayProgress.updated_at && (
            <span className="text-xs text-muted-foreground">{formatTimeAgo(displayProgress.updated_at)}</span>
          )}
        </div>

        {/* Stale warning */}
        {isStale && (
          <div className="flex items-center gap-2 rounded-md border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.08)] px-3 py-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-[hsl(var(--warning))] shrink-0" />
            <span>No progress update for over 3 minutes.</span>
            <Button variant="outline" size="sm" className="ml-auto h-6 text-[10px]" onClick={handleReset}>
              Reset Scan State
            </Button>
          </div>
        )}

        {/* Counters grid */}
        {c && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border border-border bg-muted/30 px-4 py-3">
            <CounterCell label="Total encountered" value={c.files_total_encountered ?? 0} />
            <CounterCell label="Candidates (.ai/.psd)" value={c.candidates_found} />
            <CounterCell label="New assets" value={c.ingested_new} />
            <CounterCell label="Updated" value={c.updated_existing} />
            <CounterCell label="Moved" value={c.moved_detected} />
            <CounterCell label="Unchanged" value={c.noop_unchanged ?? 0} />
            <CounterCell label="Rejected (subfolder)" value={c.rejected_subfolder ?? 0} />
            <CounterCell label="Errors" value={c.errors} variant="error" />
            <CounterCell label="Skipped dirs" value={c.dirs_skipped_permission} variant="warning" onClick={c.dirs_skipped_permission > 0 ? () => setShowSkippedDirs(true) : undefined} />
          </div>
        )}

        {/* Skipped directories dialog */}
        <Dialog open={showSkippedDirs} onOpenChange={setShowSkippedDirs}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <FolderX className="h-4 w-4 text-[hsl(var(--warning))]" />
                Skipped Directories ({displayProgress.skipped_dirs?.length ?? 0})
              </DialogTitle>
            </DialogHeader>
            {displayProgress.skipped_dirs && displayProgress.skipped_dirs.length > 0 ? (
              <ScrollArea className="max-h-[400px]">
                <div className="space-y-1 pr-4">
                  {displayProgress.skipped_dirs.map((dir, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-1.5">
                      <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                      <code className="text-xs font-mono text-foreground break-all">{dir}</code>
                    </div>
                  ))}
                  {(c?.dirs_skipped_permission ?? 0) > (displayProgress.skipped_dirs?.length ?? 0) && (
                    <p className="text-xs text-muted-foreground px-3 py-2">
                      …and {(c?.dirs_skipped_permission ?? 0) - displayProgress.skipped_dirs.length} more (capped at 500)
                    </p>
                  )}
                </div>
              </ScrollArea>
            ) : (
              <p className="text-sm text-muted-foreground py-4">
                Skipped directory paths will appear here after the next scan. The Bridge Agent needs to be updated to collect this data.
              </p>
            )}
          </DialogContent>
        </Dialog>

        {/* Current path */}
        {isActive && displayProgress.current_path && (
          <div className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-2">
            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
            <code className="text-xs font-mono text-muted-foreground truncate">{displayProgress.current_path}</code>
          </div>
        )}

        {/* Actions */}
        {isActive && (
          <Button variant="outline" size="sm" onClick={handleStop} className="gap-1.5 text-destructive hover:text-destructive">
            <Square className="h-3.5 w-3.5" /> Stop Scan
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

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
