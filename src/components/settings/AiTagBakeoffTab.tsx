import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Check, Loader2, Play, RefreshCw, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useAdminApi } from "@/hooks/useAdminApi";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { formatOpenRouterPricing, type OpenRouterPricing } from "@/lib/openrouter-pricing";

type Slot = "a" | "b" | "c";
type Field = "tags" | "description" | "characters" | "property";

type VisionModel = {
  id: string;
  name: string;
  supports_tools?: boolean;
  pricing?: OpenRouterPricing | null;
};

type BakeoffRun = {
  id: string;
  name: string;
  status: string;
  model_a: string;
  model_b: string;
  model_c: string;
  sample_size: number;
  created_at: string;
  completed_at: string | null;
};

type BakeoffAsset = {
  id: string;
  filename: string | null;
  relative_path: string | null;
  thumbnail_url: string | null;
};

type BakeoffResult = {
  id: string;
  run_id: string;
  asset_id: string;
  model_slot: Slot;
  model_id: string;
  status: string;
  tags: string[];
  ai_description: string | null;
  character_names: string[];
  property_name: string | null;
  latency_ms: number | null;
  error_message: string | null;
};

type BakeoffReview = {
  id: string;
  run_id: string;
  asset_id: string;
  field: Field | "overall";
  winner_slot: Slot | null;
  notes: string | null;
};

const FIELD_LABELS: Record<Field, string> = {
  tags: "Tags",
  description: "Description",
  characters: "Characters",
  property: "Property",
};

const SLOT_LABELS: Record<Slot, string> = { a: "Model A", b: "Model B", c: "Model C" };

function fmtModel(id: string) {
  return id.split("/").pop() ?? id;
}

function fieldValue(result: BakeoffResult | undefined, field: Field) {
  if (!result) return "Pending";
  if (result.status === "failed") return result.error_message || "Failed";
  if (result.status !== "succeeded") return result.status;
  if (field === "tags") return result.tags.length ? result.tags.join(", ") : "No tags";
  if (field === "description") return result.ai_description || "No description";
  if (field === "characters") return result.character_names.length ? result.character_names.join(", ") : "No characters";
  return result.property_name || "No property";
}

function RunStatusBadge({ status }: { status: string }) {
  const variant = status === "completed" ? "default" : status === "failed" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

export default function AiTagBakeoffTab() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const op = usePersistentOperation("ai-tag-bakeoff");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [name, setName] = useState("");
  const [sampleSize, setSampleSize] = useState(30);
  const [models, setModels] = useState<[string, string, string]>(["", "", ""]);

  const { data: modelData, isLoading: modelsLoading } = useQuery({
    queryKey: ["openrouter-vision-models-bakeoff"],
    queryFn: () => call("get-openrouter-vision-models"),
    staleTime: 5 * 60 * 1000,
  });

  const visionModels = useMemo(() => {
    const list = ((modelData?.models ?? []) as VisionModel[]);
    return [...list].sort((a, b) => {
      if (a.supports_tools !== b.supports_tools) return a.supports_tools ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
  }, [modelData]);

  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ["ai-tag-bakeoff-runs"],
    queryFn: () => call("list-ai-tag-bakeoff-runs"),
    refetchInterval: op.isActive || op.isQueued ? 3000 : 30_000,
  });
  const runs = (runsData?.runs ?? []) as BakeoffRun[];
  const activeRunId = selectedRunId || runs[0]?.id || "";

  const { data: runData, isLoading: runLoading } = useQuery({
    queryKey: ["ai-tag-bakeoff-run", activeRunId],
    enabled: !!activeRunId,
    queryFn: () => call("get-ai-tag-bakeoff-run", { run_id: activeRunId }),
    refetchInterval: op.isActive || op.isQueued ? 3000 : 15_000,
  });

  const currentRun = runData?.run as BakeoffRun | undefined;
  const assets = useMemo(() => (runData?.assets ?? []) as BakeoffAsset[], [runData?.assets]);
  const results = useMemo(() => (runData?.results ?? []) as BakeoffResult[], [runData?.results]);
  const reviews = useMemo(() => (runData?.reviews ?? []) as BakeoffReview[], [runData?.reviews]);

  const resultsByAsset = useMemo(() => {
    const map = new Map<string, Partial<Record<Slot, BakeoffResult>>>();
    for (const result of results) {
      const row = map.get(result.asset_id) ?? {};
      row[result.model_slot] = result;
      map.set(result.asset_id, row);
    }
    return map;
  }, [results]);

  const reviewsByAssetField = useMemo(() => {
    const map = new Map<string, BakeoffReview>();
    for (const review of reviews) map.set(`${review.asset_id}:${review.field}`, review);
    return map;
  }, [reviews]);

  const summary = useMemo(() => {
    const wins: Record<Slot, number> = { a: 0, b: 0, c: 0 };
    for (const review of reviews) {
      if (review.winner_slot) wins[review.winner_slot]++;
    }
    return {
      totalResponses: (currentRun?.sample_size ?? 0) * 3,
      succeeded: results.filter((r) => r.status === "succeeded").length,
      failed: results.filter((r) => r.status === "failed").length,
      wins,
    };
  }, [currentRun?.sample_size, results, reviews]);

  const createRun = useMutation({
    mutationFn: async () => {
      const selectedModels = models.map((m) => m.trim());
      if (selectedModels.some((m) => !m)) throw new Error("Choose three models");
      if (new Set(selectedModels).size !== 3) throw new Error("Choose three different models");
      const res = await call("create-ai-tag-bakeoff-run", {
        name: name.trim() || undefined,
        sample_size: sampleSize,
        model_ids: selectedModels,
      });
      await op.queue({
        params: { run_id: res.run.id },
        initialProgress: { evaluated: 0, failed: 0, total: sampleSize * 3 },
        forceRestart: true,
      });
      return res.run as BakeoffRun;
    },
    onSuccess: (run) => {
      toast.success("Bake-off queued");
      setSelectedRunId(run.id);
      queryClient.invalidateQueries({ queryKey: ["ai-tag-bakeoff-runs"] });
      queryClient.invalidateQueries({ queryKey: ["ai-tag-bakeoff-run", run.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scoreField = useMutation({
    mutationFn: (payload: { asset_id: string; field: Field | "overall"; winner_slot: Slot }) => call("score-ai-tag-bakeoff-field", {
      run_id: activeRunId,
      ...payload,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-tag-bakeoff-run", activeRunId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const opProgress = op.state.progress ?? {};
  const opTotal = (opProgress.total as number) || summary.totalResponses || 0;
  const opDone = ((opProgress.evaluated as number) || 0) + ((opProgress.failed as number) || 0);
  const progressPct = opTotal > 0 ? Math.min(100, Math.round((opDone / opTotal) * 100)) : 0;

  const modelSelect = (idx: 0 | 1 | 2) => (
    <div className="space-y-1">
      <Label className="text-xs">{SLOT_LABELS[(["a", "b", "c"] as Slot[])[idx]]}</Label>
      {visionModels.length > 0 ? (
        <Select value={models[idx]} onValueChange={(value) => setModels((prev) => {
          const next: [string, string, string] = [...prev];
          next[idx] = value;
          return next;
        })}>
          <SelectTrigger className="h-8 font-mono text-xs">
            <SelectValue placeholder={modelsLoading ? "Loading..." : "Select model"} />
          </SelectTrigger>
          <SelectContent className="sm:min-w-[28rem]">
            {visionModels.map((model) => (
              <SelectItem key={model.id} value={model.id} className="font-mono text-xs" suffix={formatOpenRouterPricing(model.pricing)}>
                {fmtModel(model.id)}{model.supports_tools === false ? " (no tools)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={models[idx]}
          onChange={(e) => setModels((prev) => {
            const next: [string, string, string] = [...prev];
            next[idx] = e.target.value;
            return next;
          })}
          className="h-8 font-mono text-xs"
          placeholder="provider/model"
        />
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Vision Bake-Off
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="grid gap-3 sm:grid-cols-3">
              {modelSelect(0)}
              {modelSelect(1)}
              {modelSelect(2)}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto] items-end">
              <div className="space-y-1">
                <Label className="text-xs">Run name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" placeholder="Vision bake-off" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Assets</Label>
                <Input type="number" min={1} max={500} value={sampleSize} onChange={(e) => setSampleSize(Number(e.target.value) || 1)} className="h-8 text-xs" />
              </div>
              <Button onClick={() => createRun.mutate()} disabled={createRun.isPending || op.isActive || op.isQueued} className="gap-1.5">
                {createRun.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Start
              </Button>
            </div>
          </div>

          {(op.isActive || op.isQueued || op.state.status === "completed") && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{op.isQueued ? "Queued" : op.isActive ? "Running" : op.state.result_message || "Latest run complete"}</span>
                <span className="font-mono">{opDone.toLocaleString()} / {opTotal.toLocaleString()}</span>
              </div>
              <Progress value={progressPct} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4" /> Results
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={activeRunId} onValueChange={setSelectedRunId}>
                <SelectTrigger className="h-8 w-[320px] text-xs">
                  <SelectValue placeholder={runsLoading ? "Loading runs..." : "Select a run"} />
                </SelectTrigger>
                <SelectContent>
                  {runs.map((run) => (
                    <SelectItem key={run.id} value={run.id} className="text-xs">
                      {run.name} · {new Date(run.created_at).toLocaleDateString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["ai-tag-bakeoff-runs"] });
                if (activeRunId) queryClient.invalidateQueries({ queryKey: ["ai-tag-bakeoff-run", activeRunId] });
              }}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!activeRunId && <div className="text-sm text-muted-foreground">No bake-off runs yet.</div>}
          {runLoading && <div className="text-sm text-muted-foreground">Loading run...</div>}
          {currentRun && (
            <>
              <div className="grid gap-2 md:grid-cols-5">
                <div className="rounded-md border border-border p-3">
                  <div className="text-xs text-muted-foreground">Status</div>
                  <RunStatusBadge status={currentRun.status} />
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="text-xs text-muted-foreground">Responses</div>
                  <div className="text-sm font-medium">{summary.succeeded} / {summary.totalResponses}</div>
                </div>
                {(["a", "b", "c"] as Slot[]).map((slot) => (
                  <div key={slot} className="rounded-md border border-border p-3">
                    <div className="text-xs text-muted-foreground">{SLOT_LABELS[slot]} wins</div>
                    <div className="text-sm font-medium">{summary.wins[slot]}</div>
                  </div>
                ))}
              </div>

              <div className="space-y-4">
                {assets.map((asset) => {
                  const bySlot = resultsByAsset.get(asset.id) ?? {};
                  const overallReview = reviewsByAssetField.get(`${asset.id}:overall`);
                  return (
                    <div key={asset.id} className="rounded-md border border-border overflow-hidden">
                      <div className="grid gap-3 lg:grid-cols-[220px_1fr] p-3 bg-muted/30">
                        <div className="flex gap-3 min-w-0">
                          {asset.thumbnail_url ? (
                            <img src={asset.thumbnail_url} alt="" className="h-24 w-24 object-contain rounded border border-border bg-background" />
                          ) : (
                            <div className="h-24 w-24 rounded border border-border bg-muted" />
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate" title={asset.filename ?? ""}>{asset.filename}</div>
                            <div className="text-xs text-muted-foreground line-clamp-3" title={asset.relative_path ?? ""}>{asset.relative_path}</div>
                            <div className="flex gap-1 pt-2">
                              {(["a", "b", "c"] as Slot[]).map((slot) => (
                                <Button
                                  key={slot}
                                  variant={overallReview?.winner_slot === slot ? "default" : "outline"}
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => scoreField.mutate({ asset_id: asset.id, field: "overall", winner_slot: slot })}
                                >
                                  {overallReview?.winner_slot === slot && <Check className="mr-1 h-3 w-3" />}
                                  {slot.toUpperCase()}
                                </Button>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          {(["a", "b", "c"] as Slot[]).map((slot) => (
                            <div key={slot} className="rounded border border-border bg-background p-2 min-w-0">
                              <div className="font-medium truncate" title={currentRun[`model_${slot}` as "model_a"]}>{SLOT_LABELS[slot]}</div>
                              <div className="font-mono text-muted-foreground truncate" title={currentRun[`model_${slot}` as "model_a"]}>{fmtModel(currentRun[`model_${slot}` as "model_a"])}</div>
                              <div className="pt-1">
                                <Badge variant={bySlot[slot]?.status === "succeeded" ? "default" : bySlot[slot]?.status === "failed" ? "destructive" : "secondary"}>
                                  {bySlot[slot]?.status ?? "pending"}
                                </Badge>
                                {bySlot[slot]?.latency_ms && <span className="ml-2 text-muted-foreground">{Math.round((bySlot[slot]!.latency_ms ?? 0) / 100) / 10}s</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-t border-border bg-muted/20">
                              <th className="w-32 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Field</th>
                              {(["a", "b", "c"] as Slot[]).map((slot) => (
                                <th key={slot} className="min-w-[240px] px-3 py-2 text-left text-xs font-medium text-muted-foreground">{SLOT_LABELS[slot]}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(["tags", "description", "characters", "property"] as Field[]).map((field) => {
                              const review = reviewsByAssetField.get(`${asset.id}:${field}`);
                              return (
                                <tr key={field} className="border-t border-border align-top">
                                  <td className="px-3 py-3 text-xs font-medium text-muted-foreground">{FIELD_LABELS[field]}</td>
                                  {(["a", "b", "c"] as Slot[]).map((slot) => {
                                    const selected = review?.winner_slot === slot;
                                    const result = bySlot[slot];
                                    return (
                                      <td key={slot} className="px-3 py-3">
                                        <button
                                          className={`w-full rounded-md border p-2 text-left transition-colors ${selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}
                                          onClick={() => scoreField.mutate({ asset_id: asset.id, field, winner_slot: slot })}
                                        >
                                          <div className="min-h-10 text-xs leading-relaxed whitespace-pre-wrap break-words">
                                            {fieldValue(result, field)}
                                          </div>
                                          <div className="mt-2 text-[10px] text-muted-foreground">{selected ? "Selected winner" : "Click to select"}</div>
                                        </button>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
