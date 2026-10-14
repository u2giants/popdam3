import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AI_MODEL_ENDPOINTS, aiModelEndpoint, SCALEDOWN_SUMMARIZE_MODEL, type AiModelEndpoint, type AiModelPool } from "@/lib/ai-model-options";

export interface ModelPoolOption {
  id: string;
  name: string;
}

const ENDPOINT_LABELS: Record<AiModelEndpoint, string> = {
  openrouter: "OpenRouter",
  "google-direct": "Google AI (direct)",
  "meta-direct": "Meta AI (direct)",
  "scaledown-direct": "ScaleDown (direct)",
};

const BUILT_IN_DIRECT_MODELS: ModelPoolOption[] = [SCALEDOWN_SUMMARIZE_MODEL];

export function ModelPoolEditor({
  models,
  pool,
  onChange,
  loading,
  hasChanges,
  saving,
  onSave,
}: {
  models: ModelPoolOption[];
  pool: AiModelPool;
  onChange: (next: AiModelPool) => void;
  loading: boolean;
  hasChanges: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const [search, setSearch] = useState("");
  const [activeEndpoint, setActiveEndpoint] = useState<AiModelEndpoint>("openrouter");
  const groups = useMemo(() => {
    const unique = new Map<string, ModelPoolOption>();
    for (const model of models) unique.set(model.id, model);
    for (const model of BUILT_IN_DIRECT_MODELS) {
      if (!unique.has(model.id)) unique.set(model.id, model);
    }
    return AI_MODEL_ENDPOINTS.map((endpoint) => ({
      endpoint,
      options: [...unique.values()]
        .filter((model) => aiModelEndpoint(model.id) === endpoint)
        .sort((a, b) => a.id.localeCompare(b.id)),
    }));
  }, [models]);
  const activeGroup = groups.find((group) => group.endpoint === activeEndpoint);
  const endpointOptions = activeGroup?.options ?? [];
  const endpointPool = pool[activeEndpoint];
  const includesFutureModels = !Array.isArray(endpointPool);
  const selectedIds = Array.isArray(endpointPool) ? endpointPool : endpointOptions.map((model) => model.id);
  const selectedCount = endpointOptions.filter((model) => selectedIds.includes(model.id)).length;
  const query = search.trim().toLowerCase();
  const matchingModels = query
    ? endpointOptions.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query))
    : endpointOptions;
  const shownModels = matchingModels.filter((model) => selectedIds.includes(model.id));
  const availableModels = matchingModels.filter((model) => !selectedIds.includes(model.id));

  function updateEndpoint(endpoint: AiModelEndpoint, ids: string[]) {
    onChange({ ...pool, [endpoint]: [...new Set(ids)].sort() });
  }

  function setModelShown(modelId: string, shown: boolean) {
    updateEndpoint(activeEndpoint, shown
      ? [...selectedIds, modelId]
      : selectedIds.filter((id) => id !== modelId));
  }

  function addAllAvailable() {
    updateEndpoint(activeEndpoint, endpointOptions.map((model) => model.id));
  }

  function removeAll() {
    updateEndpoint(activeEndpoint, []);
  }

  function showFutureModels() {
    const next = { ...pool };
    delete next[activeEndpoint];
    onChange(next);
  }

  return (
    <section className="space-y-3 rounded-md border border-border p-3" aria-label="Model Pool">
      <div>
        <h3 className="text-xs font-semibold">Model Pool</h3>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Add or remove models from each endpoint’s dropdowns. Save Model Pool to apply your changes. The default includes new catalog models automatically.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4" role="group" aria-label="Model Pool endpoints">
        {groups.map(({ endpoint, options }) => {
          const endpointSelection = pool[endpoint];
          const allModelsShown = !Array.isArray(endpointSelection);
          const chosenIds = allModelsShown ? options.map((model) => model.id) : endpointSelection;
          const count = options.filter((model) => chosenIds.includes(model.id)).length;
          return (
            <button
              key={endpoint}
              type="button"
              aria-pressed={activeEndpoint === endpoint}
              onClick={() => setActiveEndpoint(endpoint)}
              disabled={saving}
              className={`rounded border px-2 py-1.5 text-left text-[10px] transition-colors ${activeEndpoint === endpoint
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border/70 text-muted-foreground hover:bg-muted/60"}`}
            >
              <span className="block font-medium">{ENDPOINT_LABELS[endpoint]}</span>
              <span className="block">{allModelsShown ? "All + future" : `${count} of ${options.length} shown`}</span>
            </button>
          );
        })}
      </div>

      <section aria-label={`${ENDPOINT_LABELS[activeEndpoint]} dropdown models`} className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold">{ENDPOINT_LABELS[activeEndpoint]} dropdown choices</h4>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {includesFutureModels
                ? "All available models are included, and new catalog models will appear automatically. Removing or adding a model creates a fixed list for this endpoint."
                : `${selectedCount} of ${endpointOptions.length} currently available models are included.`}
            </p>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {includesFutureModels ? "All models + future" : `${selectedCount}/${endpointOptions.length} included`}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={addAllAvailable} disabled={saving || endpointOptions.length === 0}>
            Add all available models
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={removeAll} disabled={saving}>
            Remove all models
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={showFutureModels} disabled={saving || includesFutureModels}>
            Include future models automatically
          </Button>
        </div>

        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search ${ENDPOINT_LABELS[activeEndpoint]} models`}
          className="h-8 text-xs"
          aria-label={`Search ${ENDPOINT_LABELS[activeEndpoint]} models`}
          disabled={saving}
        />
        {loading && <p className="text-[10px] text-muted-foreground">Refreshing available model catalogs…</p>}

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded border border-border/70 p-2">
            <h5 className="mb-1 text-[10px] font-semibold">Shown in dropdowns ({shownModels.length})</h5>
            <div className="max-h-56 space-y-1 overflow-y-auto" aria-label={`${ENDPOINT_LABELS[activeEndpoint]} models shown in dropdowns`}>
              {shownModels.map((model) => (
                <div key={model.id} className="flex items-start gap-2 rounded px-1.5 py-1 hover:bg-muted/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{model.name}</span>
                    <code className="block truncate text-[10px] text-muted-foreground">{model.id}</code>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-2 text-[10px]"
                    onClick={() => setModelShown(model.id, false)}
                    disabled={saving}
                    aria-label={`Remove ${model.name} from dropdowns`}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              {shownModels.length === 0 && (
                <p className="px-1.5 py-2 text-[10px] text-muted-foreground">
                  {query ? "No shown models match this search." : "No models from this endpoint are currently shown."}
                </p>
              )}
            </div>
          </div>

          <div className="rounded border border-border/70 p-2">
            <h5 className="mb-1 text-[10px] font-semibold">Available to add ({availableModels.length})</h5>
            <div className="max-h-56 space-y-1 overflow-y-auto" aria-label={`${ENDPOINT_LABELS[activeEndpoint]} models available to add`}>
              {availableModels.map((model) => (
                <div key={model.id} className="flex items-start gap-2 rounded px-1.5 py-1 hover:bg-muted/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{model.name}</span>
                    <code className="block truncate text-[10px] text-muted-foreground">{model.id}</code>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 px-2 text-[10px]"
                    onClick={() => setModelShown(model.id, true)}
                    disabled={saving}
                    aria-label={`Add ${model.name} to dropdowns`}
                  >
                    Add
                  </Button>
                </div>
              ))}
              {availableModels.length === 0 && (
                <p className="px-1.5 py-2 text-[10px] text-muted-foreground">
                  {query ? "No available models match this search." : "All available models are already shown."}
                </p>
              )}
            </div>
          </div>
        </div>

        {activeEndpoint === "openrouter" && endpointOptions.length === 0 && !loading && (
          <p className="text-[10px] text-muted-foreground">OpenRouter models appear after its API key is saved and the account catalog loads.</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2">
          <p className="text-[10px] text-muted-foreground" aria-live="polite">
            {hasChanges ? "Unsaved Model Pool changes" : "Model Pool saved"}
          </p>
          <Button type="button" size="sm" className="h-8 text-xs" onClick={onSave} disabled={!hasChanges || saving}>
            {saving ? "Saving Model Pool…" : "Save Model Pool"}
          </Button>
        </div>
      </section>
    </section>
  );
}
