/**
 * FilterSidebar: drag-to-resize width and truncation-only tooltips.
 *
 * jsdom has no layout engine, so scrollWidth/clientWidth are stubbed to
 * simulate "this text does not fit" for one specific label.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import FilterSidebar from "@/components/library/FilterSidebar";
import type { AssetFilters } from "@/types/assets";

const LONG_NAME = "Warner Bros. Consumer Products International";
const SHORT_NAME = "Disney";

const emptyFilters: AssetFilters = {
  search: "",
  fileType: [],
  contentType: [],
  productMaterial: [],
  status: [],
  workflowStatus: [],
  isLicensed: null,
  licensorId: null,
  propertyId: null,
  assetType: [],
  artSource: [],
  tagFilter: "",
  fileStatus: [],
  productCategory: [],
  stage: [],
  customer: null,
  program: null,
};

function renderSidebar() {
  return render(
    <FilterSidebar
      filters={emptyFilters}
      onFiltersChange={() => {}}
      onClose={() => {}}
      licensors={[
        { id: "1", name: LONG_NAME, asset_count: 12 },
        { id: "2", name: SHORT_NAME, asset_count: 3 },
      ]}
      properties={[]}
      facetCounts={null}
      mode="assets"
    />,
  );
}

function sidebarEl() {
  return screen.getByLabelText("Resize filter panel").parentElement as HTMLElement;
}

/** Pretend any element whose text is LONG_NAME overflows its box. */
function stubOverflowForLongText() {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent === LONG_NAME ? 400 : 50;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return 100;
    },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  stubOverflowForLongText();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // @ts-expect-error restoring the prototype getters we replaced
  delete HTMLElement.prototype.scrollWidth;
  // @ts-expect-error restoring the prototype getters we replaced
  delete HTMLElement.prototype.clientWidth;
});

describe("FilterSidebar resize handle", () => {
  it("starts at the default width and widens as the handle is dragged right", () => {
    renderSidebar();
    expect(sidebarEl().style.width).toBe("214px");

    const handle = screen.getByLabelText("Resize filter panel");
    fireEvent.mouseDown(handle, { clientX: 214 });
    fireEvent.mouseMove(document, { clientX: 314 });
    fireEvent.mouseUp(document);

    expect(sidebarEl().style.width).toBe("314px");
  });

  it("clamps to the min and max widths", () => {
    renderSidebar();
    const handle = screen.getByLabelText("Resize filter panel");

    fireEvent.mouseDown(handle, { clientX: 214 });
    fireEvent.mouseMove(document, { clientX: 0 });
    fireEvent.mouseUp(document);
    expect(sidebarEl().style.width).toBe("180px");

    fireEvent.mouseDown(handle, { clientX: 0 });
    fireEvent.mouseMove(document, { clientX: 5000 });
    fireEvent.mouseUp(document);
    expect(sidebarEl().style.width).toBe("520px");
  });

  it("remembers the width and restores it on the next render", () => {
    const { unmount } = renderSidebar();
    const handle = screen.getByLabelText("Resize filter panel");
    fireEvent.mouseDown(handle, { clientX: 214 });
    fireEvent.mouseMove(document, { clientX: 344 });
    fireEvent.mouseUp(document);
    expect(window.localStorage.getItem("library-filter-sidebar-width")).toBe("344");

    unmount();
    renderSidebar();
    expect(sidebarEl().style.width).toBe("344px");
  });

  it("resets to the default width on double-click", () => {
    renderSidebar();
    const handle = screen.getByLabelText("Resize filter panel");
    fireEvent.mouseDown(handle, { clientX: 214 });
    fireEvent.mouseMove(document, { clientX: 400 });
    fireEvent.mouseUp(document);
    expect(sidebarEl().style.width).toBe("400px");

    fireEvent.doubleClick(handle);
    expect(sidebarEl().style.width).toBe("214px");
  });
});

describe("FilterSidebar dropdown tooltips", () => {
  it("adds a tooltip only to values that are cut off", () => {
    renderSidebar();

    // Open the Licensor combobox (its trigger shows "All").
    const licensorSection = screen.getByText("Licensor").closest("div") as HTMLElement;
    fireEvent.click(within(licensorSection).getAllByText("All")[0]);

    expect(screen.getByText(LONG_NAME)).toHaveAttribute("title", LONG_NAME);
    expect(screen.getByText(SHORT_NAME)).not.toHaveAttribute("title");
  });
});
