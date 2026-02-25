import { useState, useEffect } from "react";
import { Globe, RefreshCw, ChevronDown, ChevronRight, ExternalLink, Sparkles, Save, Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
      const raw = result?.config?.TAXONOMY_SYNC_CONFIG?.value;
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
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-external`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
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
            <Button size="sm" onClick={handleAdd} disabled={saving}>
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
      async function fetchAll(table: string, select: string, orderCol: string) {
        const PAGE = 1000;
        const all: Record<string, unknown>[] = [];
        let from = 0;
        while (true) {
          const { data, error } = await supabase
            .from(table as "licensors")
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
        fetchAll("licensors", "id, name, external_id", "name"),
        fetchAll("properties", "id, name, external_id, licensor_id", "name"),
        fetchAll("characters", "id, name, property_id", "name"),
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

  const syncAllMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-external`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ action: "sync-all" }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      return resp.json();
    },
    onSuccess: (data) => {
      const summary = data.summary;
      toast.success(`Sync complete: ${summary?.totalProperties ?? 0} properties, ${summary?.totalCharacters ?? 0} characters`);
      queryClient.invalidateQueries({ queryKey: ["taxonomy-data"] });
    },
    onError: (e) => toast.error(`Sync failed: ${e.message}`),
  });

  const licensors = taxonomyData || [];
  const totalProps = licensors.reduce((s, l) => s + l.properties.length, 0);
  const totalChars = licensors.reduce((s, l) => s + l.properties.reduce((ps, p) => ps + p.characters.length, 0), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4" /> Taxonomy APIs (Licensors / Properties / Characters)
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncAllMutation.mutate()}
          disabled={syncAllMutation.isPending}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncAllMutation.isPending ? "animate-spin" : ""}`} />
          {syncAllMutation.isPending ? "Syncing..." : "Sync All"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 text-xs">
          <Badge variant="secondary" className="font-mono">{licensors.length} Licensors</Badge>
          <Badge variant="secondary" className="font-mono">{totalProps} Properties</Badge>
          <Badge variant="secondary" className="font-mono">{totalChars} Characters</Badge>
        </div>

        <TaxonomySourceEditor />

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading taxonomy data...</p>
        ) : licensors.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No taxonomy data yet. Click "Sync All" to fetch from APIs.</p>
        ) : (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fetched Data</p>
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

// ── AI Tagging Instructions Section ─────────────────────────────────

const MAX_INSTRUCTIONS_LENGTH = 2000;

function AiTaggingInstructionsSection() {
  const { call } = useAdminApi();
  const [instructions, setInstructions] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: savedValue } = useQuery({
    queryKey: ["tagging-instructions"],
    queryFn: async () => {
      const result = await call("get-config", { keys: ["TAGGING_INSTRUCTIONS"] });
      const raw = result?.config?.TAGGING_INSTRUCTIONS?.value;
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
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save Instructions"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Export ───────────────────────────────────────────────────────────

export default function ApisTab() {
  return (
    <div className="space-y-4">
      <TaxonomyApiSection />
      <AiTaggingInstructionsSection />
    </div>
  );
}
