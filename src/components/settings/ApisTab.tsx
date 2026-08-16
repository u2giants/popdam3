import { useState, useEffect } from "react";
import { Globe, RefreshCw, ChevronDown, ChevronRight, ExternalLink, Sparkles, Save, Plus, Trash2, Eye, EyeOff, BarChart3, Copy } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CURRENT_APP } from "@/lib/app-mode";
import { formatOpenRouterPricing, hasUnavailableOpenRouterPricing, type OpenRouterPricing } from "@/lib/openrouter-pricing";
import { toast } from "sonner";

// ── Types ───────────────────────────────────────────────────────────

interface SyncSource {
  code: string;
  name: string;
  apiUrl: string;
  apiKey?: string;
  enabled: boolean;
}

const DEFAULT_SOURCES: SyncSource[] = [
  { code: "DS", name: "Disney", apiUrl: "https://api.sandbox.designflow.app/api/autofill/properties-and-characters/DS", enabled: true },
  { code: "MV", name: "Marvel", apiUrl: "https://api.sandbox.designflow.app/api/autofill/properties-and-characters/MV", enabled: true },
  { code: "WWE", name: "WWE", apiUrl: "https://api.sandbox.designflow.app/api/autofill/properties-and-characters/WWE", enabled: true },
];

// ── Taxonomy Source Editor ──────────────────────────────────────────

function TaxonomySourceEditor() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [sources, setSources] = useState<SyncSource[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});

  // New source form state
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [showNewApiKey, setShowNewApiKey] = useState(false);

  const { data: savedSources } = useQuery({
    queryKey: ["taxonomy-sync-config"],
    queryFn: async () => {
      const result = await call("get-config", { keys: ["TAXONOMY_SYNC_CONFIG"] });
      const raw = result?.config?.TAXONOMY_SYNC_CONFIG?.value ?? result?.config?.TAXONOMY_SYNC_CONFIG;
      return Array.isArray(raw) ? (raw as SyncSource[]) : DEFAULT_SOURCES;
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (savedSources && !loaded) {
      setSources(savedSources);
      setLoaded(true);
    }
  }, [savedSources, loaded]);

  async function persist(updated: SyncSource[]) {
    setSaving(true);
    try {
      await call("set-config", { entries: { TAXONOMY_SYNC_CONFIG: updated } });
      setSources(updated);
      queryClient.invalidateQueries({ queryKey: ["taxonomy-sync-config"] });
      toast.success("Taxonomy sources saved");
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function handleToggle(code: string, enabled: boolean) {
    const updated = sources.map((s) => s.code === code ? { ...s, enabled } : s);
    persist(updated);
  }

  function handleDelete(code: string) {
    const updated = sources.filter((s) => s.code !== code);
    persist(updated);
  }

  function handleAdd() {
    if (!newName.trim() || !newCode.trim() || !newUrl.trim()) {
      toast.error("Name, code, and URL are required");
      return;
    }
    const code = newCode.trim().toUpperCase();
    if (sources.some((s) => s.code === code)) {
      toast.error(`Source with code "${code}" already exists`);
      return;
    }
    const newSource: SyncSource = {
      code,
      name: newName.trim(),
      apiUrl: newUrl.trim(),
      apiKey: newApiKey.trim() || undefined,
      enabled: true,
    };
    persist([...sources, newSource]);
    setNewName("");
    setNewCode("");
    setNewUrl("");
    setNewApiKey("");
    setAdding(false);
  }

  const syncMutation = useMutation({
    mutationFn: async (code: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const url = `${CURRENT_APP.supabaseUrl}/functions/v1/sync-external`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          apikey: CURRENT_APP.supabaseAnonKey,
        },
        body: JSON.stringify({ action: "sync-one", licensor_code: code }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      return resp.json();
    },
    onSuccess: (data) => {
      const r = data.result;
      toast.success(`Sync complete: ${r?.propertiesUpserted ?? 0} properties, ${r?.charactersUpserted ?? 0} characters`);
      queryClient.invalidateQueries({ queryKey: ["taxonomy-data"] });
    },
    onError: (e) => toast.error(`Sync failed: ${e.message}`),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Source Endpoints</p>
      {sources.map((src) => (
        <div key={src.code} className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-2">
          <Switch
            checked={src.enabled}
            onCheckedChange={(v) => handleToggle(src.code, v)}
            className="shrink-0"
          />
          <Badge variant="outline" className="text-[10px] shrink-0">{src.code}</Badge>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-medium">{src.name}</span>
            <code className="text-[10px] font-mono text-muted-foreground block truncate">{src.apiUrl}</code>
          </div>
          {src.apiKey && (
            <Badge variant="secondary" className="text-[10px] shrink-0">Key</Badge>
          )}
          <a href={src.apiUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
            <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
          </a>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs shrink-0"
            onClick={() => syncMutation.mutate(src.code)}
            disabled={syncMutation.isPending || !src.enabled}
            title={!src.enabled ? "Enable this integration first" : syncMutation.isPending ? "Sync in progress…" : undefined}
          >
            Sync
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
            onClick={() => handleDelete(src.code)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {adding ? (
        <div className="border border-border rounded-md p-3 space-y-3 bg-muted/30">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Peanuts" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Code (uppercase)</Label>
              <Input value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} placeholder="e.g. PN" className="h-8 text-sm font-mono" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">API URL</Label>
            <Input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://api.example.com/properties" className="h-8 text-sm font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">API Key (optional)</Label>
            <div className="relative">
              <Input
                type={showNewApiKey ? "text" : "password"}
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="Optional auth header value"
                className="h-8 text-sm font-mono pr-8"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowNewApiKey(!showNewApiKey)}
              >
                {showNewApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd} disabled={saving} title={saving ? "Saving…" : undefined}>
              {saving ? "Saving…" : "Save Source"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> Add Source
        </Button>
      )}
    </div>
  );
}

// ── Taxonomy API Section ────────────────────────────────────────────

interface PropertyRow {
  id: string;
  name: string;
  external_id: string | null;
  characters: { id: string; name: string }[];
}

interface LicensorRow {
  id: string;
  name: string;
  external_id: string | null;
  properties: PropertyRow[];
}

function TaxonomyApiSection() {
  const queryClient = useQueryClient();
  const [expandedLicensor, setExpandedLicensor] = useState<string | null>(null);
  const [expandedProperty, setExpandedProperty] = useState<string | null>(null);

  const { data: taxonomyData, isLoading } = useQuery({
    queryKey: ["taxonomy-data"],
    queryFn: async () => {
      async function fetchAll(schema: "core" | "public", table: string, select: string, orderCol: string) {
        const PAGE = 1000;
        const all: Record<string, unknown>[] = [];
        let from = 0;
        while (true) {
          const client = schema === "core" ? (supabase as any).schema("core") : (supabase as any);
          const { data, error } = await client
            .from(table)
            .select(select)
            .order(orderCol)
            .range(from, from + PAGE - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          all.push(...(data as unknown as Record<string, unknown>[]));
          if (data.length < PAGE) break;
          from += PAGE;
        }
        return all;
      }

      const [licensors, properties, characters] = await Promise.all([
        fetchAll("core", "licensor", "id, name, external_id:code", "name"),
        fetchAll("core", "property", "id, name, external_id:code, licensor_id", "name"),
        fetchAll("public", "dam_character_catalog", "id, name, property_id:core_property_id", "name"),
      ]);

      const charsByProp = new Map<string, { id: string; name: string }[]>();
      for (const c of characters) {
        const pid = c.property_id as string;
        const list = charsByProp.get(pid) || [];
        list.push({ id: c.id as string, name: c.name as string });
        charsByProp.set(pid, list);
      }

      const propsByLic = new Map<string, PropertyRow[]>();
      for (const p of properties) {
        const lid = p.licensor_id as string;
        const list = propsByLic.get(lid) || [];
        list.push({ id: p.id as string, name: p.name as string, external_id: p.external_id as string | null, characters: charsByProp.get(p.id as string) || [] });
        propsByLic.set(lid, list);
      }

      return licensors.map((lic) => ({
        id: lic.id as string,
        name: lic.name as string,
        external_id: lic.external_id as string | null,
        properties: propsByLic.get(lic.id as string) || [],
      }));
    },
  });

  const licensors = taxonomyData || [];
  const totalProps = licensors.reduce((s, l) => s + l.properties.length, 0);
  const totalChars = licensors.reduce((s, l) => s + l.properties.reduce((ps, p) => ps + p.characters.length, 0), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4" /> Shared Taxonomy (Licensors / Properties / Characters)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 text-xs">
          <Badge variant="secondary" className="font-mono">{licensors.length} Licensors</Badge>
          <Badge variant="secondary" className="font-mono">{totalProps} Properties</Badge>
          <Badge variant="secondary" className="font-mono">{totalChars} Characters</Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          Licensors and properties are read-only shared master data from <code>core.licensor</code> and <code>core.property</code>. DesignFlow owns the canonical feed.
        </p>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading taxonomy data...</p>
        ) : licensors.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No canonical taxonomy data is available.</p>
        ) : (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Canonical Data</p>
            {licensors.map((lic) => {
              const licExpanded = expandedLicensor === lic.id;
              const charCount = lic.properties.reduce((s, p) => s + p.characters.length, 0);
              return (
                <div key={lic.id}>
                  <button
                    className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded hover:bg-muted/50 transition-colors"
                    onClick={() => setExpandedLicensor(licExpanded ? null : lic.id)}
                  >
                    {licExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                    <span className="text-sm font-medium">{lic.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {lic.properties.length} properties · {charCount} characters
                    </span>
                  </button>
                  {licExpanded && (
                    <div className="ml-5 border-l border-border pl-3 space-y-0.5">
                      {lic.properties.map((prop) => {
                        const propExpanded = expandedProperty === prop.id;
                        return (
                          <div key={prop.id}>
                            <button
                              className="flex items-center gap-2 w-full text-left px-2 py-1 rounded hover:bg-muted/50 transition-colors"
                              onClick={() => setExpandedProperty(propExpanded ? null : prop.id)}
                            >
                              {prop.characters.length > 0 ? (
                                propExpanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />
                              ) : (
                                <span className="w-3" />
                              )}
                              <span className="text-xs">{prop.name}</span>
                              {prop.characters.length > 0 && (
                                <span className="text-[10px] text-muted-foreground ml-auto">{prop.characters.length} chars</span>
                              )}
                            </button>
                            {propExpanded && prop.characters.length > 0 && (
                              <div className="ml-5 border-l border-border/50 pl-3 py-0.5">
                                <div className="flex flex-wrap gap-1">
                                  {prop.characters.map((char) => (
                                    <Badge key={char.id} variant="secondary" className="text-[10px] font-normal">{char.name}</Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── AI Models & API Keys Section ─────────────────────────────────────

const DEFAULT_MODELS_PLACEHOLDER = JSON.stringify(
  [
    { id: "gemini-flash", provider: "google", apiModel: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash", capabilities: ["vision", "text"] },
    { id: "claude-haiku", provider: "anthropic", apiModel: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", capabilities: ["vision", "text"] },
  ],
  null,
  2,
);

const TASK_MODEL_LABELS: Record<string, {
  label: string;
  description: string;
  defaultModel: string;
  requiresTools?: boolean;
  requiresVision?: boolean;
  requiresStructuredOutput?: boolean;
  fallbackKey?: string;
  providerPinKey?: string;
}> = {
  vision_tagging: {
    label: "Image Tagging",
    description: "Vision model for analyzing thumbnails and generating tags, descriptions, characters. Must support image input plus tools, structured outputs, or JSON mode.",
    defaultModel: "google/gemini-2.5-flash",
    requiresVision: true,
    requiresStructuredOutput: true,
    fallbackKey: "vision_tagging_fallback",
    providerPinKey: "vision_tagging_provider",
  },
  text_classification: {
    label: "ERP Classification",
    description: "Text model for classifying products into categories (Wall, Tabletop, etc.). Must support tool use.",
    defaultModel: "anthropic/claude-haiku-4.5",
    requiresTools: true,
  },
  pdf_extraction: {
    label: "PDF Text Extraction",
    description: "Vision model for extracting text from PDF pages (agent fallback after OCR)",
    defaultModel: "google/gemini-2.5-flash",
    requiresTools: false,
  },
};

const TASK_MODEL_BRIEFS: Record<string, string> = {
  vision_tagging: `IMAGE TAGGING — model selection brief

WHAT THIS TASK DOES
Looks at one asset image (licensed-character artwork, a product photo, a tech pack or style-guide page, etc.) plus its file metadata and returns structured catalog metadata: descriptive tags, a one-sentence description, a short product-label "cover description", a scene description, asset type and art source, design style/reference, matched character / licensor / property IDs from a controlled in-house taxonomy, designer / technical-designer / freelancer names read off title blocks, and a deduplicated list of "Files Used" pulled from any attached tech-pack text. It runs as a single-turn image+text request (no chat history, no multi-step agent loop), at bulk-job scale across the whole library.

HOW THE CODE INVOKES THE MODEL
All calls go through OpenRouter (OpenAI-compatible Chat Completions), so any listed model that meets the contract can be selected without a code change. The worker asks for structured output through a fallback ladder and takes whichever the model supports: (1) a forced tag_asset tool/function call; (2) OpenRouter json_schema structured outputs; (3) plain JSON mode with schema instructions in the prompt. It then validates that the required fields are present. So a model does NOT need native tool calling to qualify — it needs to reliably return valid JSON matching the schema through at least one of those mechanisms. It DOES need real image input; a text-only model cannot do this task.

WHAT IS FED TO THE MODEL
- One image: the asset's THUMBNAIL, not the full-resolution original — an already-compressed, downscaled raster sent inline. There is no separate high-res pass, so the model must read small detail (style numbers, fine print in title blocks, near-identical character variants) off a low-resolution image.
- A text prompt with: filename / path / type / existing tags; optionally the product's ERP description (used ONLY to derive the cover label — the prompt explicitly tells the model to ignore the image for that one field, because the image is often artwork rather than the finished product); optionally a slice of previously-extracted PDF/tech-pack text; and a "known taxonomy" block listing candidate licensors, properties, and characters each paired with its database UUID, so the model can return exact foreign-key matches instead of free text. This taxonomy block can be large, and optional company-specific tagging instructions may be appended.

WHAT WE EXPECT BACK
A structured object. Required: tags (string[]), ai_description, scene_description. Optional/nullable: cover_description (short product label, no licensor names/SKUs/dimensions), asset_type (art_piece | product), art_source enum, design_style, design_ref, character_ids (UUIDs — exact matches only), licensor_id / property_id (UUIDs), designer_name / technical_designer_name / freelancer_name, files_used (string[]). IDs must be chosen only from the provided taxonomy; the app defends against bad IDs (it strips them and retries on a foreign-key violation, and filters anything that isn't a valid UUID), but that is cleanup for a model that misbehaved — it is not a substitute for a model that follows the "use only listed IDs" rule.

CAPABILITIES THAT MATTER, AND WHY
- Vision is mandatory; reliable structured/JSON output through one of the three mechanisms above is mandatory. Native tool calling is nice-to-have, not required.
- Strong small-detail reading on a compressed thumbnail matters more than headline "supports high-res images", because the input is already downscaled.
- A comfortably large context window matters, because the taxonomy block plus metadata and PDF text can be sizable.
- Instruction-following fidelity matters more than creative captioning: the model must honor narrow rules (only use listed UUIDs, derive the cover label from ERP text not the image, follow company tagging instructions) rather than free-associate.
- Because it runs across the entire library, per-call cost and throughput are real constraints — this is a high-volume task, not a one-off.

MODEL BEHAVIORS THAT HELP OR HURT (lessons, not endorsements)
- Content-filter refusals are a known failure mode. The pipeline carries special handling for vision models/providers (Alibaba/Qwen-style hosts have shown this) that reject an image during content inspection — "inappropriate content", failed media download — and it treats those as model-specific failures worth routing to a fallback model. For a library that is mostly licensed characters and product art, a model with an over-eager content filter will fail systematically on ordinary assets; prefer models that process normal product/character imagery without spurious refusals.
- UUID hallucination is a known failure mode: models that invent taxonomy IDs instead of matching the provided list create bad links (guarded against, but wasteful and lossy). Prefer a model that obeys "only use IDs from this list, otherwise leave it null."
- Prose-only vision models that describe the picture but won't commit to the schema are disqualified regardless of how good the caption is.

HOW TO EVALUATE CANDIDATES
Use the Vision Bake-Off tool in this same Settings > Processing area: it runs candidate models against real assets, captures per-call cost and latency, and lets a human compare outputs field-by-field before committing a choice — better than picking on reputation alone.`,

  text_classification: `ERP CLASSIFICATION — model selection brief

WHAT THIS TASK DOES
Classifies a home-décor product into exactly ONE of a small, fixed set of categories (Wall, Tabletop, Clock, Storage, Workspace, Floor, Garden, Other). Closed-vocabulary, single-label, TEXT-ONLY (no image). It runs only as a fallback for records that lack a reliable deterministic category mapping, so the model is a backstop for the ambiguous long tail, not the primary categorizer. Obvious-junk descriptions are filtered out in code before the model is ever called, so the model only sees plausible, real product descriptions.

HOW THE CODE INVOKES THE MODEL
Through OpenRouter, single-turn and text-only. The worker chooses strict schema, JSON object, or a compatible classify_product tool call from the model's live capability profile. Invalid output is recorded as a failed item instead of being silently skipped.

WHAT IS FED TO THE MODEL
A system role framing it as a product-classification expert, then a prompt containing: the definition of each category, a set of hard rules, a list of explicit "correction examples" pairing a description with its correct category, and finally the item to classify — its style number, its text description, and a blob of raw ERP attribute fields. Everything the model reasons from is text and structured metadata.

WHAT WE EXPECT BACK
A structured result with three fields: category (one of the fixed enum values), confidence (0–1), and a short rationale. Confidence is not decorative: it gates automation — results above a confidence threshold are auto-applied to the product record, and results below it are queued for a human to review. The prompt explicitly tells the model not to guess and to report low confidence when a description is genuinely ambiguous.

CAPABILITIES THAT MATTER, AND WHY
- Rock-solid forced function calling with a strictly-typed enum + numeric confidence. This is the hard gate; a model that sometimes answers in prose or drifts off-enum is disqualified.
- Strong in-context instruction-following, because the whole task is applying this company's rules over the model's own generic priors.
- Well-calibrated confidence — unusually important here, because confidence directly decides auto-apply vs. human review. A systematically over-confident model is actively harmful even when it is often right, since it will auto-apply its wrong answers instead of surfacing them.
- No vision, small context, short outputs. This is a cheap/fast, high-volume task — favor efficient models; heavyweight reasoning models buy little here.

MODEL BEHAVIORS THAT HELP OR HURT (lessons, not endorsements)
- The prompt deliberately carries a list of real past misclassifications as corrections — for example, in this catalog an "MDF box" or "wooden box" is decorative Wall art, not Storage; a "canvas" is Wall; a "shadowbox" is wall-mounted, not freestanding Storage. These exist because models default to the everyday meaning of a word ("box" ⇒ storage) and get it wrong for this business. A good model overrides its generic prior when the prompt gives it an explicit correction; a weak-instruction-following model repeats the generic mistake no matter how many corrections it is shown. Test candidates specifically on these counter-intuitive cases, not just easy ones.`,

  pdf_extraction: `PDF TEXT EXTRACTION — model selection brief

WHAT THIS TASK DOES
Pulls readable text out of a PDF (or Illustrator file) page so it can be searched and can feed context into image tagging. This is important: the AI vision model is the LAST resort in a cascade, not the primary extractor. The cascade is: (1) native text extraction from the PDF's real text layer; (2) if that comes back nearly empty, render the page to an image and run local OCR (Tesseract); (3) only if OCR is also nearly empty does the rendered page image go to an AI vision model. Very large files are skipped before any of this. Because the AI step fires only after both a real text layer AND local OCR have already failed, it disproportionately sees the hardest pages — poor scans, stylized or decorative type, dense tech-pack layouts, skewed pages, small print mixed with imagery.

HOW THE CODE INVOKES THE MODEL
Not through OpenRouter. This path selects a model from a provider-agnostic catalog and calls the provider's API directly (Google or Anthropic today, chosen by the catalog entry's provider field), sending the rendered page as an inline image. The model entry must declare a vision capability or it is skipped. It is a plain text-completion vision call: no tools, no function calling, no JSON schema. The instruction is essentially "extract all text from this page and return only the raw text, no commentary."

WHAT IS FED TO THE MODEL
A single rendered page image (one page, upscaled for legibility) as an inline image, and that one plain instruction. No partial text from the earlier cascade steps is passed in as a hint — the model works from the image alone.

WHAT WE EXPECT BACK
Raw plain text — no structure, no fields. The result is tagged as AI-vision-sourced so downstream consumers know it is less trustworthy than deterministic text-layer or OCR output.

CAPABILITIES THAT MATTER, AND WHY
- Vision is mandatory. The single differentiator is raw OCR-grade text-recognition accuracy on degraded, low-quality, or oddly-laid-out pages — nothing else about the model matters much here.
- It must clear a HIGHER bar than ordinary OCR, because local OCR already tried and failed on exactly these pages upstream. A model that is merely "as good as Tesseract" adds nothing at this stage.
- No tool use, no large context window, no complex reasoning, no structured-output discipline are needed. Cost and speed still matter because this can run over a large backlog.

MODEL BEHAVIORS THAT HELP OR HURT (lessons, not endorsements)
- Faithfulness beats fluency. A model that hallucinates plausible-looking text on an illegible page is WORSE than one that returns little or nothing, because this output is trusted downstream (search, and as context fed into image tagging) and there is no schema or validation to catch invented text. Prefer a model that transcribes what is actually legible and leaves genuine gaps, over one that "smooths over" unreadable regions with confident guesses. Evaluate candidates on hard, low-quality scans specifically — the easy pages never reach this step.`,
};

async function copyTaskBrief(taskKey: string, label: string) {
  const brief = TASK_MODEL_BRIEFS[taskKey];
  if (!brief) return;
  try {
    await navigator.clipboard.writeText(brief);
    toast.success(`Copied "${label}" model-selection brief to clipboard`);
  } catch {
    toast.error("Failed to copy to clipboard");
  }
}

export function AiModelsConfigSection() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const configKeys = ["AI_MODELS", "AI_TASK_MODELS", "AI_MODEL_DISPLAY_NAMES", "OPENROUTER_API_KEY", "GOOGLE_AI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];

  const { data: configData } = useQuery({
    queryKey: ["admin-config", ...configKeys],
    queryFn: () => call("get-config", { keys: configKeys }),
    staleTime: 30_000,
  });

  const [openRouterKey, setOpenRouterKey] = useState("");
  const [showOpenRouter, setShowOpenRouter] = useState(false);
  const [googleKey, setGoogleKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [showGoogle, setShowGoogle] = useState(false);
  const [showAnthropic, setShowAnthropic] = useState(false);
  const [showOpenai, setShowOpenai] = useState(false);
  const [showLegacyKeys, setShowLegacyKeys] = useState(false);
  const [modelsJson, setModelsJson] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [taskModels, setTaskModels] = useState<Record<string, string>>({});
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  const unwrap = (v: unknown) => ((v as Record<string, unknown>)?.value ?? v ?? "") as string;

  useEffect(() => {
    if (!configData || loaded) return;
    const cfg = configData.config ?? {};
    setOpenRouterKey(unwrap(cfg.OPENROUTER_API_KEY));
    setGoogleKey(unwrap(cfg.GOOGLE_AI_API_KEY));
    setAnthropicKey(unwrap(cfg.ANTHROPIC_API_KEY));
    setOpenaiKey(unwrap(cfg.OPENAI_API_KEY));
    const models = (cfg.AI_MODELS as Record<string, unknown>)?.value ?? cfg.AI_MODELS;
    setModelsJson(models ? JSON.stringify(models, null, 2) : "");
    const savedTasks = ((cfg.AI_TASK_MODELS as Record<string, unknown>)?.value ?? cfg.AI_TASK_MODELS ?? {}) as Record<string, string>;
    setTaskModels(savedTasks);
    const savedDisplayNames = ((cfg.AI_MODEL_DISPLAY_NAMES as Record<string, unknown>)?.value ?? cfg.AI_MODEL_DISPLAY_NAMES ?? {}) as Record<string, string>;
    setDisplayNames(savedDisplayNames);
    setLoaded(true);
  }, [configData, loaded]);

  function handleModelsChange(val: string) {
    setModelsJson(val);
    try {
      if (val.trim()) JSON.parse(val);
      setJsonError("");
    } catch {
      setJsonError("Invalid JSON");
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      let models: unknown;
      try {
        models = modelsJson.trim() ? JSON.parse(modelsJson) : [];
      } catch {
        throw new Error("Invalid JSON in AI Models");
      }
      const entries: Record<string, unknown> = {
        AI_MODELS: models,
        AI_TASK_MODELS: taskModels,
        AI_MODEL_DISPLAY_NAMES: displayNames,
      };
      if (openRouterKey.trim()) entries.OPENROUTER_API_KEY = openRouterKey.trim();
      if (googleKey.trim()) entries.GOOGLE_AI_API_KEY = googleKey.trim();
      if (anthropicKey.trim()) entries.ANTHROPIC_API_KEY = anthropicKey.trim();
      if (openaiKey.trim()) entries.OPENAI_API_KEY = openaiKey.trim();
      return call("set-config", { entries });
    },
    onSuccess: () => {
      toast.success("AI configuration saved");
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savedOpenRouterKey = unwrap(configData?.config?.OPENROUTER_API_KEY);

  const {
    data: openRouterModels,
    isFetching: fetchingModels,
    isLoading: loadingModels,
    error: modelsError,
    refetch: refetchOpenRouterModels,
  } = useQuery<Array<{
    id: string;
    name: string;
    supportsTools: boolean;
    supportsStructuredOutputs: boolean;
    supportsResponseFormat: boolean;
    toolChoiceModes: string[];
    inputModalities: string[];
    pricing?: OpenRouterPricing;
  }>>({
    queryKey: ["openrouter-models", savedOpenRouterKey],
    enabled: !!savedOpenRouterKey,
    queryFn: async () => {
      const data = await call("get-openrouter-vision-models");
      const items = (data?.models ?? []) as Array<{ id: string; name?: string; supports_tools?: boolean; supports_structured_outputs?: boolean; supports_response_format?: boolean; tool_choice_modes?: string[]; input_modalities?: string[]; pricing?: OpenRouterPricing }>;
      return items
        .filter((m) => !hasUnavailableOpenRouterPricing(m.pricing))
        .map((m) => ({
          id: m.id,
          name: m.name ?? m.id,
          supportsTools: m.supports_tools === true,
          supportsStructuredOutputs: m.supports_structured_outputs === true,
          supportsResponseFormat: m.supports_response_format === true,
          toolChoiceModes: m.tool_choice_modes ?? [],
          inputModalities: m.input_modalities ?? [],
          pricing: m.pricing,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  async function refreshOpenRouterModels() {
    const toastId = toast.loading("Refreshing OpenRouter models...");
    try {
      const result = await refetchOpenRouterModels();
      if (result.error) throw result.error;
      toast.success(`OpenRouter models refreshed (${result.data?.length ?? 0})`, { id: toastId });
    } catch (e) {
      toast.error(`Failed to refresh models: ${(e as Error).message}`, { id: toastId });
    }
  }

  const savedGoogleKey = unwrap(configData?.config?.GOOGLE_AI_API_KEY);
  const savedAnthropicKey = unwrap(configData?.config?.ANTHROPIC_API_KEY);
  const savedOpenaiKey = unwrap(configData?.config?.OPENAI_API_KEY);
  const savedModels = (configData?.config?.AI_MODELS as Record<string, unknown>)?.value ?? configData?.config?.AI_MODELS;
  const savedModelsJson = savedModels ? JSON.stringify(savedModels, null, 2) : "";
  const savedTaskModels = ((configData?.config?.AI_TASK_MODELS as Record<string, unknown>)?.value ?? configData?.config?.AI_TASK_MODELS ?? {}) as Record<string, string>;
  const savedDisplayNames = ((configData?.config?.AI_MODEL_DISPLAY_NAMES as Record<string, unknown>)?.value ?? configData?.config?.AI_MODEL_DISPLAY_NAMES ?? {}) as Record<string, string>;
  const isDirty = loaded && (
    openRouterKey !== savedOpenRouterKey ||
    googleKey !== savedGoogleKey ||
    anthropicKey !== savedAnthropicKey ||
    openaiKey !== savedOpenaiKey ||
    modelsJson !== savedModelsJson ||
    JSON.stringify(taskModels) !== JSON.stringify(savedTaskModels) ||
    JSON.stringify(displayNames) !== JSON.stringify(savedDisplayNames)
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> AI Models &amp; API Keys
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          All AI calls go through OpenRouter. Choose which model to use for each task below.
          Model IDs use the format <code className="text-[10px]">provider/model-name</code> (e.g. <code className="text-[10px]">google/gemini-2.0-flash-001</code>).
        </p>

        {/* OpenRouter API Key */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">OpenRouter API Key</Label>
          <div className="relative max-w-md">
            <Input
              type={showOpenRouter ? "text" : "password"}
              value={openRouterKey}
              onChange={(e) => setOpenRouterKey(e.target.value)}
              placeholder="sk-or-…"
              className="h-8 text-xs pr-16 font-mono"
            />
            <div className="absolute right-8 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums pointer-events-none">
              {openRouterKey.length > 0 ? `${openRouterKey.length}c` : ""}
            </div>
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowOpenRouter((v) => !v)}>
              {showOpenRouter ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            A valid OpenRouter key is 73 characters (sk-or-v1- + 64 hex chars). Toggle the eye icon to verify the full key is visible.
          </p>
        </div>

        {/* Task Model Selection */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs font-medium">Model per Task</Label>
            {fetchingModels && (
              <span className="text-[10px] text-muted-foreground">
                {loadingModels ? "Loading models..." : "Refreshing models..."}
              </span>
            )}
            {savedOpenRouterKey && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Refresh model list from OpenRouter"
                aria-label="Refresh model list from OpenRouter"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                disabled={fetchingModels}
                onClick={refreshOpenRouterModels}
              >
                <RefreshCw className={`h-3 w-3 ${fetchingModels ? "animate-spin" : ""}`} />
              </Button>
            )}
            {modelsError && (
              <span className="text-[10px] text-destructive">
                Failed to load models: {(modelsError as Error).message}
              </span>
            )}
            {!savedOpenRouterKey && (
              <span className="text-[10px] text-muted-foreground">Save an OpenRouter API key to load model list</span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {Object.entries(TASK_MODEL_LABELS).map(([key, { label, description, defaultModel, requiresTools, requiresVision, requiresStructuredOutput, fallbackKey, providerPinKey }]) => {
              const currentVal = taskModels[key] || "";
              const modelList = openRouterModels ?? [];
              const modelMeetsRequirements = (m: typeof modelList[number] | undefined) => {
                if (!m) return false;
                if (requiresTools && !m.supportsTools) return false;
                if (requiresStructuredOutput && !(m.supportsTools || m.supportsStructuredOutputs || m.supportsResponseFormat)) return false;
                if (requiresVision && !m.inputModalities.includes("image")) return false;
                return true;
              };
              const requirementLabel = requiresStructuredOutput
                ? "image input plus tool calls, structured outputs, or JSON mode"
                : requiresTools
                  ? "tool use"
                  : requiresVision
                    ? "image input"
                    : "";
              const filteredList = (requiresTools || requiresStructuredOutput || requiresVision)
                ? modelList.filter(modelMeetsRequirements)
                : modelList;
              // If currentVal is set but not in filteredList, still show it (with a warning)
              const currentModelMeetsRequirements = !currentVal || !(requiresTools || requiresStructuredOutput || requiresVision) || modelMeetsRequirements(modelList.find((m) => m.id === currentVal));
              const allOptions = currentVal && !filteredList.some((m) => m.id === currentVal)
                ? [{ id: currentVal, name: currentVal, supportsTools: false, supportsStructuredOutputs: false, supportsResponseFormat: false, toolChoiceModes: [], inputModalities: [] }, ...filteredList]
                : filteredList;

              const fallbackVal = fallbackKey ? (taskModels[fallbackKey] || "") : "";
              const fallbackOptions = fallbackKey
                ? (fallbackVal && !filteredList.some((m) => m.id === fallbackVal)
                  ? [{ id: fallbackVal, name: fallbackVal, supportsTools: false, supportsStructuredOutputs: false, supportsResponseFormat: false, toolChoiceModes: [], inputModalities: [] }, ...filteredList]
                  : filteredList)
                : [];

              const renderSelect = (selectKey: string, value: string, options: typeof filteredList, placeholder: string) => (
                filteredList.length > 0 ? (
                  <Select value={value} onValueChange={(val) => setTaskModels((prev) => ({ ...prev, [selectKey]: val }))}>
                    <SelectTrigger className="h-8 text-xs font-mono">
                      <SelectValue placeholder={placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((m) => {
                        const modeLabel = requiresStructuredOutput
                          ? m.supportsTools
                            ? m.toolChoiceModes.includes("named") ? " (tool named)" : m.toolChoiceModes.includes("required") ? " (tool required)" : " (tool auto)"
                            : m.supportsStructuredOutputs
                              ? " (schema)"
                              : m.supportsResponseFormat
                                ? " (json)"
                                : ""
                          : "";
                        return (
                          <SelectItem key={m.id} value={m.id} className="text-xs font-mono" suffix={formatOpenRouterPricing(m.pricing)}>
                            {displayNames[m.id] || m.id}{modeLabel}{!modelMeetsRequirements(m) && requirementLabel ? " ⚠" : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={value}
                    onChange={(e) => setTaskModels((prev) => ({ ...prev, [selectKey]: e.target.value }))}
                    placeholder={loadingModels ? "Loading models…" : placeholder}
                    className="h-8 text-xs font-mono"
                    disabled={loadingModels}
                  />
                )
              );

              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <Label className="text-xs">{label}</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={`Copy model-selection brief for ${label}`}
                      aria-label={`Copy model-selection brief for ${label}`}
                      className="h-5 w-5 text-muted-foreground hover:text-foreground"
                      onClick={() => copyTaskBrief(key, label)}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  {renderSelect(key, currentVal, allOptions, defaultModel)}
                  {!currentModelMeetsRequirements && requirementLabel && (
                    <p className="text-[10px] text-destructive">This model does not support {requirementLabel}; this task will fail. Select a different model.</p>
                  )}
                  {fallbackKey && (
                    <div className="mt-1.5 space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Fallback model (on content filter / provider rejection)</Label>
                      {renderSelect(fallbackKey, fallbackVal, fallbackOptions, "None — mark as failed")}
                      {fallbackVal && !modelMeetsRequirements(modelList.find((m) => m.id === fallbackVal)) && modelList.length > 0 && requirementLabel && (
                        <p className="text-[10px] text-destructive">Fallback model does not support {requirementLabel}.</p>
                      )}
                    </div>
                  )}
                  {providerPinKey && (
                    <div className="mt-1.5 space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Pin OpenRouter endpoint (optional)</Label>
                      <Input
                        value={taskModels[providerPinKey] || ""}
                        onChange={(e) => setTaskModels((prev) => ({ ...prev, [providerPinKey]: e.target.value }))}
                        placeholder="e.g. anthropic  (comma-separate for a short allow-list)"
                        className="h-8 text-xs font-mono"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Provider slug(s) to force for this model. When set, fallbacks are disabled so a flaky endpoint hard-fails instead of silently rerouting. Leave blank for normal OpenRouter routing. Find the winning/failing slug in the Vision Bake-Off provider-patterns table.
                      </p>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">{description}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legacy Keys (collapsed) */}
        <div className="border-t pt-3">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowLegacyKeys((v) => !v)}
          >
            {showLegacyKeys ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Legacy Direct API Keys (fallback)
          </button>
          {showLegacyKeys && (
            <div className="grid gap-3 sm:grid-cols-3 mt-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Google AI API Key</Label>
                <div className="relative">
                  <Input
                    type={showGoogle ? "text" : "password"}
                    value={googleKey}
                    onChange={(e) => setGoogleKey(e.target.value)}
                    placeholder="AIza…"
                    className="h-8 text-xs pr-8 font-mono"
                  />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowGoogle((v) => !v)}>
                    {showGoogle ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Anthropic API Key</Label>
                <div className="relative">
                  <Input
                    type={showAnthropic ? "text" : "password"}
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    placeholder="sk-ant-…"
                    className="h-8 text-xs pr-8 font-mono"
                  />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowAnthropic((v) => !v)}>
                    {showAnthropic ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">OpenAI API Key</Label>
                <div className="relative">
                  <Input
                    type={showOpenai ? "text" : "password"}
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-proj-…"
                    className="h-8 text-xs pr-8 font-mono"
                  />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowOpenai((v) => !v)}>
                    {showOpenai ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Model catalog JSON (collapsed) */}
        <div className="border-t pt-3">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowLegacyKeys((v) => !v)}
          >
            Agent Model Catalog (JSON)
          </button>
          <div className="space-y-1.5 mt-2">
            <Textarea
              value={modelsJson}
              onChange={(e) => handleModelsChange(e.target.value)}
              placeholder={DEFAULT_MODELS_PLACEHOLDER}
              className="font-mono text-xs min-h-[100px] resize-y"
              spellCheck={false}
            />
            {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
            <p className="text-[10px] text-muted-foreground">
              Model catalog sent to bridge/Windows agents via heartbeat for PDF text extraction.
            </p>
          </div>
        </div>

        <Button
          size="sm"
          className="gap-1.5 h-8 text-xs"
          onClick={() => save.mutate()}
          disabled={save.isPending || !!jsonError || !isDirty}
        >
          <Save className="h-3.5 w-3.5" />
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── AI Tagging Instructions Section ─────────────────────────────────

const MAX_INSTRUCTIONS_LENGTH = 2000;

export function AiTaggingInstructionsSection() {
  const { call } = useAdminApi();
  const [instructions, setInstructions] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: savedValue } = useQuery({
    queryKey: ["tagging-instructions"],
    queryFn: async () => {
      const result = await call("get-config", { keys: ["TAGGING_INSTRUCTIONS"] });
      const raw = result?.config?.TAGGING_INSTRUCTIONS?.value ?? result?.config?.TAGGING_INSTRUCTIONS;
      return typeof raw === "string" ? raw : "";
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (savedValue !== undefined && !loaded) {
      setInstructions(savedValue);
      setLoaded(true);
    }
  }, [savedValue, loaded]);

  const isDirty = loaded && instructions !== (savedValue ?? "");

  async function save() {
    setSaving(true);
    try {
      await call("set-config", { entries: { TAGGING_INSTRUCTIONS: instructions } });
      toast.success("Tagging instructions saved");
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> AI Tagging Instructions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          These instructions are sent to the AI on every tag operation. Use them to teach the AI about your products, naming conventions, and tagging preferences.
        </p>
        <Textarea
          value={instructions}
          onChange={(e) => {
            if (e.target.value.length <= MAX_INSTRUCTIONS_LENGTH) {
              setInstructions(e.target.value);
            }
          }}
          placeholder={`Enter custom tagging instructions for your organization.\n\nExamples:\n- Files with 'BGM' in the SKU are bedroom decor items\n- 'foam wall decor' should always be tagged: foam, wall-decor, 3d\n- When you see Snoopy lying on his doghouse, tag as: snoopy-sleeping\n- Products showing a room scene should be tagged: lifestyle\n- Art files showing characters only (no background) tag as: character-only`}
          className="min-h-[160px] text-sm font-mono bg-background"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {instructions.length} / {MAX_INSTRUCTIONS_LENGTH}
          </span>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={save}
            disabled={saving || !isDirty}
            title={!isDirty ? "No unsaved changes" : saving ? "Saving…" : undefined}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save Instructions"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Character Stats Section ──────────────────────────────────────────

export function CharacterStatsSection() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [threshold, setThreshold] = useState(3);

  const { data: charStats } = useQuery({
    queryKey: ["character-stats"],
    queryFn: async () => {
      const [{ count: total }, { count: priority }] = await Promise.all([
        supabase.from("characters").select("*", { count: "exact", head: true }),
        supabase.from("characters").select("*", { count: "exact", head: true }).eq("is_priority", true),
      ]);
      return { total: total ?? 0, priority: priority ?? 0 };
    },
  });

  const rebuildMutation = useMutation({
    mutationFn: () => call("rebuild-character-stats", { threshold }),
    onSuccess: (data) => {
      toast.success(`${data.priority_characters} priority characters flagged (threshold: ${data.threshold}+ assets)`);
      queryClient.invalidateQueries({ queryKey: ["character-stats"] });
      queryClient.invalidateQueries({ queryKey: ["taxonomy-data"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4" /> Character Priority Stats
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Characters appearing frequently in tagged assets are flagged as "priority" and sent to the AI first for more accurate matching. Run this after a full scan + AI tag pass.
        </p>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="font-mono text-xs">
            {charStats?.priority ?? "—"} priority
          </Badge>
          <span className="text-xs text-muted-foreground">out of</span>
          <Badge variant="outline" className="font-mono text-xs">
            {charStats?.total ?? "—"} total characters
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <Label className="text-xs whitespace-nowrap">Flag characters appearing in</Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={threshold}
            onChange={(e) => setThreshold(Math.max(1, Math.min(20, parseInt(e.target.value) || 3)))}
            className="w-16 h-8 text-sm text-center font-mono"
          />
          <Label className="text-xs whitespace-nowrap">or more assets as priority</Label>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => rebuildMutation.mutate()}
          disabled={rebuildMutation.isPending} title={rebuildMutation.isPending ? "Rebuilding…" : undefined}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${rebuildMutation.isPending ? "animate-spin" : ""}`} />
          {rebuildMutation.isPending ? "Rebuilding…" : "Rebuild Stats"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Export ───────────────────────────────────────────────────────────

export default function ApisTab() {
  return (
    <div className="space-y-4">
      <TaxonomyApiSection />
    </div>
  );
}
