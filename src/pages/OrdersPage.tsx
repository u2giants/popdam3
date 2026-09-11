import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CellValueChangedEvent, IDatasource } from "ag-grid-community";
import type { AgGridReact } from "ag-grid-react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import {
  OrderEditorDialog,
  type OrderEditorMode,
  type OrderVoidRequest,
} from "@/components/orders/OrderEditorDialog";
import { MasterDataLinkDialog } from "@/components/orders/MasterDataLinkDialog";
import { OrderListGrid } from "@/components/orders/OrderListGrid";
import { GridAiHelperDialog, type GridAiPlan } from "@/components/grid/GridAiHelperDialog";
import { OrderListSummary } from "@/components/orders/OrderListSummary";
import { OrderListViewsMenu } from "@/components/orders/OrderListViewsMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useDamCustomers } from "@/hooks/useDamCustomers";
import {
  fetchOrderListBlock,
  findOrderListRow,
  useCreateOrder,
  useOrderListLinkCandidates,
  useOrderListSavedViews,
  useOrderListStatusCounts,
  useRelinkOrderLine,
  useUpdateOrder,
} from "@/hooks/useOrderList";
import { IS_NON_PRODUCTION_DATABASE, POPDAM_SUPABASE_PROJECT_REF } from "@/lib/app-mode";
import { supabase } from "@/integrations/supabase/client";
import { buildOrderListEdit, ORDER_LIST_COLUMNS } from "@/lib/order-list";
import type { OrderListRow, OrderListSavedView } from "@/types/order-list";

export default function OrdersPage() {
  const { user, loading: authLoading } = useAuth();
  const gridRef = useRef<AgGridReact<OrderListRow>>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: OrderEditorMode; row: OrderListRow | null } | null>(null);
  const [relinkRow, setRelinkRow] = useState<OrderListRow | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [filteredCount, setFilteredCount] = useState<number | null>(null);
  const [selectedRows, setSelectedRows] = useState<OrderListRow[]>([]);
  const [hasLoadedRows, setHasLoadedRows] = useState(false);
  const [summaryCountsEnabled, setSummaryCountsEnabled] = useState(false);

  const authReady = Boolean(user) && !authLoading;
  const savedViewsQuery = useOrderListSavedViews(user?.id);
  const candidatesQuery = useOrderListLinkCandidates(relinkRow);
  // Let the customer-visible block load before starting four whole-list counts.
  const statusCountsQuery = useOrderListStatusCounts(authReady && summaryCountsEnabled);
  const customersQuery = useDamCustomers();

  /** Reloads the rows the grid is showing, without re-reading the whole list. */
  const refreshRows = useCallback(() => {
    gridRef.current?.api?.refreshInfiniteCache();
  }, []);

  const updateOrder = useUpdateOrder(refreshRows);
  const createOrder = useCreateOrder(refreshRows);
  const relinkLine = useRelinkOrderLine(refreshRows);

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const focusGridSearch = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", focusGridSearch);
    return () => window.removeEventListener("keydown", focusGridSearch);
  }, []);

  const datasource = useMemo<IDatasource>(
    () => ({
      getRows: async (params) => {
        try {
          const block = await fetchOrderListBlock({
            startRow: params.startRow,
            endRow: params.endRow,
            sortModel: params.sortModel as Array<{ colId: string; sort: string }>,
            filterModel: params.filterModel as Record<string, unknown>,
            search: "",
          });
          setLoadError(null);
          setHasLoadedRows(true);
          setFilteredCount(block.totalRowCount);
          // A short block proves the exact end. Otherwise the grid keeps paging
          // without making the visible rows wait for a whole-list exact count.
          const lastRow = block.rows.length < params.endRow - params.startRow
            ? params.startRow + block.rows.length
            : undefined;
          params.successCallback(block.rows, lastRow);
        } catch (error) {
          // Never fail silently: the grid shows nothing, so say why.
          setLoadError((error as Error)?.message ?? "unknown error");
          params.failCallback();
        }
      },
    }),
    [],
  );

  useEffect(() => {
    gridRef.current?.api?.setGridOption("datasource", datasource);
  }, [datasource]);

  useEffect(() => {
    if (!hasLoadedRows) return;
    const timer = window.setTimeout(() => setSummaryCountsEnabled(true), 2_000);
    return () => window.clearTimeout(timer);
  }, [hasLoadedRows]);

  useEffect(() => {
    const term = search.trim();
    if (!term) {
      setHighlightedRowId(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const api = gridRef.current?.api;
      if (!api) return;
      try {
        const match = await findOrderListRow({
          search: term,
          filterModel: api.getFilterModel(),
          sortModel: api.getColumnState().filter((column) => column.sort).map((column) => ({ colId: column.colId, sort: column.sort! })),
        });
        if (cancelled) return;
        if (!match) {
          setHighlightedRowId(null);
          toast.info(`No OrderList row contains "${term}"`);
          return;
        }
        setHighlightedRowId(match.row.order_line_id);
        const pageSize = api.paginationGetPageSize();
        api.paginationGoToPage(Math.floor(match.index / pageSize));
        window.requestAnimationFrame(() => api.ensureIndexVisible(match.index, "middle"));
      } catch (error) {
        if (cancelled) return;
        toast.error((error as Error).message);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  const counts = useMemo(
    () => ({
      total: statusCountsQuery.data?.total ?? 0,
      filtered: filteredCount ?? statusCountsQuery.data?.total ?? 0,
      linked: statusCountsQuery.data?.linked ?? 0,
      ambiguous: statusCountsQuery.data?.ambiguous ?? 0,
      unmatched: statusCountsQuery.data?.unmatched ?? 0,
    }),
    [filteredCount, statusCountsQuery.data],
  );

  const handleCellEdited = useCallback(
    (event: CellValueChangedEvent<OrderListRow>) => {
      if (!event.data || event.oldValue === event.newValue) return;
      const field = event.colDef.colId ?? event.colDef.field;
      if (!field) return;
      let edit;
      try {
        edit = buildOrderListEdit(event.data, field, event.newValue);
      } catch (error) {
        toast.error((error as Error).message);
        refreshRows();
        return;
      }
      updateOrder.mutate({
        p_order_id: edit.orderId,
        p_order_patch: edit.orderPatch,
        p_line_patches: Object.keys(edit.linePatch).length > 0 ? [{ id: edit.orderLineId, ...edit.linePatch }] : [],
      });
    },
    [refreshRows, updateOrder],
  );

  const handleEditOrder = useCallback((row: OrderListRow) => {
    setEditor({ mode: "edit", row });
  }, []);

  const applyAiBulkEdit = async (plan: GridAiPlan) => {
    if (!selectedRows.length) throw new Error("Select the rows to update first.");
    for (let index = 0; index < selectedRows.length; index += 8) {
      await Promise.all(selectedRows.slice(index, index + 8).map(async (row) => {
        const edit = buildOrderListEdit(row, plan.field, plan.value);
        const { error } = await (supabase.rpc as any)("update_dam_order", {
          p_order_id: edit.orderId,
          p_order_patch: edit.orderPatch,
          p_line_patches: Object.keys(edit.linePatch).length ? [{ id: edit.orderLineId, ...edit.linePatch }] : [],
        });
        if (error) throw error;
      }));
    }
    refreshRows();
    setSelectedRows([]);
  };


  /**
   * Void or restore. There is deliberately no delete RPC, so a correction stamps
   * `voided_at` and keeps the record; `api.dam_order_list` still returns it, and
   * the grid renders it struck through.
   */
  const handleSetVoided = useCallback(
    (request: OrderVoidRequest) => {
      if (!editor?.row) return;
      updateOrder.mutate(
        {
          p_order_id: editor.row.order_id,
          p_order_patch: { voided: request.voided, void_reason: request.void_reason },
          p_line_patches: [],
        },
        { onSuccess: () => setEditor(null) },
      );
    },
    [editor, updateOrder],
  );

  const handleSaveView = useCallback(
    async (name: string) => {
      const api = gridRef.current?.api;
      if (!api || !user?.id) return;
      const payload = {
        user_id: user.id,
        view_name: name,
        column_state: api.getColumnState(),
        filter_model: api.getFilterModel(),
        sort_model: api.getColumnState().filter((state) => state.sort),
      };
      const { error } = await (supabase as any)
        .from("order_list_user_views")
        .upsert(payload, { onConflict: "user_id,view_name" });
      if (error) {
        toast.error(`Could not save the view: ${error.message}`);
        return;
      }
      toast.success(`Saved view "${name}"`);
      void savedViewsQuery.refetch();
    },
    [savedViewsQuery, user?.id],
  );

  const handleApplyView = useCallback((view: OrderListSavedView) => {
    const api = gridRef.current?.api;
    if (!api) return;
    if (Array.isArray(view.column_state)) {
      api.applyColumnState({ state: view.column_state as any, applyOrder: true });
    }
    api.setFilterModel((view.filter_model ?? null) as any);
    setActiveViewId(view.id);
  }, []);

  const handleDeleteView = useCallback(
    async (view: OrderListSavedView) => {
      const { error } = await (supabase as any).from("order_list_user_views").delete().eq("id", view.id);
      if (error) {
        toast.error(`Could not delete the view: ${error.message}`);
        return;
      }
      if (activeViewId === view.id) setActiveViewId(null);
      void savedViewsQuery.refetch();
    },
    [activeViewId, savedViewsQuery],
  );

  return (
    // Same full-height strategy as Master Data: the layout's <main> only grows to
    // fit content, so the grid needs an explicit viewport-minus-header height.
    <div className="flex h-[calc(100vh-var(--pd-header-h))] flex-col bg-background">
      {IS_NON_PRODUCTION_DATABASE && (
        <div className="border-b border-amber-500/50 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
          Connected to a non-production database ({POPDAM_SUPABASE_PROJECT_REF}). Edits here do not touch production.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <h1 className="mr-2 text-base font-semibold">OrderList</h1>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find in orders (Ctrl+F)"
            aria-label="Find in orders"
            className="h-8 w-56 pl-7 text-xs"
          />
        </div>

        <GridAiHelperDialog pageName="OrderList" selectedRowCount={selectedRows.length} fields={ORDER_LIST_COLUMNS.filter((column) => column.editable).map((column) => ({ key: column.field, label: column.header }))} onApply={applyAiBulkEdit} />

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => {
            const api = gridRef.current?.api;
            if (!api) return;
            // The side bar starts hidden, so it has to be shown before opening.
            const open = api.isToolPanelShowing();
            api.setSideBarVisible(!open);
            if (!open) api.openToolPanel("columns");
          }}
        >
          Columns
        </Button>

        <OrderListViewsMenu
          views={savedViewsQuery.data ?? []}
          activeViewId={activeViewId}
          onApply={handleApplyView}
          onSave={handleSaveView}
          onDelete={handleDeleteView}
        />

        <Button type="button" size="sm" variant="outline" className="h-8" onClick={refreshRows}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Refresh
        </Button>

        <Button type="button" size="sm" className="h-8" onClick={() => setEditor({ mode: "create", row: null })}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          New order
        </Button>

        <div className="ml-auto">
          <OrderListSummary counts={counts} />
        </div>
      </div>

      {loadError && (
        <div className="border-b border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          Could not load OrderList: {loadError}
        </div>
      )}

      <div className="min-h-0 flex-1 p-3">
        <div className="h-full min-h-0 overflow-hidden rounded-md border border-border bg-card">
          <OrderListGrid
            ref={gridRef}
            datasource={datasource}
            search={search}
            highlightedRowId={highlightedRowId}
            onCellEdited={handleCellEdited}
            onRelink={setRelinkRow}
            onEditOrder={handleEditOrder}
            onSelectionChanged={setSelectedRows}
          />
        </div>
      </div>

      {editor && (
        <OrderEditorDialog
          mode={editor.mode}
          row={editor.row}
          isSaving={createOrder.isPending || updateOrder.isPending}
          customerOptions={customersQuery.data ?? []}
          onClose={() => setEditor(null)}
          onSetVoided={editor.mode === "edit" ? handleSetVoided : undefined}
          onSubmit={({ order, line }) => {
            if (editor.mode === "create") {
              createOrder.mutate({ p_order: order, p_lines: [line] }, { onSuccess: () => setEditor(null) });
              return;
            }
            if (!editor.row) return;
            updateOrder.mutate(
              {
                p_order_id: editor.row.order_id,
                p_order_patch: order,
                p_line_patches: [{ id: editor.row.order_line_id, ...line }],
              },
              { onSuccess: () => setEditor(null) },
            );
          }}
        />
      )}

      {relinkRow && (
        <MasterDataLinkDialog
          row={relinkRow}
          candidates={candidatesQuery.data ?? []}
          isLoading={candidatesQuery.isLoading}
          isSaving={relinkLine.isPending}
          onClose={() => setRelinkRow(null)}
          onConfirm={(itemId) => {
            relinkLine.mutate(
              { p_line_id: relinkRow.order_line_id, p_item_id: itemId, p_match_status: "manual" },
              { onSuccess: () => setRelinkRow(null) },
            );
          }}
        />
      )}
    </div>
  );
}
