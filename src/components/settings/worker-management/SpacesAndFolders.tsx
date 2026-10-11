import { useState, useEffect } from "react";
import { HardDrive, FolderPlus, Trash2, Save, ArrowRight, FlaskConical, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

// ── DigitalOcean Spaces ──────────────────────────────────────────────

export function SpacesConfigSettings() {
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
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} title={saveMutation.isPending ? "Saving…" : undefined}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Save Spaces Config
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Path Test Button ─────────────────────────────────────────────────

export function PathTestButton({ hostPath, mountRoot, scanRoots }: { hostPath: string; mountRoot: string; scanRoots: string[] }) {
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
        title={!mountRoot ? "Enter a container mount path above first" : status === "waiting" ? "Waiting for agent response…" : undefined}
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

export function FolderManager() {
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
            <Button size="sm" onClick={() => savePathsMutation.mutate()} disabled={savePathsMutation.isPending} title={savePathsMutation.isPending ? "Saving…" : undefined}>
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
          <Button size="sm" onClick={addFolder} disabled={!newFolder.trim()} title={!newFolder.trim() ? "Enter a folder path first" : undefined}>
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
          <Button size="sm" onClick={addSubfilter} disabled={!newSubfilter.trim()} title={!newSubfilter.trim() ? "Enter a value first" : undefined}>
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
