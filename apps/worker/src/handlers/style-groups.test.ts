import assert from "node:assert/strict";
import test from "node:test";
import { formatError } from "./style-groups.js";

test("database errors retain a timeout code when PostgREST supplies a blank message", () => {
  assert.equal(formatError({ message: "", code: "57014", details: "", hint: "" }), "code=57014");
});

test("completely blank database errors get a useful message", () => {
  assert.equal(formatError({ message: "", code: "", details: "", hint: "" }), "Database error supplied no message");
});

test("a blank HEAD-style error still names the HTTP status", () => {
  assert.equal(
    formatError({ message: "", code: "", details: "", hint: "" }, { status: 500, statusText: "Internal Server Error" }),
    "Database error supplied no message | http_status=500 | http_status_text=Internal Server Error",
  );
});

test("a populated error keeps its message and gains the HTTP status", () => {
  assert.equal(
    formatError({ message: "canceling statement due to statement timeout", code: "57014" }, { status: 500, statusText: "Internal Server Error" }),
    "canceling statement due to statement timeout | code=57014 | http_status=500 | http_status_text=Internal Server Error",
  );
});
