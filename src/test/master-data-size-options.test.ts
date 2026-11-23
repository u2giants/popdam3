import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  schema: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { schema: db.schema } }));

import { fetchSizeOptions, parseDescriptionParts, validateDescriptionSelection } from "@/pages/styles/helpers";
import type { DescriptionEditorOptions } from "@/pages/styles/types";

const options: DescriptionEditorOptions = {
  mg01: ["Canvas"],
  mg02: () => ["Framed"],
  mg03: () => ["Print"],
  licensorProperty: ["Disney Mickey Mouse"],
  size: ["18oz", '16x20"'],
};
const description = "Canvas Framed Print Disney Mickey Mouse Artwork";

describe("Master Data Size options", () => {
  it("uses selectable labels from the shared picker and preserves their punctuation", async () => {
    db.schema.mockReturnValue({ rpc: db.rpc });
    db.rpc.mockResolvedValueOnce({
      data: [
        { label: '16x20"', selectable: true },
        { label: '16X20"', selectable: true },
        { label: "16x20", selectable: true },
        { label: "Retired", selectable: false },
      ],
      error: null,
    });

    const sizes = await fetchSizeOptions();
    expect(db.schema).toHaveBeenCalledWith("api");
    expect(db.rpc).toHaveBeenCalledWith("product_size_list");
    expect(sizes).toHaveLength(2);
    expect(sizes).toEqual(expect.arrayContaining(['16x20"', "16x20"]));
  });

  it("surfaces an unavailable shared picker", async () => {
    const error = new Error("Size request failed");
    db.schema.mockReturnValue({ rpc: db.rpc });
    db.rpc.mockResolvedValueOnce({ data: null, error });
    await expect(fetchSizeOptions()).rejects.toBe(error);
  });

  it("recognizes a canonical label that is not a dimension", () => {
    const value = `${description} 18oz`;
    expect(parseDescriptionParts(value, options).size).toBe("18oz");
    expect(validateDescriptionSelection(value, options)).toBeNull();
  });

  it("allows an existing legacy dimension only on the description that already has it", () => {
    const oldValue = `${description} 16x20" x1.2"`;
    const newValue = oldValue.replace("Artwork", "Updated Artwork");
    expect(validateDescriptionSelection(newValue, options, oldValue)).toBeNull();
    expect(validateDescriptionSelection(newValue, options)).toBe("Choose approved values for Size.");
    expect(validateDescriptionSelection(newValue, options, `${description} 15x30"`))
      .toBe("Choose approved values for Size.");
  });
});
