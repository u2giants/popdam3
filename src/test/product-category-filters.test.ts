import { describe, expect, it } from "vitest";
import { buildProductCategoryOrFilter } from "@/lib/product-category-filters";

describe("buildProductCategoryOrFilter", () => {
  it("keeps Wall category filters aligned with legacy 3FZ wall-art folders", () => {
    expect(buildProductCategoryOrFilter(["Wall"], "folder_path")).toBe(
      "product_category.in.(Wall),folder_path.ilike.%WALL ART%,folder_path.ilike.%3FZ%",
    );
  });

  it("uses stored product_category for non-wall categories", () => {
    expect(buildProductCategoryOrFilter(["Clock", "Storage"], "relative_path")).toBe(
      "product_category.in.(Clock,Storage)",
    );
  });
});
