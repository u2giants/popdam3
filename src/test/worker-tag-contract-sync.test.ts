import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import * as canonical from "../../supabase/functions/_shared/tag-asset-contract.js";
import * as workerVendor from "../../apps/worker/vendor/tag-asset-contract.js";

const canonicalPath = "supabase/functions/_shared/tag-asset-contract.js";
const canonicalIsDirty = execFileSync("git", ["status", "--porcelain", "--", canonicalPath], {
  encoding: "utf8",
}).trim().length > 0;

describe.skipIf(canonicalIsDirty)("Railway worker tagging-contract mirror", () => {
  it("matches the canonical schema and prompt behavior", () => {
    expect(workerVendor.TAG_ASSET_REQUIRED_FIELDS).toEqual(canonical.TAG_ASSET_REQUIRED_FIELDS);
    expect(workerVendor.TAG_ASSET_SCHEMA).toEqual(canonical.TAG_ASSET_SCHEMA);

    const context = {
      asset: {
        filename: "fixture.pdf",
        relative_path: "Decor/fixture.pdf",
        file_type: "pdf",
        tags: ["fixture"],
      },
      taxonomyContext: "Fixture taxonomy",
      erpDescription: "Fixture product",
      extractedPdfText: "Fixture PDF text",
      customInstructions: "Fixture instruction",
      usingPriorityOnly: true,
    };
    expect(workerVendor.buildTaggingSystemPrompt(context)).toBe(canonical.buildTaggingSystemPrompt(context));
    expect(workerVendor.toGeminiSchema(workerVendor.TAG_ASSET_SCHEMA)).toEqual(
      canonical.toGeminiSchema(canonical.TAG_ASSET_SCHEMA),
    );
  });
});
