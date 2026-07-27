import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const featureFiles = [
  resolve("src/features/popsg-property-reconciliation/contract.ts"),
  resolve("src/features/popsg-property-reconciliation/PropertyReconciliationPanel.tsx"),
  resolve("src/features/popsg-property-reconciliation/PropertyReconciliationVisualPage.tsx"),
  resolve("scripts/generate-popsg-property-reconciliation-fixture.cjs"),
];
const prohibitedAdapter =
  /integrations\/supabase|supabase\.|\.rpc\(|(?<!Buffer)\.from\(|functions\.invoke|fetch\(|INSERT\s|UPDATE\s|DELETE\s/i;

describe("PSG-3 no-write boundary", () => {
  it("has no Supabase, RPC, SQL, or activation adapter", () => {
    const source = featureFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(prohibitedAdapter);
    expect(source).not.toMatch(/activateProposal|approveAndActivate|proposal_effective/);
  });

  it("keeps the Settings and dev-route integrations adapter-free", () => {
    const settings = readFileSync(resolve("src/pages/popsg/PopSGSettingsPage.tsx"), "utf8");
    const settingsMount = settings.match(/<PropertyReconciliationPanel[\s\S]*?\/>/)?.[0] ?? "";
    expect(settingsMount).toContain('role={isAdmin ? "administrator" : "viewer"}');
    expect(settingsMount).not.toMatch(prohibitedAdapter);

    const app = readFileSync(resolve("src/App.tsx"), "utf8");
    const route = app.match(
      /\{import\.meta\.env\.DEV[\s\S]*?PropertyReconciliationVisualPage[\s\S]*?\)\}/,
    )?.[0] ?? "";
    expect(route).toContain("/__visual/property-reconciliation");
    expect(route).not.toMatch(prohibitedAdapter);
  });

  it("uses pending state only and says activation is unavailable", () => {
    const contract = readFileSync(featureFiles[0], "utf8");
    const panel = readFileSync(featureFiles[1], "utf8");
    expect(contract).toContain('state: "pending"');
    expect(contract).toContain("activationAvailable: false");
    expect(panel).toContain("There is no activate action in this contract.");
  });
});
