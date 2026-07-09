import { describe, expect, it } from "vitest";
import {
  PACKAGING_TYPE_EDITOR_EMAIL,
  canManagePackagingTypes,
  cleanPackagingTypeInput,
} from "@/lib/packaging-types";

describe("packaging type settings access", () => {
  it("allows the named packaging type editor", () => {
    expect(canManagePackagingTypes(PACKAGING_TYPE_EDITOR_EMAIL.toUpperCase(), false)).toBe(true);
  });

  it("allows admins", () => {
    expect(canManagePackagingTypes("someone@popcre.com", true)).toBe(true);
  });

  it("blocks unrelated non-admin users", () => {
    expect(canManagePackagingTypes("someone@popcre.com", false)).toBe(false);
  });
});

describe("packaging type input cleanup", () => {
  it("normalizes spacing and optional code", () => {
    expect(cleanPackagingTypeInput("  Folding   Carton  ", " fc ")).toEqual({
      name: "Folding Carton",
      code: "FC",
    });
  });

  it("stores blank codes as null", () => {
    expect(cleanPackagingTypeInput("Blister Pack", "   ")).toEqual({
      name: "Blister Pack",
      code: null,
    });
  });
});
