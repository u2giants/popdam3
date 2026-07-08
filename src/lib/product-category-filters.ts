const PRODUCT_CATEGORIES = new Set(["Wall", "Tabletop", "Clock", "Storage", "Workspace", "Floor", "Garden"]);

function cleanCategory(category: string): string | null {
  const trimmed = category.trim();
  return PRODUCT_CATEGORIES.has(trimmed) ? trimmed : null;
}

export function buildProductCategoryOrFilter(
  categories: string[],
  pathColumn: "folder_path" | "relative_path",
): string | null {
  const selected = [...new Set(categories.map(cleanCategory).filter(Boolean))] as string[];
  if (selected.length === 0) return null;

  const parts = [`product_category.in.(${selected.join(",")})`];

  if (selected.includes("Wall")) {
    parts.push(`${pathColumn}.ilike.%WALL ART%`);
    parts.push(`${pathColumn}.ilike.%3FZ%`);
  }

  return parts.join(",");
}
