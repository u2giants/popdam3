import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Database, BarChart3, AlertCircle, CheckCircle2, Clock, Zap, Bot } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function QualityDashboard() {
  const { call } = useAdminApi();
  const { data: stats, isLoading, refetch } = useQuery({
    queryKey: ["erp-stats"],
    queryFn: () => call("erp-enrichment-stats"),
  });

  const s = stats || {};

  return (
    <TooltipProvider delayDuration={200}>
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <CardTitle className="text-base flex items-center gap-2 cursor-help">
              <BarChart3 className="h-4 w-4" /> Enrichment Quality
            </CardTitle>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">Overview of how many ERP items have been classified and how many of your assets/groups they match</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh stats</TooltipContent>
        </Tooltip>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="ERP Items" value={s.total_erp_items ?? 0} icon={<Database className="h-4 w-4" />} tooltip="Total number of ColdLion product records available for enrichment" />
              <StatCard label="Has mgCategory" value={s.with_mg_category ?? 0} icon={<CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />} tooltip="ERP items where the ERP system itself provides a product category (mg_category field) — no AI needed" />
              <StatCard label="No mgCategory" value={(s.total_erp_items ?? 0) - (s.with_mg_category ?? 0)} icon={<Clock className="h-4 w-4 text-[hsl(var(--warning))]" />} tooltip="ERP items where the API did not provide an mgCategory value" />
              <StatCard label="Rule-Classified" value={s.rule_classified ?? 0} icon={<Zap className="h-4 w-4 text-primary" />} tooltip="Items whose product category was determined by deterministic code rules (e.g. 'Clock' items always map to the Clock category) — no AI call needed" />
              <StatCard label="AI-Classified" value={s.ai_classified ?? 0} icon={<Bot className="h-4 w-4 text-[hsl(var(--info))]" />} tooltip="Items where Claude AI looked at the description and MG codes and predicted a product category" />
              <StatCard label="Needs AI" value={s.needs_ai ?? 0} icon={<AlertCircle className="h-4 w-4 text-[hsl(var(--warning))]" />} tooltip="Items with no category yet that have a matching SKU in your asset library — eligible for AI classification. Run 'Classify Now' to process these." />
              <StatCard label="Pending Review" value={s.pending_review ?? 0} icon={<Clock className="h-4 w-4 text-[hsl(var(--warning))]" />} tooltip="AI predictions with confidence below 65% — Claude wasn't sure enough to auto-apply. These appear in the Review Queue for you to approve or reject." />
              <StatCard label="SKU Matched" value={s.sku_matched ?? 0} icon={<CheckCircle2 className="h-4 w-4" />} tooltip="ERP items whose style_number (SKU) exists in at least one asset or style group — these can actually be enriched" />
              <StatCard label="Unmatched SKUs" value={s.unmatched_skus ?? 0} icon={<AlertCircle className="h-4 w-4 text-destructive" />} tooltip="ERP items whose SKU doesn't match any asset or style group — enrichment has no effect on these until the assets are uploaded" />
              {(s.unresolved_mg_codes ?? 0) > 0 && (
                <StatCard label="Unresolved MG Codes" value={s.unresolved_mg_codes ?? 0} icon={<AlertCircle className="h-4 w-4 text-amber-500" />} tooltip="Items whose MG01 value couldn't be matched to a schema code — they re-process once the ColdLion data is corrected" />
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}

export function StatCard({ label, value, icon, tooltip }: { label: string; value: number; icon: React.ReactNode; tooltip?: string }) {
  const card = (
    <div className={`border border-border rounded-md p-3 space-y-1 ${tooltip ? "cursor-help" : ""}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold">{value.toLocaleString()}</div>
    </div>
  );
  if (!tooltip) return card;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{card}</TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

// ── Classification Live Log ───────────────────────────────────────────
