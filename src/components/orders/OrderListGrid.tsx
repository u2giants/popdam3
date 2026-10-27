import { forwardRef, useCallback, useMemo, useRef } from "react";
import type { CellValueChangedEvent, ColDef, IDatasource, RowClassParams, RowStyle } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry, iconSetMaterial, themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";

import { MasterDataLinkCell } from "@/components/orders/MasterDataLinkCell";
import { OrderActionsCell } from "@/components/orders/OrderActionsCell";
import { useAppearance } from "@/hooks/useAppearance";
import {
  ORDER_LIST_COLUMNS,
  ORDER_LIST_DEFAULT_SORT,
  ORDER_LIST_FETCH_BATCH_SIZE,
  ORDER_LIST_DEFAULT_PAGE_SIZE,
  ORDER_LIST_PAGE_SIZE_OPTIONS,
  formatOrderBoolean,
  formatOrderDate,
  isOrderListFieldSortable,
  masterDataDescription,
  masterDataLicenseStatus,
  needsReview,
  orderListRowMatchesSearch,
  type OrderListColumn,
} from "@/lib/order-list";
import { buildOrderListPOBands } from "@/lib/order-list-po-groups";
import type { OrderListRow } from "@/types/order-list";

LicenseManager.setLicenseKey("");
ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule]);

const lightGridTheme = themeQuartz.withPart(iconSetMaterial).withParams({
  accentColor: "#2563eb",
  backgroundColor: "#ffffff",
  borderColor: "#d9e2ef",
  browserColorScheme: "light",
  chromeBackgroundColor: "#f8fafc",
  foregroundColor: "#0f172a",
  headerBackgroundColor: "#eef2f7",
  headerTextColor: "#334155",
  oddRowBackgroundColor: "#ffffff",
  rowHoverColor: "#eef6ff",
  spacing: 6,
  fontSize: 13,
  headerFontSize: 12,
});

const darkGridTheme = themeQuartz.withPart(iconSetMaterial).withParams({
  accentColor: "#38bdf8",
  backgroundColor: "#0b1120",
  borderColor: "#263247",
  browserColorScheme: "dark",
  chromeBackgroundColor: "#111827",
  foregroundColor: "#e5e7eb",
  headerBackgroundColor: "#111827",
  headerTextColor: "#cbd5e1",
  oddRowBackgroundColor: "#0b1220",
  rowHoverColor: "#172033",
  spacing: 6,
  fontSize: 13,
  headerFontSize: 12,
});

/**
 * Text/number/date filters only. A Set filter would have to list the distinct
 * values of a 24,010-row view, and with bounded loading those values are not in
 * the browser -- offering one would silently filter against loaded rows only.
 */
function filterFor(column: OrderListColumn) {
  if (column.type === "number") return "agNumberColumnFilter";
  if (column.type === "date") return "agDateColumnFilter";
  return "agTextColumnFilter";
}

function valueFormatterFor(column: OrderListColumn) {
  if (column.type === "date") return (params: { value: unknown }) => formatOrderDate(params.value as string | null);
  if (column.type === "boolean") {
    return (params: { value: unknown }) => formatOrderBoolean(params.value as boolean | null);
  }
  return undefined;
}

/**
 * Master Data cells read through to the live linked record. When the line has no
 * link we show the frozen import snapshot and mark it, so nobody mistakes
 * historical text for current product truth.
 */
function masterDataRenderer(field: keyof OrderListRow) {
  return function MasterDataValue(params: CustomCellRendererProps<OrderListRow>) {
    const row = params.data;
    if (!row) return null;
    const display =
      field === "master_data_description"
        ? masterDataDescription(row)
        : field === "master_data_license_status"
          ? masterDataLicenseStatus(row)
          : ["test_report", "professional_photos", "contractual_sample_reorder"].includes(field)
            ? { value: row[field] == null ? "Unknown" : typeof row[field] === "boolean" ? (row[field] ? "Yes" : "No") : String(row[field]), isSnapshot: row.product_workflow_source === "at_import" }
            : { value: (row[field] ?? "") as string, isSnapshot: !row.item_id };
    if (!display.value) return null;
    return (
      <span className={display.isSnapshot ? "text-amber-600 dark:text-amber-400" : undefined}>
        {display.value}
        {display.isSnapshot ? <span className="ml-1 text-[10px] uppercase">at import</span> : null}
      </span>
    );
  };
}

// Grid option objects MUST keep a stable identity across renders. A fresh
// `defaultColDef` (or similar) on every parent re-render makes AG Grid rebuild
// its columns from the column definitions, re-applying each `hide` default and
// silently removing any column the user just added from the Columns panel.
// The page re-renders whenever a new block of rows loads (i.e. on scroll).
const DEFAULT_COL_DEF: ColDef<OrderListRow> = { minWidth: 90, wrapHeaderText: true, autoHeaderHeight: true };
const CELL_SELECTION = { handle: { mode: "fill" as const, direction: "xy" as const } };
const ROW_SELECTION = { mode: "multiRow" as const, checkboxes: true, headerCheckbox: false };
const SIDE_BAR = {
  toolPanels: [
    {
      id: "columns",
      labelDefault: "Columns",
      labelKey: "columns",
      iconKey: "columns",
      toolPanel: "agColumnsToolPanel",
    },
  ],
  hiddenByDefault: true,
};

export type OrderListGridProps = {
  datasource: IDatasource;
  onCellEdited: (event: CellValueChangedEvent<OrderListRow>) => void;
  onRelink: (row: OrderListRow) => void;
  onEditOrder: (row: OrderListRow) => void;
  onDisplayedRowsChanged?: (count: number) => void;
  onSelectionChanged?: (rows: OrderListRow[]) => void;
  search?: string;
  highlightedRowId?: string | null;
};

export const OrderListGrid = forwardRef<AgGridReact<OrderListRow>, OrderListGridProps>(function OrderListGrid(
  { datasource, onCellEdited, onRelink, onEditOrder, onDisplayedRowsChanged, onSelectionChanged, search = "", highlightedRowId = null },
  ref,
) {
  const { theme } = useAppearance();
  const poBands = useRef<ReturnType<typeof buildOrderListPOBands>>(new Map());

  const columnDefs = useMemo<ColDef<OrderListRow>[]>(
    () => [
      // Not a view column: the only way to open an existing order in the editor,
      // which is also where an order is voided or restored.
      {
        colId: "row_actions",
        headerName: "",
        width: 76,
        minWidth: 76,
        pinned: "left",
        editable: false,
        sortable: false,
        filter: false,
        resizable: false,
        suppressHeaderMenuButton: true,
        cellRenderer: (params: CustomCellRendererProps<OrderListRow>) => (
          <OrderActionsCell row={params.data ?? undefined} onEditOrder={onEditOrder} />
        ),
      },
      ...ORDER_LIST_COLUMNS.map((column) => {
        const source = column.source ?? (column.kind === "diagnostic" ? "helper" : "automatic");
        const sourceLabel = source === "input" ? "User input" : source === "helper" ? "Derived helper" : "Automatic / linked";
        const base: ColDef<OrderListRow> = {
          colId: column.field,
          field: column.field as ColDef<OrderListRow>["field"],
          headerName: column.header,
          width: column.width,
          hide: column.hide,
          pinned: column.pinned,
          sort: ORDER_LIST_DEFAULT_SORT.find((entry) => entry.colId === column.field)?.sort,
          sortIndex: (() => {
            const index = ORDER_LIST_DEFAULT_SORT.findIndex((entry) => entry.colId === column.field);
            return index < 0 ? undefined : index;
          })(),
          sortable: isOrderListFieldSortable(column.field),
          resizable: true,
          filter: column.queryable === false ? false : filterFor(column),
          valueFormatter: valueFormatterFor(column),
          editable: Boolean(column.editable),
          headerTooltip: column.headerTooltip ?? `${sourceLabel}. ${column.editable ? "Double-click to edit." : "Read-only."}`,
          headerClass: theme === "dark"
            ? (source === "input" ? "bg-blue-900/70 text-blue-100" : source === "helper" ? "bg-slate-700 text-slate-100" : "bg-slate-800 text-slate-200")
            : (source === "input" ? "bg-blue-200 text-blue-950" : source === "helper" ? "bg-slate-300 text-slate-900" : "bg-slate-100 text-slate-700"),
          cellClass: theme === "dark"
            ? (source === "input" ? "bg-blue-950/30" : source === "helper" ? "bg-slate-700/45" : "bg-slate-800/35")
            : (source === "input" ? "bg-blue-50/60" : source === "helper" ? "bg-slate-200/70" : "bg-slate-50/70"),
        };

        if (column.kind === "link") {
          return {
            ...base,
            editable: false,
            filter: "agTextColumnFilter",
            cellRenderer: (params: CustomCellRendererProps<OrderListRow>) => (
              <MasterDataLinkCell row={params.data ?? undefined} onRelink={onRelink} />
            ),
          };
        }

        if (column.field === "assortment_sku_quantity") {
          return {
            ...base,
            editable: false,
            sortable: false,
            filter: false,
            cellRenderer: (params: CustomCellRendererProps<OrderListRow>) => {
              const row = params.data;
              if (!row || row.assortment_sku_quantity == null) return null;
              if (row.assortment_quantity_source !== "current_recipe") return <span>{row.assortment_sku_quantity}</span>;
              return (
                <span className="inline-flex items-center gap-1.5" title="Quantity comes from today's ColdLion recipe.">
                  <span>{row.assortment_sku_quantity}</span>
                  <span className="text-[10px] text-muted-foreground">{" "}current recipe</span>
                </span>
              );
            },
          };
        }

        if (column.kind === "masterData") {
          return {
            ...base,
            editable: false,
            headerTooltip: "Automatic / linked. Read-only; comes from PopDAM Master Data through the linked item.",
            cellClass: theme === "dark" ? "bg-slate-800/35 italic" : "bg-slate-50/70 italic",
            cellRenderer: masterDataRenderer(column.field),
          };
        }

        return base;
      }),
    ],
    [onEditOrder, onRelink, theme],
  );

  const getRowStyle = useCallback((params: RowClassParams<OrderListRow>): RowStyle => {
    const band = poBands.current.get(params.data?.order_line_id ?? "");
    const groupStyle = {
      backgroundColor: theme === "dark"
        ? (band?.alternate ? "#263449" : "#0b1220")
        : (band?.alternate ? "#dce5ef" : "#ffffff"),
      borderTop: band?.start ? `2px solid ${theme === "dark" ? "#64748b" : "#94a3b8"}` : "2px solid transparent",
    };
    if (params.data?.order_line_id === highlightedRowId && orderListRowMatchesSearch(params.data, search)) {
      // Find remains prominent within the PO band.
      return { ...groupStyle, backgroundColor: "#fde68a", color: "#78350f", boxShadow: "inset 4px 0 #f59e0b" };
    }
    if (params.data?.order_voided_at) return { ...groupStyle, opacity: 0.55, textDecoration: "line-through" };
    if (params.data && needsReview(params.data)) return { ...groupStyle, backgroundColor: "#fef3c7", color: "#713f12" };
    return groupStyle;
  }, [theme, highlightedRowId, search]);

  return (
    <AgGridReact<OrderListRow>
      ref={ref}
      theme={theme === "dark" ? darkGridTheme : lightGridTheme}
      columnDefs={columnDefs}
      defaultColDef={DEFAULT_COL_DEF}
      // Bounded blocks: sorting, filtering and search happen in the database.
      rowModelType="infinite"
      datasource={datasource}
      cacheBlockSize={ORDER_LIST_FETCH_BATCH_SIZE}
      cacheOverflowSize={1}
      maxBlocksInCache={20}
      infiniteInitialRowCount={ORDER_LIST_FETCH_BATCH_SIZE}
      getRowId={(params) => params.data.order_line_id}
      // A voided order is still returned by the view, so it has to LOOK voided --
      // otherwise a cancelled order reads as a live one.
      getRowStyle={getRowStyle}
      onCellValueChanged={onCellEdited}
      onModelUpdated={(event) => {
        const rows: Array<{ rowIndex: number; data: OrderListRow }> = [];
        event.api.forEachNode((node) => {
          if (node.data && node.rowIndex != null) rows.push({ rowIndex: node.rowIndex, data: node.data });
        });
        const next = buildOrderListPOBands(rows);
        const changed = next.size !== poBands.current.size || [...next].some(([id, band]) => {
          const previous = poBands.current.get(id);
          return previous?.alternate !== band.alternate || previous?.start !== band.start;
        });
        poBands.current = next;
        // Refresh row styles without recreating cells or interrupting editing.
        if (changed) event.api.setGridOption("getRowStyle", (params) => getRowStyle(params));
        onDisplayedRowsChanged?.(event.api.getDisplayedRowCount());
      }}
      suppressDragLeaveHidesColumns
      maintainColumnOrder
      cellSelection={CELL_SELECTION}
      rowSelection={ROW_SELECTION}
      onSelectionChanged={(event) => onSelectionChanged?.(event.api.getSelectedRows())}
      sideBar={SIDE_BAR}
      pagination
      paginationPageSize={ORDER_LIST_DEFAULT_PAGE_SIZE}
      paginationPageSizeSelector={ORDER_LIST_PAGE_SIZE_OPTIONS}
      stopEditingWhenCellsLoseFocus
    />
  );
});

export default OrderListGrid;
