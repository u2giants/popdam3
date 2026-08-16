import assert from "node:assert/strict";
import test from "node:test";
import { isToolChoiceCompatibilityError, withExactoRouting } from "./openrouter.js";
import { modelSupportsTools, prefersJsonSchemaOutput } from "./handlers/ai-tagging-shared.js";

test("appends :exacto to a bare model slug", () => {
  assert.equal(withExactoRouting("qwen/qwen3-vl-32b-instruct"), "qwen/qwen3-vl-32b-instruct:exacto");
  assert.equal(withExactoRouting("deepseek/deepseek-v4-pro"), "deepseek/deepseek-v4-pro:exacto");
});

test("leaves a model that already carries an explicit variant untouched", () => {
  assert.equal(withExactoRouting("minimax/minimax-m3:exacto"), "minimax/minimax-m3:exacto");
  assert.equal(withExactoRouting("qwen/qwen3-vl-32b-instruct:nitro"), "qwen/qwen3-vl-32b-instruct:nitro");
  assert.equal(withExactoRouting("some/model:free"), "some/model:free");
});

test("trims surrounding whitespace and no-ops on empty input", () => {
  assert.equal(withExactoRouting("  deepseek/deepseek-v4-flash  "), "deepseek/deepseek-v4-flash:exacto");
  assert.equal(withExactoRouting(""), "");
  assert.equal(withExactoRouting("   "), "");
});

test("Muse Spark uses JSON schema first while retaining auto tool capability", () => {
  assert.equal(modelSupportsTools("meta/muse-spark-1.2"), true);
  assert.equal(prefersJsonSchemaOutput("meta/muse-spark-1.2"), true);
  assert.equal(prefersJsonSchemaOutput("meta/muse-spark-1.2:exacto"), true);
  assert.equal(prefersJsonSchemaOutput("meta/muse-glimmer-30b"), false);
  assert.equal(prefersJsonSchemaOutput("qwen/qwen3-vl-32b-instruct"), false);
});

test("tool choice compatibility fallback accepts provider 400 and 404 errors", () => {
  assert.equal(isToolChoiceCompatibilityError(400, 'only "auto" is supported for tool_choice'), true);
  assert.equal(isToolChoiceCompatibilityError(404, "unsupported tool_choice"), true);
  assert.equal(isToolChoiceCompatibilityError(400, "invalid image"), false);
  assert.equal(isToolChoiceCompatibilityError(422, "unsupported tool_choice"), false);
});
