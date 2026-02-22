import { useState } from "react";
import { Globe, RefreshCw, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const API_BASE = "https://api.sandbox.designflow.app/api/autofill/properties-and-characters";

interface LicensorInfo {
  code: string;
  name: string;
  endpoint: string;
}

const LICENSORS: LicensorInfo[] = [
  { code: "DS", name: "Disney", endpoint: `${API_BASE}/DS` },
  { code: "MV", name: "Marvel", endpoint: `${API_BASE}/MV` },
  { code: "WWE", name: "WWE", endpoint: `${API_BASE}/WWE` },
];

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
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [expandedLicensor, setExpandedLicensor] = useState<string | null>(null);
  const [expandedProperty, setExpandedProperty] = useState<string | null>(null);

  // Fetch taxonomy data from DB — single parallel fetch, no N+1
  const { data: taxonomyData, isLoading } = useQuery({
    queryKey: ["taxonomy-data"],
    queryFn: async () => {
      // Fetch all rows — characters can exceed the default 1000-row limit
      const [licRes, propRes, charRes] = await Promise.all([
        supabase.from("licensors").select("id, name, external_id").order("name"),
        supabase.from("properties").select("id, name, external_id, licensor_id").order("name").limit(5000),
        supabase.from("characters").select("id, name, property_id").order("name").limit(10000),
      ]);
      if (licRes.error) throw licRes.error;
      if (propRes.error) throw propRes.error;
      if (charRes.error) throw charRes.error;

      // Group characters by property_id
      const charsByProp = new Map<string, { id: string; name: string }[]>();
      for (const c of charRes.data || []) {
        const list = charsByProp.get(c.property_id) || [];
        list.push({ id: c.id, name: c.name });
        charsByProp.set(c.property_id, list);
      }

      // Group properties by licensor_id
      const propsByLic = new Map<string, PropertyRow[]>();
      for (const p of propRes.data || []) {
        const list = propsByLic.get(p.licensor_id) || [];
        list.push({ id: p.id, name: p.name, external_id: p.external_id, characters: charsByProp.get(p.id) || [] });
        propsByLic.set(p.licensor_id, list);
      }

      return (licRes.data || []).map((lic) => ({
        ...lic,
        properties: propsByLic.get(lic.id) || [],
      }));
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (code?: string | undefined) => {
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
        body: JSON.stringify(code ? { action: "sync-one", licensor_code: code } : { action: "sync-all" }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      return resp.json();
    },
    onSuccess: (data) => {
      const summary = data.summary || data.result;
      toast.success(`Sync complete: ${summary?.totalProperties ?? summary?.propertiesUpserted ?? 0} properties, ${summary?.totalCharacters ?? summary?.charactersUpserted ?? 0} characters`);
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
          onClick={() => syncMutation.mutate(undefined)}
          disabled={syncMutation.isPending}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          {syncMutation.isPending ? "Syncing..." : "Sync All"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="flex items-center gap-3 text-xs">
          <Badge variant="secondary" className="font-mono">{licensors.length} Licensors</Badge>
          <Badge variant="secondary" className="font-mono">{totalProps} Properties</Badge>
          <Badge variant="secondary" className="font-mono">{totalChars} Characters</Badge>
        </div>

        {/* API Endpoints */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Source Endpoints</p>
          {LICENSORS.map((lic) => (
            <div key={lic.code} className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="outline" className="text-[10px] shrink-0">{lic.code}</Badge>
                <code className="text-xs font-mono text-muted-foreground truncate">{lic.endpoint}</code>
                <a href={lic.endpoint} target="_blank" rel="noopener noreferrer" className="shrink-0">
                  <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </a>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs shrink-0"
                onClick={() => syncMutation.mutate(lic.code)}
                disabled={syncMutation.isPending}
              >
                Sync
              </Button>
            </div>
          ))}
        </div>

        {/* Fetched Data Tree */}
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

// ── Export ───────────────────────────────────────────────────────────

export default function ApisTab() {
  return (
    <div className="space-y-4">
      <TaxonomyApiSection />
    </div>
  );
}
