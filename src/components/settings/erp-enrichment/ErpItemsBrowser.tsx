import React, { useState, useCallback } from "react";
import { getMg01Desc, getMg02Desc, getMg03Desc } from "@/lib/mg-lookup";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { RefreshCw, Clock, Loader2, Eye, Search, ChevronLeft, ChevronRight, List, X, Check, EyeOff } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


// ── ERP Items Browser ────────────────────────────────────────────────

const ALL_CATEGORIES = ["Wall", "Tabletop", "Clock", "Storage", "Workspace", "Floor", "Garden", "Other"] as const;
type Category = typeof ALL_CATEGORIES[number];

const CATEGORY_BADGE: Record<string, string> = {
  Wall: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  Tabletop: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  Clock: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  Storage: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  Workspace: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  Floor: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  Garden: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  Other: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

export function ErpItemsBrowser() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [sortBy, setSortBy] = useState("prediction_confidence");
  const [sortAsc, setSortAsc] = useState(true);
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [showDismissed, setShowDismissed] = useState(false);
  const [selectedPredIds, setSelectedPredIds] = useState<Set<string>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(1);
    clearTimeout((window as any).__erpSearchTimer);
    (window as any).__erpSearchTimer = setTimeout(() => setDebouncedSearch(val), 400);
  };

  const effectiveSortBy = groupByCategory ? "category_then_confidence" : sortBy;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["erp-items-browse", debouncedSearch, page, pageSize, effectiveSortBy, sortAsc, pendingOnly, showDismissed],
    queryFn: () => call("erp-items-browse", {
      search: debouncedSearch,
      page,
      page_size: pageSize,
      sort_by: effectiveSortBy,
      sort_asc: sortAsc,
      pending_predictions_only: pendingOnly,
      show_dismissed: showDismissed,
    }),
  });

  const items: any[] = data?.items || [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;

  const reviewMutation = useMutation({
    mutationFn: (params: { action: "approve" | "reject"; prediction_id: string; override_category?: string }) =>
      call("erp-review-action", {
        review_action: params.action,
        prediction_id: params.prediction_id,
        ...(params.override_category ? { override_category: params.override_category } : {}),
      }),
    onSuccess: (_, params) => {
      toast.success(params.action === "approve" ? "Approved" : "Rejected");
      setOverrides((prev) => { const next = { ...prev }; delete next[params.prediction_id]; return next; });
      queryClient.invalidateQueries({ queryKey: ["erp-items-browse"] });
      queryClient.invalidateQueries({ queryKey: ["erp-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const bulkMutation = useMutation({
    mutationFn: (params: { action: "bulk-approve" | "bulk-reject"; prediction_ids: string[] }) =>
      call("erp-review-action", { review_action: params.action, prediction_ids: params.prediction_ids }),
    onSuccess: (_, params) => {
      const n = params.prediction_ids.length;
      toast.success(params.action === "bulk-approve" ? `Approved ${n} items` : `Rejected ${n} items`);
      setSelectedPredIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["erp-items-browse"] });
      queryClient.invalidateQueries({ queryKey: ["erp-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const dismissMutation = useMutation({
    mutationFn: (params: { item_identity: string; dismiss: boolean }) =>
      call("erp-items-dismiss", { ids: [params.item_identity], dismiss: params.dismiss }),
    onSuccess: (_, params) => {
      toast.success(params.dismiss ? "Item dismissed" : "Item restored");
      queryClient.invalidateQueries({ queryKey: ["erp-items-browse"] });
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const handleSort = (col: string) => {
    if (sortBy === col) setSortAsc(!sortAsc);
    else { setSortBy(col); setSortAsc(col === "prediction_confidence"); }
    setPage(1);
  };

  const handleRowCheck = useCallback((predId: string, idx: number, e: React.MouseEvent<HTMLInputElement>) => {
    e.stopPropagation();
    setSelectedPredIds((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedIdx !== null) {
        const start = Math.min(lastClickedIdx, idx);
        const end = Math.max(lastClickedIdx, idx);
        for (let i = start; i <= end; i++) {
          const pid = items[i]?.prediction_id;
          if (pid) next.add(pid);
        }
      } else {
        if (next.has(predId)) next.delete(predId); else next.add(predId);
      }
      return next;
    });
    setLastClickedIdx(idx);
  }, [items, lastClickedIdx]);

  const eligibleItems = items.filter((i: any) => i.prediction_id);
  const toggleAll = () => {
    if (selectedPredIds.size === eligibleItems.length && eligibleItems.length > 0) {
      setSelectedPredIds(new Set());
    } else {
      setSelectedPredIds(new Set(eligibleItems.map((i: any) => i.prediction_id)));
    }
  };

  const renderMgCell = (code: string | null, desc: string | null, rawApiValue?: string | null) => {
    const effectiveCode = code && code.length === 1 ? code : null;
    const effectiveRaw = rawApiValue || (code && code.length > 1 ? code : null);
    if (!effectiveCode && !effectiveRaw) return <span className="text-muted-foreground/40">—</span>;
    if (!effectiveCode && effectiveRaw) return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help text-amber-600 dark:text-amber-400 text-xs">{effectiveRaw}</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">Unmatched in MG schema</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help text-xs">{desc || effectiveCode}</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">Code: {effectiveCode}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const SortTh = ({ col, label, className }: { col: string; label: string; className?: string }) => (
    <th
      className={`h-10 px-3 text-left align-middle font-medium text-muted-foreground text-xs cursor-pointer hover:text-foreground select-none whitespace-nowrap ${className ?? ""}`}
      onClick={() => handleSort(col)}
    >
      {label}{sortBy === col && <span className="ml-1">{sortAsc ? "↑" : "↓"}</span>}
    </th>
  );

  return (
    <Card className="max-w-none">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <List className="h-4 w-4" /> ERP Items Browser
          <Badge variant="secondary" className="text-xs font-mono">{total.toLocaleString()}</Badge>
        </CardTitle>
        <div className="flex items-center gap-2">
          {selectedPredIds.size > 0 && (
            <>
              <Button size="sm" variant="outline"
                className="text-xs gap-1 border-green-500 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20"
                onClick={() => bulkMutation.mutate({ action: "bulk-approve", prediction_ids: [...selectedPredIds] })}
                disabled={bulkMutation.isPending}
              >
                <Check className="h-3.5 w-3.5" /> Approve {selectedPredIds.size}
              </Button>
              <Button size="sm" variant="destructive" className="text-xs gap-1"
                onClick={() => bulkMutation.mutate({ action: "bulk-reject", prediction_ids: [...selectedPredIds] })}
                disabled={bulkMutation.isPending}
              >
                <X className="h-3.5 w-3.5" /> Reject {selectedPredIds.size}
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by style # or description..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={pendingOnly}
              onChange={(e) => { setPendingOnly(e.target.checked); setPage(1); setSelectedPredIds(new Set()); }}
              className="rounded"
            />
            Pending review only
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={showDismissed}
              onChange={(e) => { setShowDismissed(e.target.checked); setPage(1); }}
              className="rounded"
            />
            Show dismissed
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={groupByCategory}
              onChange={(e) => { setGroupByCategory(e.target.checked); setPage(1); }}
              className="rounded"
            />
            Group by category
          </label>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No items found.</p>
        ) : (
          <>
            <div className="overflow-x-auto border border-border rounded-md">
              <table className="w-full table-fixed caption-bottom text-sm">
                <colgroup>
                  <col className="w-10" />
                  <col className="w-[140px]" />
                  <col />{/* description — takes all remaining space */}
                  <col className="w-[140px]" />
                  <col className="w-[60px]" />
                  <col className="w-[90px]" />
                  <col className="w-[90px]" />
                  <col className="w-[90px]" />
                  <col className="w-[80px]" />
                </colgroup>
                <thead className="[&_tr]:border-b">
                  <tr className="border-b">
                    <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                      <input type="checkbox"
                        checked={selectedPredIds.size === eligibleItems.length && eligibleItems.length > 0}
                        onChange={toggleAll} className="rounded"
                      />
                    </th>
                    <SortTh col="style_number" label="Style #" />
                    <SortTh col="item_description" label="Description" />
                    <SortTh col="predicted_category" label="AI Category" />
                    <SortTh col="prediction_confidence" label="Conf" />
                    <SortTh col="mg01_code" label="MG01" />
                    <SortTh col="mg02_code" label="MG02" />
                    <SortTh col="mg03_code" label="MG03" />
                    <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground text-xs">Actions</th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {(() => {
                    const rows: React.ReactNode[] = [];
                    let lastCat: string | null = null;
                    items.forEach((item: any, idx: number) => {
                      const hasPred = !!item.prediction_id;
                      const effectiveCat = overrides[item.prediction_id] ?? item.predicted_category ?? null;
                      const confPct = hasPred ? Math.round((item.prediction_confidence ?? 0) * 100) : null;
                      const confColor = confPct === null ? "" : confPct >= 85 ? "text-green-600 dark:text-green-400" : confPct >= 65 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";
                      const isOverridden = hasPred && !!overrides[item.prediction_id];

                      if (groupByCategory && effectiveCat !== lastCat) {
                        lastCat = effectiveCat;
                        const badgeClass = effectiveCat ? (CATEGORY_BADGE[effectiveCat] ?? "bg-gray-100 text-gray-700") : "bg-muted text-muted-foreground";
                        rows.push(
                          <tr key={`group-${effectiveCat}-${idx}`} className="border-b bg-muted/40">
                            <td colSpan={9} className="px-3 py-1.5">
                              <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>
                                {effectiveCat ?? "No prediction"}
                              </span>
                            </td>
                          </tr>
                        );
                      }

                      rows.push(
                        <tr key={item.id || item.external_id}
                          className={`border-b transition-colors hover:bg-muted/50 ${selectedPredIds.has(item.prediction_id) ? "bg-primary/10" : ""}`}
                        >
                          <td className="px-3 py-2 align-top w-10">
                            {hasPred && (
                              <input type="checkbox" checked={selectedPredIds.has(item.prediction_id)}
                                onClick={(e) => handleRowCheck(item.prediction_id, idx, e as unknown as React.MouseEvent<HTMLInputElement>)}
                                readOnly className="rounded cursor-pointer mt-0.5"
                              />
                            )}
                          </td>
                          <td className="px-3 py-2 align-top text-xs font-mono whitespace-nowrap">{item.style_number ?? "—"}</td>
                          <td className="px-3 py-2 align-top text-xs whitespace-normal break-words leading-snug">
                            {item.item_description ?? <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {hasPred ? (
                              <div className="flex flex-col gap-0.5">
                                <select
                                  value={effectiveCat ?? ""}
                                  onChange={(e) => setOverrides((prev) => ({ ...prev, [item.prediction_id]: e.target.value }))}
                                  className={`rounded px-1.5 py-0.5 text-xs font-medium border-0 cursor-pointer focus:ring-1 focus:ring-primary ${CATEGORY_BADGE[effectiveCat ?? ""] ?? "bg-gray-100 text-gray-700"}`}
                                >
                                  {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                                {isOverridden && (
                                  <span className="text-[10px] text-muted-foreground line-through">{item.predicted_category}</span>
                                )}
                              </div>
                            ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                          </td>
                          <td className={`px-3 py-2 align-top text-xs font-medium tabular-nums ${confColor}`}>
                            {hasPred ? (
                              <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help">{confPct}%</span>
                                  </TooltipTrigger>
                                  {item.prediction_rationale && (
                                    <TooltipContent side="top" className="max-w-xs text-xs whitespace-normal">
                                      {item.prediction_rationale}
                                    </TooltipContent>
                                  )}
                                </Tooltip>
                              </TooltipProvider>
                            ) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {renderMgCell(item.mg01_code, getMg01Desc(item.mg01_code), item.raw_mg_fields?.mg01)}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {renderMgCell(item.mg02_code, getMg02Desc(item.mg01_code, item.mg02_code), item.raw_mg_fields?.mg02)}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {renderMgCell(item.mg03_code, getMg03Desc(item.mg01_code, item.mg02_code, item.mg03_code), item.raw_mg_fields?.mg03)}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex items-center gap-1">
                              {hasPred && (
                                <>
                                <Button size="icon" variant="ghost"
                                  className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                                  onClick={() => reviewMutation.mutate({ action: "approve", prediction_id: item.prediction_id, override_category: overrides[item.prediction_id] })}
                                  disabled={reviewMutation.isPending} title="Approve"
                                >
                                  <Check className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost"
                                  className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                                  onClick={() => reviewMutation.mutate({ action: "reject", prediction_id: item.prediction_id })}
                                  disabled={reviewMutation.isPending} title="Reject"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                                </>
                              )}
                              <Button size="icon" variant="ghost"
                                className="h-7 w-7"
                                onClick={() => dismissMutation.mutate({ item_identity: item.item_identity, dismiss: !item.dismissed })}
                                disabled={dismissMutation.isPending || !item.item_identity}
                                title={item.dismissed ? "Restore item" : "Dismiss item"}
                              >
                                {item.dismissed ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    });
                    return rows;
                  })()}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2">Page {page} of {totalPages}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
