import { useState, useEffect } from "react";
import { HardDrive, FolderPlus, Trash2, Save, Gauge, Clock, Calendar as CalendarIcon, ArrowRight, FlaskConical, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

// ── DigitalOcean Spaces (non-secret fields only) ────────────────────

function SpacesConfigSettings() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config", "SPACES_CONFIG"],
    queryFn: () => call("get-config", { keys: ["SPACES_CONFIG"] }),
  });

  const currentConfig = (data?.config?.SPACES_CONFIG?.value ?? data?.config?.SPACES_CONFIG ?? {
    bucket: "popdam", region: "nyc3", endpoint: "https://nyc3.digitaloceanspaces.com", public_base_url: "https://popdam.nyc3.digitaloceanspaces.com"
  }) as Record<string, string>;

  const [form, setForm] = useState<Record<string, string> | null>(null);
  const values = form ?? currentConfig;

  const saveMutation = useMutation({
    mutationFn: () => call("set-config", { entries: { SPACES_CONFIG: values } }),
    onSuccess: () => {
      toast.success("Spaces config saved — agent picks up on next heartbeat");
      setForm(null);
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
        <p className="text-xs text-muted-foreground">
          Non-secret settings only. Access Key &amp; Secret are configured in the agent's <code>.env</code> file on the NAS and never stored here.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
        {form && (
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
    const interval = setInterval(async () => {
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
        setResult({ error: "Timed out waiting for agent response. Is the Bridge Agent running?" });
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

  return (
    <div className="space-y-2">
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
      {status === "done" && result && (
        <div className="bg-muted/50 rounded-md px-3 py-2 space-y-1 text-xs">
          {result.error ? (
            <div className="flex items-center gap-1.5 text-destructive">
              <XCircle className="h-3.5 w-3.5 shrink-0" /> {String(result.error)}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                {(result.mount_root_valid as boolean) ? (
                  <><CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> <span>Container mount root <code className="font-mono">{mountRoot}</code> exists</span></>
                ) : (
                  <><XCircle className="h-3.5 w-3.5 text-destructive shrink-0" /> <span>Container mount root <code className="font-mono">{mountRoot}</code> not found</span></>
                )}
              </div>
              {Array.isArray(result.scan_root_results) && (result.scan_root_results as Array<Record<string, unknown>>).map((sr, i) => (
                <div key={i} className="flex items-center gap-1.5 ml-4">
                  {sr.valid ? (
                    <><CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> <code className="font-mono">{String(sr.path)}</code> <span className="text-muted-foreground">({String(sr.file_count ?? "?")} items)</span></>
                  ) : (
                    <><XCircle className="h-3.5 w-3.5 text-destructive shrink-0" /> <code className="font-mono">{String(sr.path)}</code> <span className="text-muted-foreground">— {String(sr.error || "not found")}</span></>
                  )}
                </div>
              ))}
              {result.tested_at && (
                <p className="text-[10px] text-muted-foreground mt-1">Tested at {new Date(result.tested_at as string).toLocaleString()}</p>
              )}
            </>
          )}
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

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config", "SCAN_ROOTS", "NAS_CONTAINER_MOUNT_ROOT", "NAS_HOST_PATH"],
    queryFn: () => call("get-config", { keys: ["SCAN_ROOTS", "NAS_CONTAINER_MOUNT_ROOT", "NAS_HOST_PATH"] }),
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
  const [schedules, setSchedules] = useState<Schedule[]>((guardConfig.schedules as Schedule[]) || []);
  const [dirty, setDirty] = useState(false);

  // Sync from fetched data
  const loaded = !isLoading && data;
  useState(() => {
    if (loaded) {
      setCpuLimit((guardConfig.default_cpu_shares as number) || 50);
      setMemLimit((guardConfig.default_memory_limit_mb as number) || 512);
      setConcurrency((guardConfig.default_thumb_concurrency as number) || 2);
      setSchedules((guardConfig.schedules as Schedule[]) || []);
    }
  });

  const saveMutation = useMutation({
    mutationFn: () => call("set-config", {
      entries: {
        RESOURCE_GUARD: {
          default_cpu_shares: cpuLimit,
          default_memory_limit_mb: memLimit,
          default_thumb_concurrency: concurrency,
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
          </div>
        </div>
        {dirty && (
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Save Date Cutoffs
          </Button>
        )}
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

// ── Export ───────────────────────────────────────────────────────────

export default function WorkerManagementTab() {
  return (
    <div className="space-y-4">
      <DateCutoffSettings />
      <SpacesConfigSettings />
      <FolderManager />
      <ImageOutputSettings />
      <ResourceGuardSettings />
      <PollingConfig />
    </div>
  );
}
