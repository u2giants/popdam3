import assert from "node:assert/strict";
import test from "node:test";
import { formatError } from "./style-groups.js";

test("database errors retain a timeout code when PostgREST supplies a blank message", () => {
  assert.equal(formatError({ message: "", code: "57014", details: "", hint: "" }), "code=57014");
});

test("completely blank database errors get a useful message", () => {
  assert.equal(formatError({ message: "", code: "", details: "", hint: "" }), "Database error supplied no message");
});
