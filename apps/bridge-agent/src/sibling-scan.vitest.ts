import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { listSiblingCandidates } from "./handlers/sibling-scan.js";

it("finds images in subfolders like ART/ and skips Synology @eaDir", async () => {
  const root = await mkdtemp(join(tmpdir(), "sib-"));
  await mkdir(join(root, "ART/@eaDir/x_COMP.jpg"), { recursive: true });
  await writeFile(join(root, "top.png"), "");
  await writeFile(join(root, "ART/x_COMP.jpg"), "");
  await writeFile(join(root, "ART/art.psd"), "");
  const found = await listSiblingCandidates(root, new Set([".jpg", ".png"]));
  expect(found.map((f) => f.rel).sort()).toEqual(["ART/x_COMP.jpg", "top.png"]);
});
