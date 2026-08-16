import test from "node:test";
import assert from "node:assert/strict";
import { PDF_SIZE_LIMIT_BYTES, exceedsPdfSizeLimit } from "./pdf-text-sampler.js";

test("PDF size guard skips only files larger than 100 MB", () => {
  assert.equal(exceedsPdfSizeLimit(PDF_SIZE_LIMIT_BYTES), false);
  assert.equal(exceedsPdfSizeLimit(PDF_SIZE_LIMIT_BYTES + 1), true);
});
