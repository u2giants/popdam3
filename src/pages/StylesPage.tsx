import { VendorStatisticsPanel } from "@/components/orders/VendorStatisticsPanel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CellValueChangedEvent, ColDef, ColumnState, DefaultMenuItem, GetContextMenuItemsParams, GridReadyEvent, MenuItemDef } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
import { AgGridReact } from "ag-grid-react";
import { Check, ChevronDown, Clock3, Columns3, Database, Pencil, Plus, RefreshCw, RotateCcw, Save, Search, Sparkles, Star, Table2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GridAiHelperDialog, type GridAiPlan } from "@/components/grid/GridAiHelperDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAdminApi } from "@/hooks/useAdminApi";
import { useAppearance } from "@/hooks/useAppearance";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { applyStyleTrackerJevRanking } from "@/lib/style-tracker-candidates";
import { approvalHighlightForRow } from "@/lib/style-tracker-row-highlighting";
import { navigateToStyleTrackerMatch } from "@/lib/style-tracker-find-navigation";
import { MASTER_DATA_DEFAULT_PAGE_SIZE, MASTER_DATA_PAGE_SIZE_OPTIONS } from "@/lib/master-data-pagination";
import { flattenMasterDataPages, masterDataLoadStatus, masterDataLoadRetry, masterDataLoadRetryDelay, retryMasterDataLoad, shouldAutoFetchMasterDataNextPage } from "@/lib/master-data-loading";
import { getMg01Options, getMg02Options, getMg03Options } from "@/lib/mg-lookup";
import { refreshStyleTrackerBridgeWithRetry, StyleRowSavedBridgeRefreshError } from "@/lib/style-tracker-save";
import { cn } from "@/lib/utils";
import { type FieldKey, type StyleRow, type SheetColumn, type ReviewItem, type LinkCandidate, type JevRankingResponse, type DescriptionEditorOptions, type AuditCell, type SavedView } from "./styles/types";
import { JEV_MATCH_FIELDS, COMMON_SIZE_OPTIONS, SIZE_AT_END_RE, configs, lightGridTheme, darkGridTheme } from "./styles/columns";
import { valueFor, yesNoValue, numberValue, dateValue, googleDateDisplay, displayValueFor, normalized, fieldValue, fieldLabel, hasFieldMatch, hasManualResolution, fuzzyCandidate, statusFor, buildUpdate, columnLabel, auditTitle, auditDescription, formatAuditTime, compactStringOptions, fetchPropertyOptions, fetchSizeOptions, buildLicensorPropertyOptions, validateDescriptionSelection, isColdLionDescription, matchStatusExplanation, isUserCreatedRow } from "./styles/helpers";
import { refreshBridgeWithMeasurement, fetchRowsPage, fetchCellAuditLog, activeViewStorageKey, fetchSavedViews, fetchCount, searchCandidates, searchManualCandidates, fetchCustomerOptions, fetchLicensorOptions, fetchDesignerOptions, fetchFactoryOptions, fetchPackagingTypeOptions } from "./styles/api";
import { DescriptionBuilderEditor, RowNumberCell, RowNumberHeader, RfqGroupCell } from "./styles/cells";

LicenseManager.setLicenseKey("");
ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule]);
export default function StylesPage() {
  const queryClient = useQueryClient();
  const { call: callAdminApi } = useAdminApi();
  const { theme } = useAppearance();
  const { isAdmin } = useIsAdmin();
  const { user } = useAuth();
  const gridRef = useRef<AgGridReact<StyleRow>>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [activeSheet, setActiveSheet] = useState<(typeof configs)[number]["name"]>("License.Style");
  const [showVendorStatistics, setShowVendorStatistics] = useState(false);
  const [quickFilter, setQuickFilter] = useState("");
  const normalizedGridSearch = quickFilter.trim().toLocaleLowerCase();
  const [showAllPageRows, setShowAllPageRows] = useState(false);
  const [selectedReviewKey, setSelectedReviewKey] = useState<string | null>(null);
  const [resolvedReviewKeys, setResolvedReviewKeys] = useState<Set<string>>(() => new Set());
  const [auditCell, setAuditCell] = useState<AuditCell | null>(null);
  const [manualCandidateSearch, setManualCandidateSearch] = useState("");
  const [showAllManualCandidates, setShowAllManualCandidates] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewDialog, setViewDialog] = useState<{ mode: "save" | "rename"; viewId?: string } | null>(null);
  const [viewNameInput, setViewNameInput] = useState("");
  const [gridReady, setGridReady] = useState(false);
  const [viewsMenuOpen, setViewsMenuOpen] = useState(false);
  const [selectedRowCount, setSelectedRowCount] = useState(0);
  const lastAppliedSheetRef = useRef<string | null>(null);

  const active = configs.find((config) => config.name === activeSheet) ?? configs[0];
  const rowsQuery = useInfiniteQuery({
    queryKey: ["style-rows", active.name],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchRowsPage(active.name, pageParam),
    getNextPageParam: (lastPage) => lastPage.hasNextPage ? lastPage.nextOffset : undefined,
    retry: (failureCount) => masterDataLoadRetry(failureCount),
    retryDelay: (attempt) => masterDataLoadRetryDelay(attempt),
  });
  const countQuery = useQuery({ queryKey: ["style-row-count", active.name], queryFn: () => fetchCount(active.name) });
  const cellAuditQuery = useQuery({
    queryKey: ["style-cell-audit", auditCell?.row.id, auditCell?.column.letter],
    queryFn: () => fetchCellAuditLog(auditCell),
    enabled: Boolean(auditCell),
  });
  const customerOptionsQuery = useQuery({ queryKey: ["style-tracker-customer-options"], queryFn: fetchCustomerOptions });
  const licensorOptionsQuery = useQuery({ queryKey: ["style-tracker-licensor-options"], queryFn: fetchLicensorOptions });
  const propertyOptionsQuery = useQuery({ queryKey: ["style-tracker-property-options"], queryFn: fetchPropertyOptions });
  const sizeOptionsQuery = useQuery({ queryKey: ["style-tracker-size-options"], queryFn: fetchSizeOptions });
  const designerOptionsQuery = useQuery({ queryKey: ["style-tracker-designer-options"], queryFn: fetchDesignerOptions });
  const factoryOptionsQuery = useQuery({ queryKey: ["style-tracker-factory-options"], queryFn: fetchFactoryOptions });
  const packagingTypeOptionsQuery = useQuery({ queryKey: ["style-tracker-packaging-type-options"], queryFn: fetchPackagingTypeOptions });
  const savedViewsQuery = useQuery({
    queryKey: ["style-tracker-views", user?.id, active.name],
    queryFn: () => fetchSavedViews(user?.id, active.name),
    enabled: Boolean(user?.id),
  });
  const savedViews = savedViewsQuery.data ?? [];
  const activeView = savedViews.find((view) => view.id === activeViewId) ?? null;
  const rows = useMemo(() => flattenMasterDataPages(rowsQuery.data?.pages ?? []), [rowsQuery.data?.pages]);
  const { fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = rowsQuery;

  useEffect(() => {
    if (shouldAutoFetchMasterDataNextPage(Boolean(hasNextPage), isFetchingNextPage, rowsQuery.isError)) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, rowsQuery.isError]);

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

  const navigateGridSearch = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api || !gridReady || !normalizedGridSearch) return;
    navigateToStyleTrackerMatch(api, rows, normalizedGridSearch);
  }, [gridReady, normalizedGridSearch, rows]);

  useEffect(() => {
    navigateGridSearch();
  }, [navigateGridSearch]);

  useEffect(() => {
    const channel = supabase
      .channel(`style-tracker-rows:${active.name}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "style_tracker_rows" },
        (payload) => {
          const changedSourceSheet = (payload.new as { source_sheet?: unknown } | null)?.source_sheet
            ?? (payload.old as { source_sheet?: unknown } | null)?.source_sheet;
          if (typeof changedSourceSheet === "string" && changedSourceSheet !== active.name) return;

          void queryClient.invalidateQueries({ queryKey: ["style-rows", active.name] });
          void queryClient.invalidateQueries({ queryKey: ["style-cell-audit"] });
          if (payload.eventType !== "UPDATE") {
            void queryClient.invalidateQueries({ queryKey: ["style-row-count", active.name] });
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [active.name, queryClient]);

  const customerOptionById = useMemo(() => new Map((customerOptionsQuery.data ?? []).map((option) => [option.id, option.name])), [customerOptionsQuery.data]);
  const designerOptionKeys = useMemo(() => new Set((designerOptionsQuery.data ?? []).map((name) => normalized(name))), [designerOptionsQuery.data]);
  const packagingTypeOptionKeys = useMemo(() => new Set((packagingTypeOptionsQuery.data ?? []).map((name) => normalized(name))), [packagingTypeOptionsQuery.data]);
  const descriptionOptions = useMemo<DescriptionEditorOptions>(() => {
    const mg01Options = getMg01Options();
    const mg01CodeByName = new Map(mg01Options.map((option) => [option.name, option.code]));
    const parsedSizes = rows
      .map((row) => {
        const match = String(row.description ?? "").match(SIZE_AT_END_RE);
        return match?.[1]?.replace(/\s*[x×]\s*/g, "x").replace(/\s+/g, " ").trim();
      })
      .filter((value): value is string => Boolean(value));

    return {
      mg01: mg01Options.map((option) => option.name),
      mg02: (mg01) => getMg02Options(mg01CodeByName.get(mg01)).map((option) => option.name),
      mg03: (mg01, mg02) => {
        const mg01Code = mg01CodeByName.get(mg01);
        const mg02Code = getMg02Options(mg01Code).find((option) => option.name === mg02)?.code;
        return getMg03Options(mg01Code, mg02Code).map((option) => option.name);
      },
      licensorProperty: buildLicensorPropertyOptions(propertyOptionsQuery.data ?? []),
      size: compactStringOptions([...(sizeOptionsQuery.data?.length ? sizeOptionsQuery.data : COMMON_SIZE_OPTIONS), ...parsedSizes], 500),
    };
  }, [propertyOptionsQuery.data, rows, sizeOptionsQuery.data]);

  const reviewItems = useMemo(() => {
    const items = new Map<string, ReviewItem>();
    for (const row of rows) {
      for (const field of ["sku", "customer", "licensor", "designer", "factory"] as FieldKey[]) {
        if (hasManualResolution(row, field)) continue;
        const rawValue = fieldValue(row, field);
        if (!rawValue) continue;
        if (field === "designer" && designerOptionKeys.has(normalized(String(rawValue)))) continue;
        if (hasFieldMatch(row, field) && !fuzzyCandidate(row, field)) continue;
        const key = `${field}:${normalized(rawValue)}`;
        if (resolvedReviewKeys.has(key)) continue;
        const existing = items.get(key);
        if (existing) existing.count += 1;
        else items.set(key, { key, fieldKey: field, label: fieldLabel(field), rawValue, count: 1 });
      }
    }
    return [...items.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [designerOptionKeys, rows, resolvedReviewKeys]);

  const selectedReviewItem = reviewItems.find((item) => item.key === selectedReviewKey) ?? reviewItems[0] ?? null;
  const candidateQuery = useQuery({
    queryKey: ["style-candidates", selectedReviewItem?.key],
    queryFn: () => searchCandidates(selectedReviewItem),
    enabled: isAdmin && Boolean(selectedReviewItem),
  });
  const jevCandidateKey = (candidateQuery.data ?? [])
    .map((candidate) => `${candidate.target_id}:${candidate.target_label}`)
    .join("|");
  const jevRankingQuery = useQuery({
    queryKey: ["style-candidates-jev", selectedReviewItem?.key, jevCandidateKey],
    queryFn: async () => await callAdminApi("rank-master-data-match-candidates", {
      field_key: selectedReviewItem!.fieldKey,
      raw_value: selectedReviewItem!.rawValue,
      candidates: (candidateQuery.data ?? []).map((candidate) => ({
        target_id: candidate.target_id,
        target_label: candidate.target_label,
      })),
    }, { maxRetries: 0 }) as JevRankingResponse,
    enabled: isAdmin && Boolean(selectedReviewItem) &&
      JEV_MATCH_FIELDS.has(selectedReviewItem?.fieldKey ?? "sku") &&
      (candidateQuery.data?.length ?? 0) >= 1,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const displayedCandidates = useMemo(
    () => applyStyleTrackerJevRanking(candidateQuery.data ?? [], jevRankingQuery.data?.ranking),
    [candidateQuery.data, jevRankingQuery.data?.ranking],
  );
  const manualCandidateQuery = useQuery({
    queryKey: ["style-manual-candidates", selectedReviewItem?.key, manualCandidateSearch, showAllManualCandidates],
    queryFn: () => searchManualCandidates(selectedReviewItem, manualCandidateSearch, showAllManualCandidates),
    enabled: isAdmin && Boolean(selectedReviewItem) && (showAllManualCandidates || manualCandidateSearch.trim().length >= 2) && !candidateQuery.isFetching && (candidateQuery.data ?? []).length === 0,
  });

  useEffect(() => {
    setManualCandidateSearch("");
    setShowAllManualCandidates(false);
  }, [selectedReviewItem?.key]);

  const removeResolvedReviewItem = (item: ReviewItem) => {
    setResolvedReviewKeys((current) => new Set(current).add(item.key));
    setSelectedReviewKey(null);
  };

  const updateCell = useMutation({
    mutationFn: async ({ row, column, value }: { row: StyleRow; column: SheetColumn; value: unknown }) => {
      if (column.typedField === "designer") {
        const nextValue = String(value ?? "").trim();
        if (nextValue && !designerOptionKeys.has(normalized(nextValue))) {
          throw new Error("Choose a designer from the creative designer list.");
        }
      }
      if (column.optionKind === "packagingType") {
        const nextValue = String(value ?? "").trim();
        if (nextValue && !packagingTypeOptionKeys.has(normalized(nextValue))) {
          throw new Error("Choose a packaging type from the shared Packaging Types list.");
        }
      }
      const { error } = await (supabase as any).from("style_tracker_rows").update(buildUpdate(row, column, value)).eq("id", row.id);
      if (error) throw error;
      await refreshStyleTrackerBridgeWithRetry(refreshBridgeWithMeasurement);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["style-rows"] });
      queryClient.invalidateQueries({ queryKey: ["style-cell-audit"] });
    },
    onError: (error) => {
      if (error instanceof StyleRowSavedBridgeRefreshError) {
        toast.warning("Style row saved; linked item data is still refreshing", { description: error.message });
        return;
      }
      toast.error("Could not save style row", { description: error.message });
    },
  });

  const addRow = useMutation({
    mutationFn: async (count: number) => {
      const { error } = await (supabase as any).rpc("add_style_tracker_rows", {
        p_source_sheet: active.name,
        p_tracker_type: active.trackerType,
        p_count: count,
      });
      if (error) throw error;
    },
    onSuccess: (_data, count) => {
      toast.success(count === 1 ? "Row added" : `${count} rows added`);
      queryClient.invalidateQueries({ queryKey: ["style-rows"] });
      queryClient.invalidateQueries({ queryKey: ["style-cell-audit"] });
      queryClient.invalidateQueries({ queryKey: ["style-row-count"] });
    },
    onError: (error) => toast.error("Could not add row", { description: error.message }),
  });

  const deleteRow = useMutation({
    mutationFn: async (row: StyleRow) => {
      const { data, error } = await (supabase as any).rpc("delete_style_tracker_rows", { p_row_ids: [row.id] });
      if (error) throw error;
      return (data ?? [{ deleted_count: 0, skipped_count: 0 }])[0] as { deleted_count: number; skipped_count: number };
    },
    onSuccess: (result) => {
      if (result.skipped_count > 0) {
        toast.warning("Row was not deleted", { description: "Only rows created here in Master Data can be deleted." });
        return;
      }
      toast.success("Row deleted");
      queryClient.invalidateQueries({ queryKey: ["style-rows"] });
      queryClient.invalidateQueries({ queryKey: ["style-cell-audit"] });
      queryClient.invalidateQueries({ queryKey: ["style-row-count"] });
    },
    onError: (error) => toast.error("Could not delete row", { description: error.message }),
  });

  const requestDeleteRow = useCallback(
    (row: StyleRow) => {
      if (deleteRow.isPending) return;
      const sku = String(row.sku ?? "").trim();
      if (!confirm(`Delete this Master Data row${sku ? ` (${sku})` : ""}? This cannot be undone.`)) return;
      deleteRow.mutate(row);
    },
    [deleteRow],
  );

  const resolveCanonical = useMutation({
    mutationFn: async ({ item, candidate }: { item: ReviewItem; candidate: LinkCandidate }) => {
      const { error } = await (supabase as any).rpc("upsert_style_tracker_value_resolution", {
        p_field_key: item.fieldKey,
        p_raw_value: item.rawValue,
        p_resolution_type: "canonical",
        p_target_schema: candidate.target_schema,
        p_target_table: candidate.target_table,
        p_target_id: candidate.target_id,
        p_target_label: candidate.target_label,
      });
      if (error) throw error;
      return item;
    },
    onSuccess: (item) => {
      removeResolvedReviewItem(item);
      toast.success("Master Data link saved");
      queryClient.invalidateQueries({ queryKey: ["style-rows"] });
      queryClient.invalidateQueries({ queryKey: ["style-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["style-cell-audit"] });
    },
    onError: (error) => toast.error("Could not save link", { description: error.message }),
  });

  const resolveLocal = useMutation({
    mutationFn: async (item: ReviewItem) => {
      const { error } = await (supabase as any).rpc("upsert_style_tracker_value_resolution", {
        p_field_key: item.fieldKey,
        p_raw_value: item.rawValue,
        p_resolution_type: "master_data",
        p_local_value: item.rawValue,
      });
      if (error) throw error;
      return item;
    },
    onSuccess: (item) => {
      removeResolvedReviewItem(item);
      toast.success("Master Data-only value saved");
      queryClient.invalidateQueries({ queryKey: ["style-rows"] });
      queryClient.invalidateQueries({ queryKey: ["style-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["style-cell-audit"] });
    },
    onError: (error) => toast.error("Could not save Master Data value", { description: error.message }),
  });

  const applyView = useCallback((view: SavedView | null) => {
    const api = gridRef.current?.api;
    if (!api) return;
    if (!view) {
      api.resetColumnState();
      api.setFilterModel(null);
      return;
    }
    if (Array.isArray(view.column_state) && view.column_state.length) {
      api.applyColumnState({ state: view.column_state, applyOrder: true });
    }
    api.setFilterModel(view.filter_model ?? null);
  }, []);

  const selectView = useCallback(
    (view: SavedView | null) => {
      setActiveViewId(view?.id ?? null);
      try {
        if (view) window.localStorage.setItem(activeViewStorageKey(active.name), view.id);
        else window.localStorage.removeItem(activeViewStorageKey(active.name));
      } catch {
        // ignore storage failures (private mode, etc.)
      }
      applyView(view);
    },
    [active.name, applyView],
  );

  // Re-apply the remembered view when the grid mounts, when the sheet changes,
  // or once that sheet's saved views finish loading.
  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api || !gridReady || savedViewsQuery.isFetching) return;
    if (lastAppliedSheetRef.current === active.name) return;
    lastAppliedSheetRef.current = active.name;
    let storedId: string | null = null;
    try {
      storedId = window.localStorage.getItem(activeViewStorageKey(active.name));
    } catch {
      storedId = null;
    }
    const view = savedViews.find((item) => item.id === storedId) ?? null;
    setActiveViewId(view?.id ?? null);
    applyView(view);
  }, [gridReady, active.name, savedViews, savedViewsQuery.isFetching, applyView]);

  const captureViewState = () => {
    const api = gridRef.current?.api;
    if (!api) throw new Error("The grid is not ready yet.");
    return {
      column_state: api.getColumnState() as ColumnState[],
      filter_model: api.getFilterModel() as Record<string, unknown>,
    };
  };

  const openColumnsPanel = () => {
    const api = gridRef.current?.api;
    if (!api) {
      toast.error("The columns panel is not ready yet.");
      return;
    }
    api.setSideBarVisible(true);
    api.openToolPanel("columns");
  };

  const saveView = useMutation({
    mutationFn: async (name: string) => {
      if (!user?.id) throw new Error("You must be signed in to save a view.");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Enter a name for this view.");
      const { column_state, filter_model } = captureViewState();
      const { data, error } = await (supabase as any)
        .from("style_tracker_user_views")
        .insert({ user_id: user.id, source_sheet: active.name, view_name: trimmed, column_state, filter_model })
        .select("id, view_name, source_sheet, column_state, filter_model, updated_at")
        .single();
      if (error) throw error;
      return data as SavedView;
    },
    onSuccess: (view) => {
      toast.success(`Saved view “${view.view_name}”`);
      setActiveViewId(view.id);
      try {
        window.localStorage.setItem(activeViewStorageKey(active.name), view.id);
      } catch {
        // ignore storage failures
      }
      setViewDialog(null);
      setViewNameInput("");
      queryClient.invalidateQueries({ queryKey: ["style-tracker-views", user?.id, active.name] });
    },
    onError: (error) => toast.error("Could not save view", { description: error.message }),
  });

  const updateView = useMutation({
    mutationFn: async (view: SavedView) => {
      const { column_state, filter_model } = captureViewState();
      const { error } = await (supabase as any)
        .from("style_tracker_user_views")
        .update({ column_state, filter_model })
        .eq("id", view.id);
      if (error) throw error;
      return view;
    },
    onSuccess: (view) => {
      toast.success(`Updated “${view.view_name}”`);
      queryClient.invalidateQueries({ queryKey: ["style-tracker-views", user?.id, active.name] });
    },
    onError: (error) => toast.error("Could not update view", { description: error.message }),
  });

  const renameView = useMutation({
    mutationFn: async ({ view, name }: { view: SavedView; name: string }) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Enter a name for this view.");
      const { error } = await (supabase as any)
        .from("style_tracker_user_views")
        .update({ view_name: trimmed })
        .eq("id", view.id);
      if (error) throw error;
      return trimmed;
    },
    onSuccess: (name) => {
      toast.success(`Renamed view to “${name}”`);
      setViewDialog(null);
      setViewNameInput("");
      queryClient.invalidateQueries({ queryKey: ["style-tracker-views", user?.id, active.name] });
    },
    onError: (error) => toast.error("Could not rename view", { description: error.message }),
  });

  const deleteView = useMutation({
    mutationFn: async (view: SavedView) => {
      const { error } = await (supabase as any).from("style_tracker_user_views").delete().eq("id", view.id);
      if (error) throw error;
      return view;
    },
    onSuccess: (view) => {
      toast.success(`Deleted “${view.view_name}”`);
      if (activeViewId === view.id) {
        setActiveViewId(null);
        try {
          window.localStorage.removeItem(activeViewStorageKey(active.name));
        } catch {
          // ignore storage failures
        }
      }
      queryClient.invalidateQueries({ queryKey: ["style-tracker-views", user?.id, active.name] });
    },
    onError: (error) => toast.error("Could not delete view", { description: error.message }),
  });

  const openSaveViewDialog = () => {
    setViewsMenuOpen(false);
    setViewNameInput("");
    setViewDialog({ mode: "save" });
  };

  const openRenameViewDialog = (view: SavedView) => {
    setViewsMenuOpen(false);
    setViewNameInput(view.view_name);
    setViewDialog({ mode: "rename", viewId: view.id });
  };

  const submitViewDialog = () => {
    if (!viewDialog) return;
    if (viewDialog.mode === "save") {
      saveView.mutate(viewNameInput);
      return;
    }
    const target = savedViews.find((item) => item.id === viewDialog.viewId);
    if (target) renameView.mutate({ view: target, name: viewNameInput });
  };

  const columnDefs = useMemo<ColDef<StyleRow>[]>(
    () => [
      {
        field: "source_row_number",
        headerName: "#",
        width: 96,
        pinned: "left",
        editable: false,
        filter: "agNumberColumnFilter",
        suppressFillHandle: true,
        cellRenderer: RowNumberCell,
        cellRendererParams: { canDeleteRow: isAdmin, onDeleteRow: requestDeleteRow },
        headerComponent: RowNumberHeader,
      },
      {
        colId: "match",
        headerName: "Match",
        width: 112,
        pinned: "left",
        editable: false,
        filter: true,
        suppressFillHandle: true,
        valueGetter: (params) => params.data?.match_status ?? "unmatched",
        cellRenderer: (params: { data?: StyleRow }) => (
          <span
            title={matchStatusExplanation(params.data) ?? undefined}
            className={cn(
              "inline-flex max-w-full items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
              params.data?.match_status === "matched" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
              params.data?.match_status === "partial" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
              params.data?.match_status === "needs_review" && "bg-destructive/15 text-destructive",
              (!params.data?.match_status || params.data.match_status === "unmatched") && "bg-muted text-muted-foreground",
            )}
          >
            {params.data?.match_status === "matched" ? "Linked" : params.data?.match_status === "partial" ? "Partial" : params.data?.match_status === "needs_review" ? "Review" : "Unlinked"}
          </span>
        ),
      },
      {
        colId: "rfq_group",
        headerName: "RFQ Group",
        width: 220,
        editable: false,
        filter: true,
        sortable: true,
        suppressFillHandle: true,
        valueGetter: (params) => params.data?.rfq_groups?.[0]?.name ?? null,
        filterValueGetter: (params) => params.data?.rfq_groups?.map((group) => group.name).join(" | ") ?? "",
        cellRenderer: RfqGroupCell,
      },
      ...active.columns.map((column): ColDef<StyleRow> => ({
        colId: column.letter,
        headerName: column.header,
        headerTooltip: column.headerTooltip ?? `${column.letter}: ${column.header}`,
        width: column.width ?? 140,
        pinned: column.pinned,
        hide: column.hide,
        editable: (params) => isAdmin && column.typedField !== "license_status" && !isColdLionDescription(params.data, column),
        cellEditor:
          column.date
            ? "agDateStringCellEditor"
            : column.number
            ? "agNumberCellEditor"
            : column.yesNo
            ? "agRichSelectCellEditor"
            : column.typedField === "description"
            ? DescriptionBuilderEditor
            : column.optionKind || column.typedField === "customer" || column.typedField === "licensor" || column.typedField === "designer"
              ? "agRichSelectCellEditor"
              : undefined,
        cellEditorPopup: column.typedField === "description" ? true : undefined,
        cellEditorPopupPosition: column.typedField === "description" ? "under" : undefined,
        cellEditorParams:
          column.typedField === "description"
            ? { options: descriptionOptions }
            : column.yesNo
            ? { values: ["Yes", "No"] }
            : column.optionKind || column.typedField === "customer" || column.typedField === "licensor" || column.typedField === "designer"
            ? {
                values:
                  (column.optionKind ?? column.typedField) === "customer"
                    ? (customerOptionsQuery.data ?? []).map((option) => option.id)
                    : (column.optionKind ?? column.typedField) === "licensor"
                      ? licensorOptionsQuery.data ?? []
                      : (column.optionKind ?? column.typedField) === "factory"
                        ? factoryOptionsQuery.data ?? []
                        : (column.optionKind ?? column.typedField) === "packagingType"
                          ? packagingTypeOptionsQuery.data ?? []
                        : designerOptionsQuery.data ?? [],
                allowTyping: (column.optionKind ?? column.typedField) !== "designer",
                filterList: true,
                highlightMatch: true,
                searchType: "matchAny",
                formatValue: column.optionKind === "customer" ? (customerId: string) => customerOptionById.get(customerId) ?? customerId : undefined,
              }
            : undefined,
        filter: column.date ? "agDateColumnFilter" : true,
        cellDataType: column.date ? "dateString" : column.number ? "number" : undefined,
        valueFormatter: column.date ? (params) => googleDateDisplay(params.value) : undefined,
        sortable: true,
        resizable: true,
        valueGetter: (params) =>
          column.date
            ? dateValue(valueFor(params.data, column))
            : column.yesNo
            ? yesNoValue(valueFor(params.data, column))
            : column.number
            ? numberValue(valueFor(params.data, column))
            : column.optionKind === "customer"
            ? params.data?.customer_id ?? null
            : column.optionKind === "designer"
              ? displayValueFor(params.data, column)
              : valueFor(params.data, column),
        filterValueGetter: column.optionKind === "customer" || column.optionKind === "designer" ? (params) => displayValueFor(params.data, column) : undefined,
        cellRenderer: column.linkKind
          ? (params: { data?: StyleRow }) => {
              const status = statusFor(params.data, column);
              return (
                <div className="flex h-full min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate">{String(displayValueFor(params.data, column) ?? "")}</span>
                  {status && (
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        status === "matched" && "bg-emerald-500",
                        status === "needs_review" && "bg-destructive",
                        status === "unmatched" && "bg-muted-foreground/35",
                      )}
                    />
                  )}
                </div>
              );
            }
          : undefined,
        valueSetter: (params) => {
          if (!params.data || !isAdmin || column.typedField === "license_status") return false;
          if (column.typedField === "description") {
            const validationError = validateDescriptionSelection(params.newValue, descriptionOptions);
            if (validationError) {
              toast.error("Description is incomplete", { description: validationError });
              return false;
            }
          }
          if (column.typedField === "designer") {
            const oldValue = String(params.oldValue ?? "").trim();
            const newValue = String(params.newValue ?? "").trim();
            if (newValue && normalized(newValue) !== normalized(oldValue) && !designerOptionKeys.has(normalized(newValue))) {
              toast.error("Choose a designer from the creative designer list");
              return false;
            }
          }
          if (column.optionKind === "packagingType") {
            const oldValue = String(params.oldValue ?? "").trim();
            const newValue = String(params.newValue ?? "").trim();
            if (newValue && normalized(newValue) !== normalized(oldValue) && !packagingTypeOptionKeys.has(normalized(newValue))) {
              toast.error("Choose a packaging type from the shared Packaging Types list");
              return false;
            }
          }
          const payload = buildUpdate(params.data, column, params.newValue);
          params.data.row_data = payload.row_data;
          if (column.optionKind === "customer") {
            params.data.customer_id = payload.customer_id ?? null;
            params.data.customer = null;
            params.data.canonical_customer_name = payload.customer_id ? customerOptionById.get(payload.customer_id) ?? null : null;
          }
          if (column.typedField) (params.data[column.typedField] as unknown) = payload[column.typedField];
          if (column.optionKind === "designer") params.data.canonical_designer_name = payload.designer ?? null;
          return true;
        },
      })),
    ],
    [active, isAdmin, customerOptionById, customerOptionsQuery.data, descriptionOptions, designerOptionKeys, designerOptionsQuery.data, factoryOptionsQuery.data, licensorOptionsQuery.data, packagingTypeOptionKeys, packagingTypeOptionsQuery.data],
  );

  const loadStatus = masterDataLoadStatus({
    loadedRows: rows.length,
    knownTotal: countQuery.data,
    initialLoading: rowsQuery.isLoading,
    initialError: rowsQuery.isError && rows.length === 0 && !rowsQuery.isFetchNextPageError,
    hasNextPage: Boolean(rowsQuery.hasNextPage),
    fetchingNextPage: rowsQuery.isFetchingNextPage,
    nextPageError: rowsQuery.isFetchNextPageError,
    refetchError: rowsQuery.isRefetchError,
  });
  const auditRows = cellAuditQuery.data ?? [];

  const contextMenuItems = (params: GetContextMenuItemsParams<StyleRow>): (DefaultMenuItem | MenuItemDef<StyleRow>)[] => {
    const defaultItems = params.defaultItems ?? [];
    const colId = params.column?.getColId();
    const column = active.columns.find((item) => item.letter === colId);
    const row = params.node?.data;
    if (!row) return defaultItems;

    const rowDeleteItem: MenuItemDef<StyleRow> | null =
      isAdmin && isUserCreatedRow(row)
        ? {
            name: "Delete row",
            action: () => requestDeleteRow(row),
          }
        : null;

    if (!column) {
      const items: (DefaultMenuItem | MenuItemDef<StyleRow>)[] = [];
      if (rowDeleteItem) items.push(rowDeleteItem, "separator");
      return [...items, ...defaultItems];
    }

    return [
      {
        name: "Audit history",
        subMenu: [
          {
            name: `Open ${columnLabel(row.source_sheet, column.letter)}`,
            action: () => setAuditCell({ row, column }),
          },
        ],
      },
      ...(rowDeleteItem ? ([rowDeleteItem] as (DefaultMenuItem | MenuItemDef<StyleRow>)[]) : []),
      "separator",
      ...defaultItems,
    ];
  };

  const applyAiBulkEdit = async (plan: GridAiPlan) => {
    const selectedRows = gridRef.current?.api.getSelectedRows() ?? [];
    const column = active.columns.find((item) => item.letter === plan.field);
    if (column?.typedField === "license_status") throw new Error("License Status is calculated and cannot be edited.");
    if (!column || !selectedRows.length) throw new Error("Select rows and an editable column first.");
    let value = plan.value;
    if (column.optionKind === "customer") {
      const match = (customerOptionsQuery.data ?? []).find((option) => normalized(option.name) === normalized(String(value ?? "")));
      if (!match && value !== null && value !== "") throw new Error("The requested customer is not in the Customer list.");
      value = match?.id ?? null;
    }
    if (column.typedField === "designer" && value && !designerOptionKeys.has(normalized(String(value)))) throw new Error("The requested designer is not in the Creative Designer list.");
    if (column.optionKind === "packagingType" && value && !packagingTypeOptionKeys.has(normalized(String(value)))) throw new Error("The requested packaging type is not in the Packaging Types list.");
    if (column.typedField === "description") {
      const validationError = validateDescriptionSelection(value, descriptionOptions);
      if (validationError) throw new Error(validationError);
    }
    const editableRows = selectedRows.filter((row) => !isColdLionDescription(row, column));
    if (!editableRows.length) throw new Error("Description comes from ColdLion for linked lines and cannot be edited here.");
    for (let index = 0; index < editableRows.length; index += 10) {
      await Promise.all(editableRows.slice(index, index + 10).map(async (row) => {
        const { error } = await (supabase as any).from("style_tracker_rows").update(buildUpdate(row, column, value)).eq("id", row.id);
        if (error) throw error;
      }));
    }
    await refreshStyleTrackerBridgeWithRetry(refreshBridgeWithMeasurement);
    await queryClient.invalidateQueries({ queryKey: ["style-rows", active.name] });
    await queryClient.invalidateQueries({ queryKey: ["style-cell-audit"] });
  };

  return (
    <div className="flex h-[calc(100vh-var(--pd-header-h))] flex-col bg-background">
      <div className="border-b border-border bg-background px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted">
              <Table2 className="h-4 w-4 text-primary" />
            </div>
            {isAdmin && <GridAiHelperDialog pageName="Master Data" selectedRowCount={selectedRowCount} fields={active.columns.filter((column) => column.typedField !== "license_status").map((column) => ({ key: column.letter, label: column.header }))} onApply={applyAiBulkEdit} />}
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight text-foreground">Master Data</h1>
              <div className="flex flex-wrap items-center gap-2">
                <p role="status" className="text-xs text-muted-foreground">{loadStatus.message}</p>
                {loadStatus.showRetry && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void retryMasterDataLoad(rowsQuery.isFetchNextPageError, fetchNextPage, rowsQuery.refetch)}
                    disabled={loadStatus.retryDisabled || rowsQuery.isFetching}
                  >
                    {rowsQuery.isFetching ? "Retrying…" : "Retry loading"}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input ref={searchRef} value={quickFilter} onChange={(event) => setQuickFilter(event.target.value)} className="h-9 pl-8" placeholder="Find in master data (Ctrl+F)" />
            </div>
            <Button variant="outline" size="sm" onClick={() => rowsQuery.refetch()} disabled={rowsQuery.isFetching}>
              <RefreshCw className={cn("h-4 w-4", rowsQuery.isFetching && "animate-spin")} />
            </Button>
            <Button variant="outline" size="sm" onClick={openColumnsPanel}>
              <Columns3 className="h-4 w-4" />
              Columns
            </Button>
            <DropdownMenu open={viewsMenuOpen} onOpenChange={setViewsMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="max-w-56">
                  <Star className={cn("h-4 w-4", activeView && "fill-current text-amber-500")} />
                  <span className="truncate">{activeView ? activeView.view_name : "Views"}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Saved views</DropdownMenuLabel>
                {savedViewsQuery.isLoading ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>
                ) : savedViews.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet.</div>
                ) : (
                  savedViews.map((view) => (
                    <div key={view.id} className="flex items-center gap-1 pr-1">
                      <DropdownMenuItem
                        className="min-w-0 flex-1"
                        onClick={() => selectView(view)}
                      >
                        <Check className={cn("h-3.5 w-3.5 shrink-0", view.id === activeViewId ? "opacity-100" : "opacity-0")} />
                        <span className="min-w-0 truncate">{view.view_name}</span>
                      </DropdownMenuItem>
                      <button
                        type="button"
                        title="Rename view"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openRenameViewDialog(view);
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Delete view"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          deleteView.mutate(view);
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={openSaveViewDialog} disabled={!user}>
                  <Save className="h-3.5 w-3.5" />
                  Save current view…
                </DropdownMenuItem>
                {activeView && (
                  <DropdownMenuItem onClick={() => updateView.mutate(activeView)} disabled={updateView.isPending}>
                    <Check className="h-3.5 w-3.5" />
                    Update “{activeView.view_name}”
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => selectView(null)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset to default
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={addRow.isPending}>
                  <Plus className="h-4 w-4" />
                  Row
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                {[1, 5, 10, 25].map((count) => (
                  <DropdownMenuItem key={count} onClick={() => addRow.mutate(count)}>
                    +{count}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {configs.map((sheet) => (
            <button
              key={sheet.name}
              type="button"
              onClick={() => {
                setShowVendorStatistics(false);
                setActiveSheet(sheet.name);
                setSelectedReviewKey(null);
              }}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                !showVendorStatistics && activeSheet === sheet.name ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {sheet.label}
            </button>
          ))}
          <button type="button" onClick={() => setShowVendorStatistics(true)} className="rounded-md border px-3 py-1.5 text-xs font-medium">Vendor Statistics</button>
        </div>
        {isAdmin && !showVendorStatistics && (
          <div className="mt-3 max-h-52 overflow-hidden border-t border-border pt-3">
            <div className="grid gap-3 xl:grid-cols-[minmax(220px,340px)_1fr] xl:items-start">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">Master Data matching</h2>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{reviewItems.length.toLocaleString()} values</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{selectedReviewItem ? "Approve a shared-table match or dismiss it into Master Data to remove it from this list." : "No unmatched Master Data values in this load."}</p>
              </div>
              {selectedReviewItem && (
                <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(220px,340px)_1fr_auto]">
                  <select value={selectedReviewItem.key} onChange={(event) => setSelectedReviewKey(event.target.value)} className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground">
                    {reviewItems.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}: {item.rawValue} ({item.count})
                      </option>
                    ))}
                  </select>
                  <div className="max-h-32 min-w-0 overflow-y-auto rounded-md border border-border bg-muted/20 p-1.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {displayedCandidates.map((candidate) => (
                        <Button
                          key={`${candidate.target_schema}.${candidate.target_table}.${candidate.target_id}`}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 max-w-72 justify-start text-xs"
                          disabled={resolveCanonical.isPending || resolveLocal.isPending}
                          onClick={() => resolveCanonical.mutate({ item: selectedReviewItem, candidate })}
                          title={`${candidate.jev_recommended ? "Jev's advisory first choice. " : ""}Approve ${candidate.target_label} and remove ${selectedReviewItem.rawValue} from the review list`}
                        >
                          {candidate.jev_recommended ? <Sparkles className="h-3.5 w-3.5 text-primary" /> : <Check className="h-3.5 w-3.5" />}
                          {candidate.jev_recommended && <span className="sr-only">Jev suggests this choice. </span>}
                          <span className="truncate">Approve: {candidate.target_label}</span>
                        </Button>
                      ))}
                      {displayedCandidates.find((candidate) => candidate.jev_recommended) && (
                        <span className="flex w-full items-center gap-1 text-xs text-primary" aria-live="polite">
                          <Sparkles className="h-3.5 w-3.5" />
                          Jev suggests: {displayedCandidates.find((candidate) => candidate.jev_recommended)?.target_label}
                        </span>
                      )}
                      {candidateQuery.isFetching && <span className="text-xs text-muted-foreground">Searching...</span>}
                      {!candidateQuery.isFetching && jevRankingQuery.isFetching && <span className="text-xs text-muted-foreground">Jev is assessing the available choice...</span>}
                      {!jevRankingQuery.isFetching && jevRankingQuery.data?.ranking.choice_index === null && <span className="text-xs text-muted-foreground">Jev found no clear match; review the original choices.</span>}
                      {jevRankingQuery.isError && <span className="text-xs text-amber-700 dark:text-amber-300">Jev ranking is unavailable; original order shown.</span>}
                      {!candidateQuery.isFetching && (candidateQuery.data ?? []).length === 0 && (
                        <div className="grid w-full min-w-0 gap-2">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <div className="relative min-w-0 flex-1">
                              <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                              <Input
                                value={manualCandidateSearch}
                                onChange={(event) => setManualCandidateSearch(event.target.value)}
                                className="h-8 pl-7 text-xs"
                                placeholder={`Search ${selectedReviewItem.label.toLowerCase()} values`}
                              />
                            </div>
                            <label className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5"
                                checked={showAllManualCandidates}
                                onChange={(event) => setShowAllManualCandidates(event.target.checked)}
                              />
                              Show all
                            </label>
                          </div>
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            {manualCandidateQuery.isFetching && <span className="text-xs text-muted-foreground">Searching table...</span>}
                            {!manualCandidateQuery.isFetching && !showAllManualCandidates && manualCandidateSearch.trim().length < 2 && (
                              <span className="text-xs text-muted-foreground">No candidate values found. Search the table or enable Show all.</span>
                            )}
                            {!manualCandidateQuery.isFetching && (manualCandidateQuery.data ?? []).map((candidate) => (
                              <Button
                                key={`manual-${candidate.target_schema}.${candidate.target_table}.${candidate.target_id}`}
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 max-w-72 justify-start text-xs"
                                disabled={resolveCanonical.isPending || resolveLocal.isPending}
                                onClick={() => resolveCanonical.mutate({ item: selectedReviewItem, candidate })}
                                title={`Approve ${candidate.target_label} and remove ${selectedReviewItem.rawValue} from the review list`}
                              >
                                <Check className="h-3.5 w-3.5" />
                                <span className="truncate">Approve: {candidate.target_label}</span>
                              </Button>
                            ))}
                            {!manualCandidateQuery.isFetching && (showAllManualCandidates || manualCandidateSearch.trim().length >= 2) && (manualCandidateQuery.data ?? []).length === 0 && (
                              <span className="text-xs text-muted-foreground">No table values found</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 whitespace-nowrap text-xs"
                    disabled={resolveCanonical.isPending || resolveLocal.isPending}
                    onClick={() => resolveLocal.mutate(selectedReviewItem)}
                    title={`Keep ${selectedReviewItem.rawValue} only in Master Data and remove it from the review list`}
                  >
                    Dismiss: Keep In Master Data
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {showVendorStatistics && <div className="min-h-0 flex-1 overflow-auto p-3"><VendorStatisticsPanel /></div>}
      <div className={showVendorStatistics ? "hidden" : "min-h-0 flex-1 p-3"}>
        <div className="relative h-full min-h-0 overflow-hidden rounded-md border border-border bg-card">
          <AgGridReact
            ref={gridRef}
            theme={theme === "dark" ? darkGridTheme : lightGridTheme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={{ minWidth: 90, suppressHeaderMenuButton: false, wrapHeaderText: true, autoHeaderHeight: true }}
            loading={rowsQuery.isLoading}
            onFilterChanged={(event) => {
              if (!showAllPageRows) return;
              const filteredRowCount = Math.max(event.api.getDisplayedRowCount(), 1);
              if (event.api.paginationGetPageSize() !== filteredRowCount) {
                event.api.setGridOption("paginationPageSize", filteredRowCount);
              }
            }}
            getRowId={(params) => params.data.id}
            getRowStyle={(params) => {
              if (normalizedGridSearch && JSON.stringify(params.data).toLocaleLowerCase().includes(normalizedGridSearch)) {
                return { backgroundColor: "#fde68a", color: "#78350f", boxShadow: "inset 4px 0 #f59e0b" };
              }
              const approval = approvalHighlightForRow(params.data);
              if (approval === "production") return { backgroundColor: "#dcfce7", color: "#14532d" };
              if (approval === "concept") return { backgroundColor: "#fef3c7", color: "#713f12" };
              return undefined;
            }}
            getContextMenuItems={contextMenuItems}
            onGridReady={(event: GridReadyEvent<StyleRow>) => {
              void event;
              setGridReady(true);
            }}
            onRowDataUpdated={() => navigateGridSearch()}
            suppressDragLeaveHidesColumns
            maintainColumnOrder
            onCellValueChanged={(event: CellValueChangedEvent<StyleRow>) => {
              if (!event.data || event.oldValue === event.newValue) return;
              const column = active.columns.find((item) => item.letter === event.colDef.colId);
              if (column) updateCell.mutate({ row: event.data, column, value: event.newValue });
            }}
            rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true }}
            onSelectionChanged={(event) => setSelectedRowCount(event.api.getSelectedRows().length)}
            cellSelection={{ handle: { mode: "fill", direction: "xy" } }}
            sideBar={{ toolPanels: [{ id: "columns", labelDefault: "Columns", labelKey: "columns", iconKey: "columns", toolPanel: "agColumnsToolPanel" }], hiddenByDefault: true }}
            pagination
            paginationPageSize={MASTER_DATA_DEFAULT_PAGE_SIZE}
            paginationPageSizeSelector={[...MASTER_DATA_PAGE_SIZE_OPTIONS]}
            stopEditingWhenCellsLoseFocus
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute bottom-1 left-2 z-10 h-7 bg-card px-2 text-xs"
            disabled={rowsQuery.isLoading || rows.length === 0}
            onClick={() => {
              const api = gridRef.current?.api;
              if (!api) return;
              if (showAllPageRows) {
                api.setGridOption("paginationPageSize", MASTER_DATA_DEFAULT_PAGE_SIZE);
                setShowAllPageRows(false);
                return;
              }
              api.setGridOption("paginationPageSize", Math.max(api.getDisplayedRowCount(), 1));
              setShowAllPageRows(true);
            }}
          >
            {showAllPageRows ? `${MASTER_DATA_DEFAULT_PAGE_SIZE} per page` : "Show All"}
          </Button>
        </div>
      </div>
      <Dialog open={Boolean(auditCell)} onOpenChange={(open) => !open && setAuditCell(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-4 w-4 text-primary" />
              Audit History
            </DialogTitle>
            <DialogDescription>
              {auditCell ? `${columnLabel(auditCell.row.source_sheet, auditCell.column.letter)} · Row ${auditCell.row.source_row_number ?? ""}` : "Cell change history"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {cellAuditQuery.isLoading && <div className="text-sm text-muted-foreground">Loading history...</div>}
            {cellAuditQuery.isError && <div className="text-sm text-destructive">Could not load audit history.</div>}
            {!cellAuditQuery.isLoading && !cellAuditQuery.isError && auditRows.length === 0 && <div className="text-sm text-muted-foreground">No changes recorded for this cell yet.</div>}
            <div className="space-y-3">
              {auditRows.map((entry) => (
                <div key={entry.id} className="rounded-md border border-border bg-background p-3">
                  <div className="text-sm font-medium text-foreground">{auditTitle(entry)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{auditDescription(entry)}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{entry.changed_by_label ?? "Unknown user"}</span>
                    <span>{formatAuditTime(entry.changed_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(viewDialog)}
        onOpenChange={(open) => {
          if (!open) {
            setViewDialog(null);
            setViewNameInput("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {viewDialog?.mode === "rename" ? <Pencil className="h-4 w-4 text-primary" /> : <Save className="h-4 w-4 text-primary" />}
              {viewDialog?.mode === "rename" ? "Rename view" : "Save view"}
            </DialogTitle>
            <DialogDescription>
              {viewDialog?.mode === "rename"
                ? "Give this saved view a new name."
                : `Save the current column layout, order, sizing, and filters for ${active.label}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-1">
            <Input
              autoFocus
              value={viewNameInput}
              onChange={(event) => setViewNameInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitViewDialog();
                }
              }}
              placeholder="e.g. Concept pipeline"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setViewDialog(null);
                setViewNameInput("");
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={submitViewDialog} disabled={!viewNameInput.trim() || saveView.isPending || renameView.isPending}>
              {viewDialog?.mode === "rename" ? "Rename" : "Save view"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
