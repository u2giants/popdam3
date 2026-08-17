import { forwardRef, useMemo } from "react";
import type { CellValueChangedEvent, ColDef, IDatasource } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry, iconSetMaterial, themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";

import { MasterDataLinkCell } from "@/components/orders/MasterDataLinkCell";
import { useAppearance } from "@/hooks/useAppearance";
import {
  ORDER_LIST_COLUMNS,
  ORDER_LIST_FETCH_BATCH_SIZE,
  ORDER_LIST_DEFAULT_PAGE_SIZE,
  ORDER_LIST_PAGE_SIZE_OPTIONS,
  formatOrderBoolean,
  formatOrderDate,
  masterDataDescription,
  masterDataLicenseStatus,
  needsReview,
  type OrderListColumn,
} from "@/lib/order-list";
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
  oddRowBackgroundColor: "#fbfdff",
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
  oddRowBackgroundColor: "#0f172a",
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

export type OrderListGridProps = {
  datasource: IDatasource;
  onCellEdited: (event: CellValueChangedEvent<OrderListRow>) => void;
  onRelink: (row: OrderListRow) => void;
  onDisplayedRowsChanged?: (count: number) => void;
};

export const OrderListGrid = forwardRef<AgGridReact<OrderListRow>, OrderListGridProps>(function OrderListGrid(
  { datasource, onCellEdited, onRelink, onDisplayedRowsChanged },
  ref,
) {
  const { theme } = useAppearance();

  const columnDefs = useMemo<ColDef<OrderListRow>[]>(
    () =>
      ORDER_LIST_COLUMNS.map((column) => {
        const base: ColDef<OrderListRow> = {
          colId: column.field,
          field: column.field as ColDef<OrderListRow>["field"],
          headerName: column.header,
          width: column.width,
          hide: column.hide,
          pinned: column.pinned,
          sortable: true,
          resizable: true,
          filter: filterFor(column),
          valueFormatter: valueFormatterFor(column),
          editable: Boolean(column.editable),
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

        if (column.kind === "masterData") {
          return {
            ...base,
            editable: false,
            headerTooltip: "Read-only. Comes from PopDAM Master Data through the linked item.",
            cellClass: "bg-muted/40 italic",
            cellRenderer: masterDataRenderer(column.field),
          };
        }

        return base;
      }),
    [onRelink],
  );

  return (
    <AgGridReact<OrderListRow>
      ref={ref}
      theme={theme === "dark" ? darkGridTheme : lightGridTheme}
      columnDefs={columnDefs}
      defaultColDef={{ minWidth: 90, wrapHeaderText: true, autoHeaderHeight: true }}
      // Bounded blocks: sorting, filtering and search happen in the database.
      rowModelType="infinite"
      datasource={datasource}
      cacheBlockSize={ORDER_LIST_FETCH_BATCH_SIZE}
      cacheOverflowSize={1}
      maxBlocksInCache={20}
      infiniteInitialRowCount={ORDER_LIST_FETCH_BATCH_SIZE}
      getRowId={(params) => params.data.order_line_id}
      getRowStyle={(params) => (params.data && needsReview(params.data) ? { backgroundColor: "#fef3c7", color: "#713f12" } : undefined)}
      onCellValueChanged={onCellEdited}
      onModelUpdated={(event) => onDisplayedRowsChanged?.(event.api.getDisplayedRowCount())}
      suppressDragLeaveHidesColumns
      maintainColumnOrder
      cellSelection={{ handle: { mode: "fill", direction: "xy" } }}
      sideBar={{
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
      }}
      pagination
      paginationPageSize={ORDER_LIST_DEFAULT_PAGE_SIZE}
      paginationPageSizeSelector={ORDER_LIST_PAGE_SIZE_OPTIONS}
      stopEditingWhenCellsLoseFocus
    />
  );
});

export default OrderListGrid;
