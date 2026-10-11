import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Settings2, Save } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface RenderPolicy {
  mode: "fallback_only" | "shared" | "primary";
  shared_percent: number;
  shared_types: string[];
  shared_min_mb: number;
  require_windows_healthy: boolean;
  max_pending_jobs: number;
  final_fallback_on_local_failure: boolean;
}

export const DEFAULT_POLICY: RenderPolicy = {
  mode: "fallback_only",
  shared_percent: 30,
  shared_types: ["psd", "ai"],
  shared_min_mb: 0,
  require_windows_healthy: true,
  max_pending_jobs: 500,
  final_fallback_on_local_failure: true,
};

export function RenderPolicyEditor() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data: configData, isLoading } = useQuery({
    queryKey: ["admin-config", "WINDOWS_RENDER_POLICY"],
    queryFn: () => call("get-config", { keys: ["WINDOWS_RENDER_POLICY"] }),
  });

  const savedPolicy: RenderPolicy = (() => {
    const entry = (
      configData?.config?.WINDOWS_RENDER_POLICY?.value ?? configData?.config?.WINDOWS_RENDER_POLICY
    ) as RenderPolicy | null;
    return entry && typeof entry === "object" ? { ...DEFAULT_POLICY, ...entry } : DEFAULT_POLICY;
  })();

  const [form, setForm] = useState<RenderPolicy | null>(null);
  const policy = form ?? savedPolicy;
  const isDirty = form !== null;

  const update = (patch: Partial<RenderPolicy>) => setForm({ ...policy, ...patch });

  const saveMutation = useMutation({
    mutationFn: () => call("set-config", { entries: { WINDOWS_RENDER_POLICY: policy } }),
    onSuccess: () => {
      toast.success("Render policy saved — takes effect on next heartbeat");
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
          <Settings2 className="h-4 w-4" /> Windows Render Policy
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Mode</Label>
          <Select value={policy.mode} onValueChange={(v) => update({ mode: v as RenderPolicy["mode"] })}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fallback_only">Fallback Only</SelectItem>
              <SelectItem value="shared">Shared (load sharing)</SelectItem>
              <SelectItem value="primary">Windows Solo</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {policy.mode === "fallback_only" && "Bridge generates all thumbnails locally. Windows only handles local failures."}
            {policy.mode === "shared" && "Bridge offloads a percentage of thumbnails to Windows while still doing local work."}
            {policy.mode === "primary" && "Bridge skips local thumbnail generation entirely — all rendering goes to Windows."}
          </p>
        </div>

        {/* Shared-mode settings */}
        {policy.mode === "shared" && (
          <div className="rounded-md border border-border bg-muted/20 p-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Offload Percentage: {policy.shared_percent}%</Label>
              <Slider
                value={[policy.shared_percent]}
                onValueChange={([v]) => update({ shared_percent: v })}
                min={5} max={95} step={5}
                className="max-w-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                {policy.shared_percent}% of eligible files will be sent to Windows for rendering.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">File Types to Share</Label>
              <div className="flex gap-3">
                {(["psd", "ai"] as const).map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={policy.shared_types.includes(t)}
                      onChange={(e) => {
                        const types = e.target.checked
                          ? [...policy.shared_types, t]
                          : policy.shared_types.filter((x) => x !== t);
                        update({ shared_types: types });
                      }}
                      className="rounded border-border"
                    />
                    .{t.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Minimum File Size (MB)</Label>
              <Input
                type="number"
                className="max-w-[120px] text-xs font-mono"
                value={policy.shared_min_mb}
                onChange={(e) => update({ shared_min_mb: Math.max(0, Number(e.target.value)) })}
                min={0}
              />
              <p className="text-[11px] text-muted-foreground">
                Only offload files larger than this. 0 = no minimum.
              </p>
            </div>
          </div>
        )}

        <Separator />

        {/* Common settings */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Final Fallback on Local Failure</Label>
              <p className="text-[11px] text-muted-foreground">
                If Bridge fails to thumbnail any file, queue it to Windows automatically.
              </p>
            </div>
            <Switch
              checked={policy.final_fallback_on_local_failure}
              onCheckedChange={(v) => update({ final_fallback_on_local_failure: v })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Require Windows Agent Healthy</Label>
              <p className="text-[11px] text-muted-foreground">
                Only offload if Windows agent has passed its last preflight check.
              </p>
            </div>
            <Switch
              checked={policy.require_windows_healthy}
              onCheckedChange={(v) => update({ require_windows_healthy: v })}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Max Pending Jobs</Label>
            <Input
              type="number"
              className="max-w-[120px] text-xs font-mono"
              value={policy.max_pending_jobs}
              onChange={(e) => update({ max_pending_jobs: Math.max(1, Number(e.target.value)) })}
              min={1}
            />
            <p className="text-[11px] text-muted-foreground">
              Stop queuing new render jobs when this many are already pending.
            </p>
          </div>
        </div>

        {isDirty && (
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} title={saveMutation.isPending ? "Saving…" : undefined}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Save Policy
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Remote Controls ─────────────────────────────────────────────────
