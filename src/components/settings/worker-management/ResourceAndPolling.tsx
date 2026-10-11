import { useState, useEffect } from "react";
import { Trash2, Save, Gauge, Clock } from "lucide-react";
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

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface Schedule {
  name: string;
  days: number[];
  start_hour: number;
  end_hour: number;
  cpu_shares: number;
  memory_limit_mb: number;
  thumb_concurrency: number;
}

export function ResourceGuardSettings() {
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
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} title={saveMutation.isPending ? "Saving…" : undefined}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Save Resource Guard
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Polling Config ──────────────────────────────────────────────────

export function PollingConfig() {
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
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} title={saveMutation.isPending ? "Saving…" : undefined}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Save Polling Config
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Export ───────────────────────────────────────────────────────────

// ── Date Cutoffs ────────────────────────────────────────────────────
