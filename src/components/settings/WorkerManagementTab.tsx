import { useState } from "react";
import { HardDrive, FolderPlus, Trash2, Save, Eye, EyeOff, Gauge, Clock, Calendar as CalendarIcon } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

// ── DigitalOcean Settings ───────────────────────────────────────────

function DOSpacesSettings() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [showSecret, setShowSecret] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config", "DO_SPACES"],
    queryFn: () => call("get-config", { keys: ["DO_SPACES"] }),
  });

  const currentConfig = (data?.config?.DO_SPACES?.value ?? data?.config?.DO_SPACES ?? {
    key: "", secret: "", bucket: "popdam", region: "nyc3", endpoint: "https://nyc3.digitaloceanspaces.com"
  }) as Record<string, string>;

  const [form, setForm] = useState<Record<string, string> | null>(null);
  const values = form ?? currentConfig;

  const saveMutation = useMutation({
    mutationFn: () => call("set-config", { entries: { DO_SPACES: values } }),
    onSuccess: () => {
      toast.success("DigitalOcean Spaces settings saved");
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Access Key</Label>
            <Input className="font-mono text-xs" value={values.key || ""} onChange={(e) => update("key", e.target.value)} placeholder="DO_SPACES_KEY" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Secret Key</Label>
            <div className="relative">
              <Input className="font-mono text-xs pr-10" type={showSecret ? "text" : "password"} value={values.secret || ""} onChange={(e) => update("secret", e.target.value)} placeholder="DO_SPACES_SECRET" />
              <Button variant="ghost" size="icon" className="absolute right-0 top-0 h-full w-10" onClick={() => setShowSecret(!showSecret)}>
                {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
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
        </div>
        {form && (
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Save DO Settings
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Folder Manager (Scan Roots) ─────────────────────────────────────

function FolderManager() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [newRoot, setNewRoot] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config", "SCAN_ROOTS"],
    queryFn: () => call("get-config", { keys: ["SCAN_ROOTS"] }),
  });

  const roots: string[] = (() => {
    const val = data?.config?.SCAN_ROOTS?.value ?? data?.config?.SCAN_ROOTS;
    return Array.isArray(val) ? val : [];
  })();

  const saveMutation = useMutation({
    mutationFn: (newRoots: string[]) => call("set-config", { entries: { SCAN_ROOTS: newRoots } }),
    onSuccess: () => {
      toast.success("Scan roots updated");
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const addRoot = () => {
    const trimmed = newRoot.trim();
    if (!trimmed) return;
    if (roots.includes(trimmed)) {
      toast.error("This path is already in the list");
      return;
    }
    saveMutation.mutate([...roots, trimmed]);
    setNewRoot("");
  };

  const removeRoot = (path: string) => {
    saveMutation.mutate(roots.filter((r) => r !== path));
  };

  if (isLoading) return <Card><CardContent className="py-6"><p className="text-sm text-muted-foreground">Loading...</p></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FolderPlus className="h-4 w-4" /> Scan Roots (Folder Manager)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          These paths are relative to the NAS container mount root. The Bridge Agent validates each path against <code>NAS_CONTAINER_MOUNT_ROOT</code> before scanning.
        </p>
        <div className="flex gap-2">
          <Input className="font-mono text-xs" value={newRoot} onChange={(e) => setNewRoot(e.target.value)} placeholder="/mnt/nas/Decor/Projects" onKeyDown={(e) => e.key === "Enter" && addRoot()} />
          <Button size="sm" onClick={addRoot} disabled={!newRoot.trim()}>
            <FolderPlus className="h-3.5 w-3.5 mr-1.5" /> Add
          </Button>
        </div>
        {roots.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No scan roots configured. The agent will fall back to its .env SCAN_ROOTS.</p>
        ) : (
          <div className="space-y-1">
            {roots.map((root) => (
              <div key={root} className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
                <code className="text-xs font-mono text-foreground">{root}</code>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeRoot(root)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
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

// ── Export ───────────────────────────────────────────────────────────

export default function WorkerManagementTab() {
  return (
    <div className="space-y-4">
      <DateCutoffSettings />
      <DOSpacesSettings />
      <FolderManager />
      <ResourceGuardSettings />
      <PollingConfig />
    </div>
  );
}
