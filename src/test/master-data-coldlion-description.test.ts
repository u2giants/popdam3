import { describe, expect, it } from "vitest";
import { isColdLionDescription } from "@/pages/styles/helpers";
import { licensedColumns } from "@/pages/styles/columns";
import type { StyleRow } from "@/pages/styles/types";

const description = licensedColumns.find((column) => column.typedField === "description")!;
const upc = licensedColumns.find((column) => column.typedField === "upc")!;

describe("Master Data description comes from ColdLion", () => {
  it("locks the description of a ColdLion-linked line", () => {
    expect(isColdLionDescription({ plm_item_id: "item-1" } as StyleRow, description)).toBe(true);
  });

  it("keeps the description editable on an unlinked line", () => {
    expect(isColdLionDescription({ plm_item_id: null } as StyleRow, description)).toBe(false);
  });

  it("leaves other columns of a linked line alone", () => {
    expect(isColdLionDescription({ plm_item_id: "item-1" } as StyleRow, upc)).toBe(false);
  });
});
