import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as canonical from "../../supabase/functions/_shared/tag-style-group-contract.js";
import * as workerVendor from "../../apps/worker/vendor/tag-style-group-contract.js";
import {
  ASSET_TAG_CATEGORIES,
  GROUP_TAG_CATEGORIES,
} from "../../supabase/functions/_shared/tagging-metadata-policy.js";

const canonicalPath = "supabase/functions/_shared/tag-style-group-contract.js";
const canonicalIsDirty = execFileSync("git", ["status", "--porcelain", "--", canonicalPath], {
  encoding: "utf8",
}).trim().length > 0;

describe.skipIf(canonicalIsDirty)("Railway worker Style Group contract mirror", () => {
  it("matches the canonical schema and prompt behavior", () => {
    expect(workerVendor.TAG_STYLE_GROUP_REQUIRED_FIELDS).toEqual(canonical.TAG_STYLE_GROUP_REQUIRED_FIELDS);
    expect(workerVendor.TAG_STYLE_GROUP_SCHEMA).toEqual(canonical.TAG_STYLE_GROUP_SCHEMA);

    const context = {
      styleGroup: {
        sku: "FIXTURE-1",
        item_description: "Fixture mug",
        licensor_name: "Fixture Licensor",
        property_name: "Fixture Property",
        product_category: "Drinkware",
      },
      representativeAssets: [
        { id: "11111111-1111-4111-8111-111111111111", content_type: "photograph" },
        { id: "22222222-2222-4222-8222-222222222222", descriptor: "tech pack" },
      ],
      richMetadata: { fixture: true },
    };
    expect(workerVendor.buildStyleGroupTaggingPrompt(context)).toBe(
      canonical.buildStyleGroupTaggingPrompt(context),
    );
  });
});

describe("Style Group contract scope enforcement", () => {
  const schema = canonical.TAG_STYLE_GROUP_SCHEMA as {
    required: string[];
    properties: {
      group_tags: {
        maxItems: number;
        items: {
          required: string[];
          properties: {
            category: { enum: string[] };
            confidence: { minimum: number; maximum: number };
            evidence_asset_ids: { uniqueItems: boolean };
          };
        };
      };
    };
  };

  it("requires a description and group tags", () => {
    expect(schema.required).toEqual(["group_ai_description", "group_tags"]);
  });

  it("accepts only group-scoped categories and rejects file-only categories", () => {
    const allowed = schema.properties.group_tags.items.properties.category.enum;
    expect(allowed).toEqual([...GROUP_TAG_CATEGORIES]);
    for (const fileOnly of ASSET_TAG_CATEGORIES.filter((c) => !GROUP_TAG_CATEGORIES.includes(c))) {
      expect(allowed).not.toContain(fileOnly);
    }
    expect(allowed).not.toContain("view");
    expect(allowed).not.toContain("color");
    expect(allowed).not.toContain("file_type");
  });

  it("bounds confidence and requires distinct evidence asset IDs on every tag", () => {
    const item = schema.properties.group_tags.items;
    expect(item.required).toEqual(["tag", "category", "confidence", "evidence_asset_ids"]);
    expect(item.properties.confidence.minimum).toBe(0);
    expect(item.properties.confidence.maximum).toBe(1);
    expect(item.properties.evidence_asset_ids.uniqueItems).toBe(true);
    expect(schema.properties.group_tags.maxItems).toBe(18);
  });
});

/**
 * The Railway image imports the VENDOR copy of the shared tagging policy (see the
 * COPY lines in apps/worker/Dockerfile), while every test here imports the repo
 * canonical. Without this comparison, vendor rot ships to production with an
 * all-green suite — a silent failure by construction.
 */
const policyCanonicalPath = "supabase/functions/_shared/tagging-metadata-policy.js";
const policyIsDirty = execFileSync("git", ["status", "--porcelain", "--", policyCanonicalPath], {
  encoding: "utf8",
}).trim().length > 0;

describe.skipIf(policyIsDirty)("Railway worker tagging-policy mirror", () => {
  it("is byte-identical to the canonical policy", () => {
    for (const [canonicalFile, vendorFile] of [
      [policyCanonicalPath, "apps/worker/vendor/tagging-metadata-policy.js"],
      ["supabase/functions/_shared/tagging-metadata-policy.d.ts", "apps/worker/vendor/tagging-metadata-policy.d.ts"],
    ]) {
      expect(readFileSync(vendorFile, "utf8"), `${vendorFile} has drifted from ${canonicalFile}`)
        .toBe(readFileSync(canonicalFile, "utf8"));
    }
  });

  it("exports the provenance the group refresh and the profile pass both depend on", async () => {
    const vendorPolicy = await import("../../apps/worker/vendor/tagging-metadata-policy.js");
    const canonicalPolicy = await import("../../supabase/functions/_shared/tagging-metadata-policy.js");
    expect(vendorPolicy.AUTHORITATIVE_TAG_SOURCE).toBe(canonicalPolicy.AUTHORITATIVE_TAG_SOURCE);
    expect(vendorPolicy.AUTHORITATIVE_TAG_MODEL).toBe(canonicalPolicy.AUTHORITATIVE_TAG_MODEL);
    expect(typeof vendorPolicy.authoritativeTagsAreCurrent).toBe("function");
  });
});
