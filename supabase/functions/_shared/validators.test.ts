import { describe, expect, it, vi } from "vitest";
import * as admin from "./admin-utils";
import * as agent from "./validators";

vi.mock("./service-client.ts", () => ({ serviceClient: vi.fn() }));
vi.mock("./http.ts", () => ({ err: vi.fn(), json: vi.fn() }));

describe.each([{ name: "admin", validators: admin }, { name: "agent", validators: agent }])(
  "$name string validators",
  ({ validators }) => {
    it.each([{}, { value: 7 }, { value: "   " }])("rejects a missing or invalid required value %j", (body) => {
      expect(() => validators.requireString(body, "value")).toThrow(/^Missing required string field: value$/);
    });

    it.each([{}, { value: null }, { value: "   " }])("returns null for an absent or blank optional value %j", (body) => {
      expect(validators.optionalString(body, "value")).toBeNull();
    });

    it("rejects a non-string optional value with its existing error", () => {
      expect(() => validators.optionalString({ value: 7 }, "value")).toThrow(/^Field value must be a string$/);
    });

    it("trims valid required and optional strings", () => {
      const body = { value: "  example  " };
      expect(validators.requireString(body, "value")).toBe("example");
      expect(validators.optionalString(body, "value")).toBe("example");
    });
  },
);
