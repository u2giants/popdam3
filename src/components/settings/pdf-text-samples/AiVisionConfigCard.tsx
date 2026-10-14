import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, Save, RefreshCw, Check } from "lucide-react";
import { toast } from "sonner";
import { formatOpenRouterPricing, hasUnavailableOpenRouterPricing, type OpenRouterPricing } from "@/lib/openrouter-pricing";
import { catalogWarningOf, modelAllowedForTask, modelInPool, normalizeAiModelPool, preserveCatalogOnWarning } from "@/lib/ai-model-options";
import { useSecretFingerprint } from "@/hooks/useSecretFingerprint";

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number | null;
  pricing?: OpenRouterPricing | null;
}

// ── AI vision model config card ───────────────────────────────────────────────

export function AiVisionConfigCard() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data: configData } = useQuery({
    queryKey: ["admin-config", "PDF_EXTRACTION_CONFIG", "OPENROUTER_API_KEY", "AI_MODEL_POOL"],
    queryFn: () => call("get-config", { keys: ["PDF_EXTRACTION_CONFIG", "OPENROUTER_API_KEY", "AI_MODEL_POOL"] }),
  });
  const savedOpenRouterKey = ((configData?.config?.OPENROUTER_API_KEY as Record<string, unknown> | undefined)?.value
    ?? configData?.config?.OPENROUTER_API_KEY
    ?? "") as string;
  const openRouterAccountFingerprint = useSecretFingerprint(savedOpenRouterKey);

  // Fetch vision models live from OpenRouter and saved selection in parallel
  const pdfModelQueryKey = ["openrouter-vision-models", openRouterAccountFingerprint] as const;
  const { data: modelsData, isLoading: modelsLoading, error: modelsError } = useQuery<{ models: OpenRouterModel[]; warning: string | null }>({
    queryKey: pdfModelQueryKey,
    enabled: !!savedOpenRouterKey && openRouterAccountFingerprint !== null,
    queryFn: async () => {
      const data = await call("get-openrouter-vision-models");
      const warning = catalogWarningOf(data);
      const incoming = (data?.models ?? []) as OpenRouterModel[];
      // A warning means the server fell back to a cached/partial catalog.
      // Keep it (merged with the last good one) and surface the warning.
      const previous = queryClient.getQueryData<{ models: OpenRouterModel[] }>(pdfModelQueryKey)?.models;
      return { models: preserveCatalogOnWarning(previous, incoming, warning), warning };
    },
    staleTime: 5 * 60_000,
  });

  const modelPool = normalizeAiModelPool(
    (configData?.config?.AI_MODEL_POOL as Record<string, unknown> | undefined)?.value
      ?? configData?.config?.AI_MODEL_POOL,
  );
  const availableVisionModels: OpenRouterModel[] = ((modelsData?.models ?? []) as OpenRouterModel[])
    .filter((m) => !hasUnavailableOpenRouterPricing(m.pricing) && modelAllowedForTask(m.id, "pdf_extraction"));
  const savedModelId: string = (() => {
    const raw = configData?.config?.PDF_EXTRACTION_CONFIG?.value ?? configData?.config?.PDF_EXTRACTION_CONFIG;
    return (raw as Record<string, string> | null)?.ai_vision_model_id ?? "";
  })();
  const visionModels = availableVisionModels.filter((model) => modelInPool(model.id, modelPool));
  const currentOutsidePool = !!savedModelId && !modelInPool(savedModelId, modelPool);
  const currentOption = currentOutsidePool
    ? availableVisionModels.find((model) => model.id === savedModelId) ?? { id: savedModelId, name: savedModelId, context_length: null }
    : undefined;
  const selectModels = currentOption && !visionModels.some((model) => model.id === currentOption.id)
    ? [currentOption, ...visionModels]
    : visionModels;

  const [selectedModelId, setSelectedModelId] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (savedModelId && !loaded) {
      setSelectedModelId(savedModelId);
      setLoaded(true);
    }
  }, [savedModelId, loaded]);

  const saveMutation = useMutation({
    mutationFn: () =>
      call("set-config", { entries: { PDF_EXTRACTION_CONFIG: { ai_vision_model_id: selectedModelId } } }),
    onSuccess: () => {
      toast.success("AI vision model saved — takes effect on next PDF sample run");
      queryClient.invalidateQueries({ queryKey: ["admin-config", "PDF_EXTRACTION_CONFIG"] });
      setLoaded(false);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save"),
  });

  const isDirty = selectedModelId !== savedModelId;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          AI Vision Model
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Used as the final fallback when mupdf text extraction and OCR both fail (e.g. scanned PDFs with no machine-readable text).
          Sourced live from OpenRouter — all models that accept image input are shown.
        </p>
        {modelsLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading models from OpenRouter…
          </div>
        )}
        {modelsError && (
          <p className="text-sm text-destructive">
            Could not load models from OpenRouter: {(modelsError as Error).message}
          </p>
        )}
        {modelsData?.warning && (
          <p className="text-sm text-amber-600">{modelsData.warning}; showing the last available catalog.</p>
        )}
        {!modelsLoading && !modelsError && availableVisionModels.length === 0 && !currentOutsidePool && (
          <p className="text-sm text-amber-600">
            No vision models returned. Check that <code className="text-xs">OPENROUTER_API_KEY</code> is set in admin_config.
          </p>
        )}
        {!modelsLoading && availableVisionModels.length > 0 && visionModels.length === 0 && (
          <p className="text-sm text-amber-600">
            {currentOutsidePool
              ? "All PDF catalog models are hidden by the Model Pool; the saved selection remains available. Add another in Settings → Processing → AI Tagging."
              : "All PDF models are hidden by the Model Pool. Add one in Settings → Processing → AI Tagging."}
          </p>
        )}
        {selectModels.length > 0 && (
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Vision model ({visionModels.length} available)</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Refresh model list from OpenRouter"
                  disabled={modelsLoading}
                  onClick={() => queryClient.refetchQueries({ queryKey: ["openrouter-vision-models"] })}
                >
                  <RefreshCw className={`h-3 w-3 ${modelsLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
              <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select a vision model…" />
                </SelectTrigger>
                <SelectContent className="max-h-72 sm:min-w-[34rem]">
                  {selectModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs" suffix={formatOpenRouterPricing(m.pricing)}>
                      {m.name}
                      <span className="ml-2 text-muted-foreground text-[10px]">{m.id}</span>
                      {currentOutsidePool && m.id === savedModelId && <span className="ml-2 text-amber-600 text-[10px]">outside Model Pool</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currentOutsidePool && selectedModelId === savedModelId && (
                <p className="text-[10px] text-amber-600">The saved model is outside the Model Pool and remains selected until you choose a model shown in the pool.</p>
              )}
            </div>
            <Button
              size="sm"
              disabled={!isDirty || !selectedModelId || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              className="h-8"
            >
              {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Save className="h-3.5 w-3.5 mr-1.5" />Save</>}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── .ai / .pdf Duplicates Card ────────────────────────────────────────────────
