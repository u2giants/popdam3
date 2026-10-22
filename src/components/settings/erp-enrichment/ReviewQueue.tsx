import { TruncatedCell } from "@/components/ui/truncated-cell";
import { useTableFilterSort, FilterableHeaderRow, type ColumnDef } from "@/components/ui/filterable-table-head";
import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, AlertCircle, Clock, ChevronLeft, ChevronRight, Undo2, X, Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function ReviewQueue() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("sample");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["erp-review-queue", statusFilter, page],
    queryFn: () => call("erp-review-queue", { status: statusFilter, page, page_size: 100 }),
  });

  const refreshQueue = async () => {
    const result = await refetch();
    if (result.isError) {
      toast.error(`Could not refresh the queue: ${result.error.message}`);
    } else {
      toast.success("Review queue refreshed");
    }
  };

  const items = data?.items || [];
  const totalPages = data?.total_pages ?? 1;
  const total = data?.total ?? 0;
  const statusCounts = data?.status_counts || {};

  const actionMutation = useMutation({
    mutationFn: (params: { id: string; action: string; category?: string }) =>
      call("erp-review-action", {
        prediction_id: params.id,
        review_action: params.action,
        override_category: params.category,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["erp-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["erp-items-browse"] });
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkRejectMutation = useMutation({
    mutationFn: (ids: string[]) =>
      call("erp-review-action", { review_action: "bulk-reject", prediction_ids: ids }),
    onSuccess: (_, ids) => {
      toast.success(`Rejected ${ids.length} predictions`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["erp-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["erp-items-browse"] });
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkDismissMutation = useMutation({
    mutationFn: (ids: string[]) =>
      call("erp-review-action", { review_action: "bulk-dismiss", prediction_ids: ids }),
    onSuccess: (_, ids) => {
      toast.success(`Dismissed ${ids.length} items — they will never be re-classified`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["erp-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["erp-items-browse"] });
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i: any) => i.id)));
    }
  };

  const isSample = statusFilter === "sample";

  const CATEGORIES = ["Wall", "Tabletop", "Clock", "Storage", "Workspace", "Floor", "Garden"];
  const STATUS_TABS = [
    { key: "sample", label: "Random 10", tooltip: "Review 10 randomly selected AI predictions, including auto-applied and approved items. Refresh draws another sample without changing any decisions." },
    { key: "pending", label: "Pending", tooltip: "AI predictions with 50–64% confidence — Claude had some doubt. Review and approve or reject each one." },
    { key: "low_confidence", label: "Low Confidence (<50%)", tooltip: "AI predictions where Claude was less than 50% confident — likely ambiguous or junk product descriptions. These will not be auto-applied." },
    { key: "auto_applied", label: "Auto-Applied", tooltip: "Predictions with ≥65% confidence that were automatically accepted — 'Apply Enrichment' will use these as the product_category. You can still revert them to Pending." },
    { key: "approved", label: "Approved", tooltip: "Predictions you manually approved (or overrode with a different category). These are treated the same as Auto-Applied." },
    { key: "rejected", label: "Rejected", tooltip: "Predictions you marked as wrong. The item can still be re-classified by running AI Classification again." },
    { key: "unclassifiable", label: "Unclassifiable", tooltip: "Items where the product description was too vague or nonsensical for the AI to classify — e.g. a description that is just a style number, or 'TEST'." },
  ];

  const canRevert = statusFilter === "auto_applied" || statusFilter === "approved";
  const canApprove = statusFilter === "pending";
  const canReject = statusFilter === "pending" || statusFilter === "auto_applied";

  const REVIEW_COLS: ColumnDef[] = [
    { key: "style", label: "Style #", sortable: true, filterable: true },
    { key: "description", label: "Description", sortable: true, filterable: true },
    { key: "predicted", label: "Predicted", sortable: true, filterable: true },
    { key: "confidence", label: "Confidence", sortable: true },
    { key: "rationale", label: "Rationale", filterable: true },
    { key: "actions", label: "Actions" },
  ];

  const getReviewCell = useCallback((item: any, key: string): string => {
    switch (key) {
      case "style": return item.style_number || item.external_id || "";
      case "description": return item.description || "";
      case "predicted": return item.predicted_category || "";
      case "confidence": return String(Math.round((item.confidence ?? 0) * 100));
      case "rationale": return item.rationale || "";
      default: return "";
    }
  }, []);

  const {
    processed: filteredItems,
    sortKey: reviewSortKey,
    sortDir: reviewSortDir,
    filters: reviewFilters,
    suggestions: reviewSuggestions,
    toggleSort: reviewToggleSort,
    setFilter: reviewSetFilter,
    clearFilter: reviewClearFilter,
    hasActiveFilters: reviewHasActiveFilters,
  } = useTableFilterSort(items, REVIEW_COLS, getReviewCell);

  return (
    <TooltipProvider delayDuration={200}>
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <CardTitle className="text-base flex items-center gap-2 cursor-help">
              <AlertCircle className="h-4 w-4" /> Review Queue
              <Badge variant="secondary" className="text-xs">{total}</Badge>
            </CardTitle>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">Review AI category decisions. Random 10 samples existing predictions; the other tabs show their review status. Refresh does not run AI Classification or change decisions.</TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && canReject && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1"
                    onClick={() => bulkRejectMutation.mutate([...selectedIds])}
                    disabled={bulkRejectMutation.isPending} title={bulkRejectMutation.isPending ? "Processing…" : undefined}
                  >
                    Reject {selectedIds.size}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reject these predictions — items can still be re-classified later</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="text-xs gap-1"
                    onClick={() => bulkDismissMutation.mutate([...selectedIds])}
                    disabled={bulkDismissMutation.isPending} title={bulkDismissMutation.isPending ? "Processing…" : undefined}
                  >
                    Dismiss {selectedIds.size}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Permanently dismiss — items will NEVER be re-classified</TooltipContent>
              </Tooltip>
            </>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh the queue"
                aria-busy={isFetching}
                disabled={isFetching}
                onClick={refreshQueue}
              >
                <RefreshCw className={`h-4 w-4${isFetching ? " animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isSample ? "Draw another random 10" : "Refresh the queue"}</TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isSample && (
          <p className="text-sm text-muted-foreground">
            A random sample of up to 10 existing AI judgements. Refresh draws another sample; approval status stays unchanged.
          </p>
        )}
        {/* Status tabs */}
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map((tab) => (
            <Tooltip key={tab.key}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={statusFilter === tab.key ? "default" : "outline"}
                  className="text-xs h-7 gap-1"
                  onClick={() => { setStatusFilter(tab.key); setPage(1); setSelectedIds(new Set()); }}
                >
                  {tab.label}
                  {typeof statusCounts[tab.key] === "number" && (
                    <span className="text-[10px] opacity-70">({statusCounts[tab.key]})</span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">{tab.tooltip}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            Could not load the review queue: {error.message}. Try refreshing again.
          </p>
        )}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : error && !data ? null : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items in this status.</p>
        ) : (
          <div className="overflow-x-auto border border-border rounded-md">
              <table className="w-full caption-bottom text-sm" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  {(canReject || canRevert) && <col style={{ width: 40 }} />}
                  <col style={{ width: 130 }} />
                  <col />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 80 }} />
                  <col />
                  <col style={{ width: isSample ? 230 : 140 }} />
                </colgroup>
                <thead className="[&_tr]:border-b">
                  <FilterableHeaderRow
                    columns={REVIEW_COLS}
                    sortKey={reviewSortKey}
                    sortDir={reviewSortDir}
                    filters={reviewFilters}
                    suggestions={reviewSuggestions}
                    onSort={reviewToggleSort}
                    onFilter={reviewSetFilter}
                    onClearFilter={reviewClearFilter}
                    prefixCells={(canReject || canRevert) ? [{
                      header: (
                        <input
                          type="checkbox"
                          checked={selectedIds.size === filteredItems.length && filteredItems.length > 0}
                          onChange={toggleAll}
                          className="rounded"
                        />
                      ),
                      filter: null,
                    }] : undefined}
                  />
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {filteredItems.map((item: any) => {
                    const itemCanApprove = isSample ? item.status === "pending" : canApprove;
                    const itemCanReject = isSample ? ["pending", "auto_applied"].includes(item.status) : canReject;
                    const itemCanRevert = isSample ? ["auto_applied", "approved"].includes(item.status) : canRevert;
                    return (
                    <tr key={item.id} className="border-b transition-colors hover:bg-muted/50">
                      {(canReject || canRevert) && (
                        <td className="p-2 align-middle w-10">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleSelect(item.id)}
                            className="rounded"
                          />
                        </td>
                      )}
                      <td className="p-2 align-middle text-xs font-mono overflow-hidden">
                        <TruncatedCell>{item.style_number || item.external_id || "—"}</TruncatedCell>
                      </td>
                      <td className="p-2 align-middle text-xs overflow-hidden">
                        <TruncatedCell>{item.description || "—"}</TruncatedCell>
                      </td>
                      <td className="p-2 align-middle overflow-hidden">
                        <Badge variant="outline" className="text-xs">{item.predicted_category}</Badge>
                        {isSample && <span className="block text-[10px] text-muted-foreground mt-1">{item.status.replaceAll("_", " ")}</span>}
                      </td>
                      <td className="p-2 align-middle text-xs overflow-hidden">
                        <span className={item.confidence < 0.5 ? "text-destructive" : item.confidence < 0.65 ? "text-[hsl(var(--warning))]" : "text-foreground"}>
                          {(item.confidence * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="p-2 align-middle text-xs overflow-hidden">
                        <TruncatedCell className="text-muted-foreground" tooltipText={item.rationale || "No rationale provided"}>
                          {item.rationale || "—"}
                        </TruncatedCell>
                      </td>
                      <td className="p-2 align-middle overflow-hidden">
                        <div className="flex items-center gap-1">
                          {itemCanApprove && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0 text-[hsl(var(--success))]"
                                  onClick={() => actionMutation.mutate({ id: item.id, action: "approve" })}
                                  disabled={actionMutation.isPending} title={actionMutation.isPending ? "Processing…" : undefined}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Approve this prediction as correct</TooltipContent>
                            </Tooltip>
                          )}
                          {(itemCanApprove || itemCanRevert) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <select
                                  className="h-6 text-xs bg-muted border border-border rounded px-1"
                                  defaultValue=""
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      actionMutation.mutate({ id: item.id, action: "approve", category: e.target.value });
                                      e.target.value = "";
                                    }
                                  }}
                                >
                                  <option value="" disabled>Override…</option>
                                  {CATEGORIES.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                  ))}
                                </select>
                              </TooltipTrigger>
                              <TooltipContent>Approve with a different category (overrides the AI prediction)</TooltipContent>
                            </Tooltip>
                          )}
                          {itemCanReject && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0 text-destructive"
                                  onClick={() => actionMutation.mutate({ id: item.id, action: "reject" })}
                                  disabled={actionMutation.isPending} title={actionMutation.isPending ? "Processing…" : undefined}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Reject this prediction (can be re-classified later). Use "Dismiss" to permanently exclude.</TooltipContent>
                            </Tooltip>
                          )}
                          {itemCanRevert && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-xs text-[hsl(var(--warning))] gap-1"
                                  onClick={() => actionMutation.mutate({ id: item.id, action: "revert" })}
                                  disabled={actionMutation.isPending} title={actionMutation.isPending ? "Processing…" : undefined}
                                >
                                  <Undo2 className="h-3 w-3" /> Undo
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Move back to Pending for re-review (undoes auto-apply or approval)</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages} ({total} items)
            </span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7" disabled={page <= 1} title={page <= 1 ? "Already on the first page" : undefined} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="outline" className="h-7" disabled={page >= totalPages} title={page >= totalPages ? "Already on the last page" : undefined} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}
