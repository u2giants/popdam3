import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { List } from "lucide-react";

export function ClassificationLiveLog({ active }: { active: boolean }) {
  const [entries, setEntries] = useState<Array<{
    id: string;
    external_id: string;
    predicted_category: string;
    confidence: number;
    status: string;
    style_number: string | null;
    description: string | null;
    created_at: string;
  }>>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const poll = async () => {
      // Only fetch meaningful recent classifications (not unclassifiable junk)
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("product_category_predictions")
        .select("id, external_id, predicted_category, confidence, status, created_at, input_context")
        .neq("status", "unclassifiable")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200);

      if (cancelled || !data) return;
      setEntries(prev => {
        // Only update if data actually changed (prevent scroll resets)
        const newIds = data.map((r: any) => r.id).join(",");
        const oldIds = prev.map(r => r.id).join(",");
        if (newIds === oldIds) return prev;
        return data.map((r: any) => ({
          id: r.id,
          external_id: r.external_id,
          predicted_category: r.predicted_category,
          confidence: r.confidence,
          status: r.status,
          style_number: r.input_context?.style_number ?? null,
          description: r.input_context?.item_description ?? null,
          created_at: r.created_at,
        }));
      });
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [active]);


  if (entries.length === 0) return null;

  const visible = expanded ? entries : entries.slice(0, 8);

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <List className="h-3 w-3" /> Recent Classifications ({entries.length})
        </p>
        {entries.length > 8 && (
          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Collapse" : `Show all ${entries.length}`}
          </Button>
        )}
      </div>
      <div className={`overflow-auto border border-border rounded-md bg-background/80 ${expanded ? "max-h-72" : "max-h-40"}`}>
        <div className="divide-y divide-border">
          {visible.map((e) => (
            <div key={e.id} className="px-2.5 py-1.5 text-[11px] font-mono flex items-start gap-3">
              <span className="shrink-0 w-14 text-muted-foreground">{new Date(e.created_at).toLocaleTimeString()}</span>
              <span className="shrink-0 font-semibold text-foreground w-28 truncate" title={e.style_number || e.external_id}>
                {e.style_number || e.external_id}
              </span>
              <span className="flex-1 text-muted-foreground truncate" title={e.description || ""}>
                {e.description || "—"}
              </span>
              <Badge
                variant={e.status === "unclassifiable" ? "outline" : e.status === "auto_applied" ? "default" : "secondary"}
                className="shrink-0 text-[10px] h-4 px-1.5"
              >
                {e.predicted_category}
              </Badge>
              <span className="shrink-0 w-8 text-right text-muted-foreground">
                {e.confidence > 0 ? `${Math.round(e.confidence * 100)}%` : "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Enrichment Apply Live Log ─────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  cover_description: "Description",
  product_category: "Category",
  mg01_code: "MG01",
  mg02_code: "MG02",
  mg03_code: "MG03",
  size_code: "Size",
  licensor_code: "Licensor",
  property_code: "Property",
  division_code: "Division",
};

interface EnrichmentLogEntry {
  id: string;
  target_type: string;
  target_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  confidence: number | null;
  run_id: string | null;
  applied_at: string;
}

export function EnrichmentApplyLiveLog({ active, startedAt }: { active: boolean; startedAt?: string }) {
  const [entries, setEntries] = useState<EnrichmentLogEntry[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!startedAt) return;
    let cancelled = false;

    const poll = async () => {
      const { data } = await supabase
        .from("erp_enrichment_log")
        .select("id, target_type, target_id, field_name, old_value, new_value, source, confidence, run_id, applied_at")
        .gte("applied_at", startedAt)
        .order("applied_at", { ascending: false })
        .limit(500);

      if (cancelled || !data) return;
      setEntries(prev => {
        const newIds = data.map((r: any) => r.id).join(",");
        const oldIds = prev.map(r => r.id).join(",");
        if (newIds === oldIds) return prev;
        return data as EnrichmentLogEntry[];
      });
    };

    poll();
    // Poll while active, stop polling once completed
    if (active) {
      const interval = setInterval(poll, 3000);
      return () => { cancelled = true; clearInterval(interval); };
    }
    return () => { cancelled = true; };
  }, [active, startedAt]);

  if (entries.length === 0) return null;

  // Group by run_id + target_id to show one row per SKU/target
  const byTarget = new Map<string, EnrichmentLogEntry[]>();
  for (const e of entries) {
    const k = `${e.run_id ?? ""}:${e.target_id}`;
    if (!byTarget.has(k)) byTarget.set(k, []);
    byTarget.get(k)!.push(e);
  }
  const targetRows = [...byTarget.entries()].slice(0, expanded ? undefined : 12);
  const totalTargets = byTarget.size;

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <List className="h-3 w-3" /> Enrichment Log ({entries.length} changes across {totalTargets} targets)
        </p>
        {totalTargets > 12 && (
          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Collapse" : `Show all ${totalTargets}`}
          </Button>
        )}
      </div>
      <div className={`overflow-auto border border-border rounded-md bg-background/80 ${expanded ? "max-h-80" : "max-h-48"}`}>
        <div className="divide-y divide-border">
          {targetRows.map(([key, fields]) => {
            const sample = fields[0];
            const fieldSummary = fields
              .map(f => {
                const label = FIELD_LABELS[f.field_name] || f.field_name;
                const arrow = f.old_value ? `${f.old_value}→${f.new_value}` : f.new_value;
                return `${label}: ${arrow}`;
              })
              .join(" · ");

            return (
              <div key={key} className="px-2.5 py-1.5 text-[11px] font-mono flex items-start gap-3">
                <span className="shrink-0 w-14 text-muted-foreground">
                  {new Date(sample.applied_at).toLocaleTimeString()}
                </span>
                <Badge variant="outline" className="shrink-0 text-[9px] h-4 px-1">
                  {sample.target_type === "asset" ? "AST" : sample.target_type === "style_group" ? "GRP" : "ERP"}
                </Badge>
                <span className="shrink-0 w-8 text-muted-foreground text-right">
                  {fields.length}f
                </span>
                <span className="flex-1 text-muted-foreground truncate" title={fieldSummary}>
                  {fieldSummary}
                </span>
                {sample.source && (
                  <Badge
                    variant={sample.source === "erp" ? "default" : "secondary"}
                    className="shrink-0 text-[9px] h-4 px-1"
                  >
                    {sample.source}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Enrichment Controls ──────────────────────────────────────────────
