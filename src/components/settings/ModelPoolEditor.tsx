import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  CAPABILITY_CHIP_LABELS,
  modelCapabilityChips,
  modelEndpointOf,
  modelPricingLabel,
  modelStructuredOutputSummary,
  SCALEDOWN_SUMMARIZE_CATALOG_MODEL,
  type AiCapabilityChip,
  type AiCatalogModel,
} from "@/lib/ai-model-catalog";
import {
  AI_MODEL_ENDPOINTS,
  modelInPool,
  normalizeAiModelPool,
  type AiModelEndpoint,
  type AiModelPool,
} from "@/lib/ai-model-options";

export type ModelPoolOption = AiCatalogModel & { id: string; name: string };

const ENDPOINT_LABELS: Record<AiModelEndpoint, string> = {
  openrouter: "OpenRouter",
  "google-direct": "Google AI (direct)",
  "meta-direct": "Meta AI (direct)",
  "scaledown-direct": "ScaleDown (direct)",
};

const BUILT_IN_DIRECT_MODELS: ModelPoolOption[] = [SCALEDOWN_SUMMARIZE_CATALOG_MODEL];

type EndpointFilter = "all" | AiModelEndpoint;
type CapabilityFilter = "all" | AiCapabilityChip;

function endpointModelIds(endpoint: AiModelEndpoint, models: ModelPoolOption[]): string[] {
  return models.filter((model) => modelEndpointOf(model.id) === endpoint).map((model) => model.id);
}

function endpointUsesAllModels(pool: AiModelPool, endpoint: AiModelEndpoint): boolean {
  return !Array.isArray(pool[endpoint]);
}

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
  const [endpointFilter, setEndpointFilter] = useState<EndpointFilter>("all");
  const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>("all");

  const catalog = useMemo(() => {
    const unique = new Map<string, ModelPoolOption>();
    for (const model of models) unique.set(model.id, model);
    for (const model of BUILT_IN_DIRECT_MODELS) {
      if (!unique.has(model.id)) unique.set(model.id, model);
    }
    return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [models]);

  const normalizedPool = useMemo(() => normalizeAiModelPool(pool), [pool]);
  const query = search.trim().toLowerCase();

  const filtered = catalog.filter((model) => {
    if (endpointFilter !== "all" && modelEndpointOf(model.id) !== endpointFilter) return false;
    if (capabilityFilter !== "all" && !modelCapabilityChips(model).includes(capabilityFilter)) return false;
    if (query && !`${model.name} ${model.id}`.toLowerCase().includes(query)) return false;
    return true;
  });

  const enabledCount = catalog.filter((model) => modelInPool(model.id, normalizedPool)).length;
  const anyAllMode = AI_MODEL_ENDPOINTS.some((endpoint) => endpointUsesAllModels(normalizedPool, endpoint));
  const anyCustomList = AI_MODEL_ENDPOINTS.some((endpoint) => Array.isArray(normalizedPool[endpoint]));

  function materializeEndpoint(endpoint: AiModelEndpoint, enabledIds: string[]) {
    onChange({ ...normalizedPool, [endpoint]: [...new Set(enabledIds)].sort() });
  }

  function setModelAvailable(modelId: string, available: boolean) {
    const endpoint = modelEndpointOf(modelId);
    const currentIds = endpointModelIds(endpoint, catalog);
    const base = endpointUsesAllModels(normalizedPool, endpoint)
      ? currentIds
      : (normalizedPool[endpoint] ?? []).filter((id) => currentIds.includes(id) || id === modelId);
    const nextIds = available
      ? [...new Set([...base, modelId])]
      : base.filter((id) => id !== modelId);
    materializeEndpoint(endpoint, nextIds);
  }

  function setFilteredAvailable(available: boolean) {
    const next = { ...normalizedPool };
    for (const endpoint of AI_MODEL_ENDPOINTS) {
      const endpointIds = endpointModelIds(endpoint, catalog);
      const changed = filtered.filter((model) => modelEndpointOf(model.id) === endpoint);
      if (changed.length === 0) continue;
      const base = endpointUsesAllModels(normalizedPool, endpoint)
        ? endpointIds
        : (normalizedPool[endpoint] ?? []).filter((id) => endpointIds.includes(id));
      const changedIds = new Set(changed.map((model) => model.id));
      const nextIds = available
        ? [...new Set([...base, ...changedIds])]
        : base.filter((id) => !changedIds.has(id));
      next[endpoint] = [...new Set(nextIds)].sort();
    }
    onChange(next);
  }

  function resetToAllModels() {
    const next: AiModelPool = { ...normalizedPool };
    for (const endpoint of AI_MODEL_ENDPOINTS) delete next[endpoint];
    onChange(next);
  }

  return (
    <section className="space-y-3 rounded-md border border-border p-3" aria-label="Available models">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold">Available models</h3>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Every model this app can reach, with the capabilities that matter here and OpenRouter pricing per 1M tokens.
            Google’s direct list loads live from Google when its API key is saved. Turn a model off to hide it from every AI dropdown. Save when done.
          </p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {enabledCount} of {catalog.length} available
          {anyAllMode ? " · all + future" : ""}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter models by endpoint">
        <Button
          type="button"
          size="sm"
          variant={endpointFilter === "all" ? "default" : "outline"}
          className="h-7 px-2 text-[10px]"
          onClick={() => setEndpointFilter("all")}
          disabled={saving}
        >
          All endpoints
        </Button>
        {AI_MODEL_ENDPOINTS.map((endpoint) => {
          const count = catalog.filter((model) => modelEndpointOf(model.id) === endpoint).length;
          return (
            <Button
              key={endpoint}
              type="button"
              size="sm"
              variant={endpointFilter === endpoint ? "default" : "outline"}
              className="h-7 px-2 text-[10px]"
              onClick={() => setEndpointFilter(endpoint)}
              disabled={saving}
            >
              {ENDPOINT_LABELS[endpoint]} ({count})
            </Button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or model id"
          className="h-8 max-w-xs text-xs"
          aria-label="Search available models"
          disabled={saving}
        />
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={capabilityFilter}
          onChange={(event) => setCapabilityFilter(event.target.value as CapabilityFilter)}
          disabled={saving}
          aria-label="Filter models by capability"
        >
          <option value="all">All capabilities</option>
          {(Object.keys(CAPABILITY_CHIP_LABELS) as AiCapabilityChip[]).map((chip) => (
            <option key={chip} value={chip}>{CAPABILITY_CHIP_LABELS[chip]}</option>
          ))}
        </select>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => setFilteredAvailable(true)} disabled={saving || filtered.length === 0}>
          Turn on shown
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => setFilteredAvailable(false)} disabled={saving || filtered.length === 0}>
          Turn off shown
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={resetToAllModels} disabled={saving || !anyCustomList}>
          Reset to all models
        </Button>
      </div>

      {loading && <p className="text-[10px] text-muted-foreground">Refreshing model catalogs…</p>}

      <div className="max-h-[28rem] overflow-y-auto rounded border border-border/70">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-muted/80 text-[10px] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Available</th>
              <th className="px-2 py-1.5 font-medium">Model</th>
              <th className="px-2 py-1.5 font-medium">Endpoint</th>
              <th className="px-2 py-1.5 font-medium">Capabilities</th>
              <th className="px-2 py-1.5 font-medium">Structured output</th>
              <th className="px-2 py-1.5 font-medium">Pricing / 1M tokens</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((model) => {
              const available = modelInPool(model.id, normalizedPool);
              const endpoint = modelEndpointOf(model.id);
              return (
                <tr key={model.id} className="border-t border-border/50 align-top hover:bg-muted/40">
                  <td className="px-2 py-1.5">
                    <Switch
                      checked={available}
                      onCheckedChange={(checked) => setModelAvailable(model.id, checked)}
                      disabled={saving}
                      aria-label={`${available ? "Disable" : "Enable"} ${model.name}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="block font-medium">{model.name}</span>
                    <code className="block text-[10px] text-muted-foreground">{model.id}</code>
                  </td>
                  <td className="px-2 py-1.5 text-[10px] text-muted-foreground">{ENDPOINT_LABELS[endpoint]}</td>
                  <td className="px-2 py-1.5">
                    <span className="flex flex-wrap gap-1">
                      {modelCapabilityChips(model).map((chip) => (
                        <Badge key={chip} variant="secondary" className="text-[9px]">{CAPABILITY_CHIP_LABELS[chip]}</Badge>
                      ))}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-[10px] text-muted-foreground">
                    {modelStructuredOutputSummary(model) || "plain text"}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[10px]">
                    {modelPricingLabel(model)}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-[10px] text-muted-foreground">
                  {loading ? "Loading models…" : "No models match these filters."}
                  {endpointFilter === "openrouter" && catalog.length <= BUILT_IN_DIRECT_MODELS.length && !loading
                    ? " OpenRouter models appear after its API key is saved."
                    : ""}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2">
        <p className="text-[10px] text-muted-foreground" aria-live="polite">
          {hasChanges ? "Unsaved availability changes" : "Model availability saved"}
          {anyAllMode ? " · new catalog models stay available until you customize a list" : ""}
        </p>
        <Button type="button" size="sm" className="h-8 text-xs" onClick={onSave} disabled={!hasChanges || saving}>
          {saving ? "Saving…" : "Save available models"}
        </Button>
      </div>
    </section>
  );
}
