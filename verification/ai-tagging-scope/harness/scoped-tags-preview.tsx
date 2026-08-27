/**
 * Synthetic visual harness for the Step 7 scoped-metadata UI (issue #96).
 *
 * It renders the real `ScopedTagSections` component with FICTIONAL data for three
 * sibling files in one Style Group, so the separation can be verified visually
 * without opening any licensed artwork. No network, no database, no real asset.
 *
 * Run:  npx vite --config verification/ai-tagging-scope/harness/vite.config.ts
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScopedTagSections } from "@/components/library/ScopedTagSections";
import type { EffectiveTag } from "@/hooks/useEffectiveAssetTags";
import "@/index.css";

const groupTags: EffectiveTag[] = [
  { scope: "style_group", tag: "drinkware", category: "product_type", source: "authoritative", status: "active", confidence: 1, model: null, createdBy: null },
  { scope: "style_group", tag: "synthetic property", category: "theme", source: "manual", status: "active", confidence: null, model: null, createdBy: "u1" },
  { scope: "style_group", tag: "floral", category: "theme", source: "group_ai", status: "active", confidence: 0.93, model: "qwen/qwen3-vl-32b-instruct", createdBy: null },
];
const groupCandidates: EffectiveTag[] = [
  { scope: "style_group", tag: "gift", category: "occasion", source: "group_ai", status: "candidate", confidence: 0.62, model: "qwen/qwen3-vl-32b-instruct", createdBy: null },
];

const FILES: Array<{ name: string; assetTags: EffectiveTag[]; assetCandidates: EffectiveTag[]; rejected: EffectiveTag[]; unavailable?: boolean }> = [
  {
    name: "Photograph — synth-mug-front.jpg",
    assetTags: [
      { scope: "asset", tag: "professional photography", category: "file_type", source: "ai", status: "active", confidence: 0.97, model: "qwen/qwen3-vl-32b-instruct", createdBy: null },
      { scope: "asset", tag: "3/4 view", category: "view", source: "ai", status: "active", confidence: 0.91, model: "qwen/qwen3-vl-32b-instruct", createdBy: null },
      { scope: "asset", tag: "blue", category: "color", source: "ai", status: "active", confidence: 0.88, model: "qwen/qwen3-vl-32b-instruct", createdBy: null },
    ],
    assetCandidates: [
      { scope: "asset", tag: "condensation", category: "scene", source: "ai", status: "candidate", confidence: 0.55, model: "qwen/qwen3-vl-32b-instruct", createdBy: null },
    ],
    rejected: [
      { scope: "asset", tag: "pink", category: "color", source: "ai", status: "rejected", confidence: 0.4, model: "qwen/qwen3-vl-32b-instruct", createdBy: null },
    ],
  },
  {
    name: "Tech pack — synth-mug-techpack.pdf",
    assetTags: [
      { scope: "asset", tag: "tech pack", category: "file_type", source: "ai", status: "active", confidence: 0.96, model: "qwen/qwen3-vl-32b-instruct", createdBy: null },
      { scope: "asset", tag: "dimension callouts", category: "visible_content", source: "ai", status: "active", confidence: 0.9, model: "qwen/qwen3-vl-32b-instruct", createdBy: null },
    ],
    assetCandidates: [],
    rejected: [],
  },
  {
    name: "No preview — synth-mug-source.ai",
    assetTags: [],
    assetCandidates: [],
    rejected: [],
    unavailable: true,
  },
];

function Harness() {
  const [editing, setEditing] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  return (
    <TooltipProvider>
      <div style={{ padding: 24, display: "grid", gap: 24 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Scoped metadata — synthetic preview (issue #96 Step 7)</h1>
          <button onClick={() => setEditing((value) => !value)} style={{ fontSize: 12, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 6 }}>
            {editing ? "Editing: on" : "Editing: off"}
          </button>
        </header>
        <p style={{ fontSize: 13, opacity: 0.7, maxWidth: 720 }}>
          Three sibling files in ONE Style Group. The Style Group block is identical for all three —
          those facts are stored once on the group. The "This file" block differs for every file.
          Changing one file's tags must never alter a sibling.
        </p>
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          {FILES.map((file) => (
            <section key={file.name} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
              <h2 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{file.name}</h2>
              <ScopedTagSections
                groupTags={groupTags}
                groupCandidates={groupCandidates}
                assetTags={file.assetTags}
                assetCandidates={file.assetCandidates}
                rejected={file.rejected}
                hasStyleGroup
                editing={editing}
                visualAnalysisUnavailable={file.unavailable}
                onAction={({ scope, tag, action }) => setLog((prev) => [`${file.name}: ${action} ${scope} "${tag}"`, ...prev].slice(0, 8))}
              />
            </section>
          ))}
        </div>
        <section>
          <h2 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, opacity: 0.6 }}>Actions the UI would send</h2>
          <ul style={{ fontSize: 12, fontFamily: "monospace", opacity: 0.8 }}>
            {log.length === 0 && <li>(none yet)</li>}
            {log.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        </section>
      </div>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
