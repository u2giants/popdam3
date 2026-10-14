import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { AI_MODEL_ENDPOINTS, aiModelEndpoint, type AiModelEndpoint, type AiModelPool } from "@/lib/ai-model-options";

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

const BUILT_IN_DIRECT_MODELS: ModelPoolOption[] = [
  { id: "google-direct/gemini-3.8-flash:batch", name: "Google Gemini 3.8 Flash Batch" },
  { id: "meta-direct/muse-spark-1.3-contributor", name: "Meta Muse Spark 1.3 Contributor" },
  { id: "scaledown/summarize", name: "ScaleDown: Summarize (direct API; bake-off only)" },
];

export function ModelPoolEditor({
  models,
  pool,
  onChange,
  loading,
}: {
  models: ModelPoolOption[];
  pool: AiModelPool;
  onChange: (next: AiModelPool) => void;
  loading: boolean;
}) {
  const [search, setSearch] = useState("");
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
    })).filter((group) => group.options.length > 0);
  }, [models]);
  const query = search.trim().toLowerCase();

  function selectedIds(endpoint: AiModelEndpoint, ids: string[]) {
    return pool[endpoint] ?? ids;
  }

  function updateEndpoint(endpoint: AiModelEndpoint, ids: string[]) {
    onChange({ ...pool, [endpoint]: [...new Set(ids)].sort() });
  }

  return (
    <section className="space-y-2 rounded-md border border-border p-3" aria-label="Model Pool">
      <div>
        <h3 className="text-xs font-semibold">Model Pool</h3>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Choose which models appear in PopDAM model dropdowns. This only controls visibility; it does not change saved model selections.
        </p>
      </div>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search model names or IDs"
        className="h-8 text-xs"
        aria-label="Search models in Model Pool"
      />
      {loading && <p className="text-[10px] text-muted-foreground">Loading available models…</p>}
      <div className="space-y-1">
        {groups.map(({ endpoint, options }) => {
          const matching = query
            ? options.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query))
            : options;
          const checked = selectedIds(endpoint, options.map((model) => model.id));
          const selectedCount = options.filter((model) => checked.includes(model.id)).length;
          if (query && matching.length === 0) return null;
          return (
            <details key={endpoint} className="group rounded border border-border/70" open={query.length > 0 || undefined}>
              <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-xs">
                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                <span className="flex-1 font-medium">{ENDPOINT_LABELS[endpoint]}</span>
                <Badge variant="outline" className="text-[10px]">{selectedCount}/{options.length}</Badge>
              </summary>
              <div className="space-y-1 border-t border-border/70 p-2">
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => updateEndpoint(endpoint, [...checked, ...options.map((model) => model.id)])}>
                    Show all
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => updateEndpoint(endpoint, [])}>
                    Hide all
                  </Button>
                </div>
                <div className="max-h-56 space-y-1 overflow-y-auto" role="group" aria-label={`${ENDPOINT_LABELS[endpoint]} models`}>
                  {matching.map((model) => {
                    const isChecked = checked.includes(model.id);
                    return (
                      <label key={model.id} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-muted/60">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={(value) => updateEndpoint(endpoint, value === true
                            ? [...checked, model.id]
                            : checked.filter((id) => id !== model.id))}
                          className="mt-0.5"
                          aria-label={`Show ${model.name} in dropdowns`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{model.name}</span>
                          <code className="block truncate text-[10px] text-muted-foreground">{model.id}</code>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </details>
          );
        })}
      </div>
      {groups.length === 0 && !loading && (
        <p className="text-[10px] text-muted-foreground">No model catalog is available yet. Save an API key and refresh the model list.</p>
      )}
    </section>
  );
}
