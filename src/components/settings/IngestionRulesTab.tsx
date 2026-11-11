import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RotateCcw, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatDateTime } from "@/lib/format-date";
import {
  EXCLUDED_FOLDER_PREFIXES, EXCLUDED_FOLDERS, explainIngestion, IMAGE_KEYWORDS, type IngestionRule,
  type IngestionRuleKind, PDF_KEYWORDS, validateIngestionRuleValue,
} from "@/lib/ingestion-rules";

interface Stored {
  revision: number;
  rules: IngestionRule[];
  history: { revision: number; at: string; summary: string; rules_before: IngestionRule[] }[];
}

const KIND_LABELS: Record<IngestionRuleKind, string> = {
  pdf_include: "Also ingest PDFs whose name contains",
  image_include: "Also ingest PNG/JPG images whose name contains",
  filename_exclude: "Never ingest files whose name contains",
  folder_exclude: "Never ingest anything inside a folder named",
};

/** The first NAS agent version that applies added rules. */
const RULES_AGENT_VERSION = [1, 16, 21];

function agentAppliesRules(version: unknown): boolean {
  const parts = String(version ?? "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((parts[i] || 0) !== RULES_AGENT_VERSION[i]) return (parts[i] || 0) > RULES_AGENT_VERSION[i];
  }
  return true;
}

function Chips({ items }: { items: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => <Badge key={item} variant="secondary" className="font-mono font-normal">{item}</Badge>)}
    </div>
  );
}

function BuiltIn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 border-b border-border pb-3 last:border-0 last:pb-0">
      <p className="text-sm font-medium">{title}</p>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

export default function IngestionRulesTab() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<IngestionRuleKind>("pdf_include");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [testPath, setTestPath] = useState("");
  const [impact, setImpact] = useState<{ value: string; count: number | null } | null>(null);

  const rulesQuery = useQuery({ queryKey: ["ingestion-rules"], queryFn: () => call<Stored>("get-ingestion-rules") });
  const configQuery = useQuery({
    queryKey: ["ingestion-rules-config"],
    queryFn: () => call("get-config", { keys: ["SCAN_MIN_DATE", "SCAN_ALLOWED_SUBFOLDERS"] }),
  });
  const agentsQuery = useQuery({ queryKey: ["ingestion-rules-agents"], queryFn: () => call("list-agents") });

  const rules = useMemo(() => rulesQuery.data?.rules ?? [], [rulesQuery.data]);
  const minDate = configQuery.data?.config?.SCAN_MIN_DATE?.value as string | undefined;
  const subfolders = (configQuery.data?.config?.SCAN_ALLOWED_SUBFOLDERS?.value ?? []) as string[];
  const bridgeAgents = ((agentsQuery.data?.agents ?? []) as Record<string, any>[])
    .filter((a) => a.type === "bridge")
    .sort((a, b) => String(b.last_heartbeat ?? "").localeCompare(String(a.last_heartbeat ?? "")));
  // Retired registrations linger, so only the most recently active agent counts.
  const outdatedAgent = bridgeAgents[0] && !agentAppliesRules(bridgeAgents[0].version_info?.version);

  const save = useMutation({
    mutationFn: (input: { rules: IngestionRule[]; summary: string }) =>
      call<Stored>("save-ingestion-rules", {
        rules: input.rules,
        summary: input.summary,
        expected_revision: rulesQuery.data?.revision ?? 0,
      }, { maxRetries: 0 }),
    onSuccess: (data, input) => {
      queryClient.setQueryData(["ingestion-rules"], data);
      toast.success(input.summary);
    },
    onError: (e) => {
      toast.error((e as Error).message);
      void rulesQuery.refetch();
    },
  });

  const problem = value.trim() ? validateIngestionRuleValue(kind, value) : null;
  const duplicate = rules.some((r) => r.kind === kind && r.value === value.trim().toLowerCase());
  const isExclusion = kind === "filename_exclude" || kind === "folder_exclude";
  const verdict = useMemo(() => (testPath.trim() ? explainIngestion(testPath.trim(), rules) : null), [testPath, rules]);

  const add = () => {
    const clean = value.trim().toLowerCase();
    save.mutate(
      {
        rules: [...rules, {
          id: crypto.randomUUID(),
          kind,
          value: clean,
          enabled: true,
          ...(note.trim() ? { note: note.trim() } : {}),
          created_at: new Date().toISOString(),
        }],
        summary: `Added: ${KIND_LABELS[kind]} "${clean}"`,
      },
      { onSuccess: () => { setValue(""); setNote(""); setImpact(null); } },
    );
  };

  const checkImpact = async () => {
    const clean = value.trim();
    try {
      const data = await call("preview-ingestion-exclusion", { kind, value: clean });
      setImpact({ value: clean, count: data.count });
    } catch {
      setImpact({ value: clean, count: null });
    }
  };

  return (
    <div className="space-y-4">
      {outdatedAgent && (
        <Card className="border-warning/50">
          <CardContent className="pt-4 text-sm">
            The NAS agent has not been updated yet, so it follows only the built-in rules. Rules you add here take effect after its update.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Built-in rules</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <BuiltIn title="Always ingested"><Chips items={[".psd", ".ai"]} /></BuiltIn>
          <BuiltIn title="PDFs: only if the name contains any of these"><Chips items={PDF_KEYWORDS} /></BuiltIn>
          <BuiltIn title="PNG, JPG, JPEG: only if the name contains any of these"><Chips items={IMAGE_KEYWORDS} /></BuiltIn>
          <BuiltIn title="PDFs in a style folder with no art file">
            Under "____New Structure", any PDF sitting directly in a style's own folder is ingested when that folder has no .ai or .psd file.
          </BuiltIn>
          <BuiltIn title="AI files with a matching PDF">
            An .ai file is skipped when a PDF with the same name is in the same folder.
          </BuiltIn>
          <BuiltIn title="Date cutoff">
            {minDate ? `Files last modified before ${minDate} are skipped.` : "No date cutoff is set."}
          </BuiltIn>
          <BuiltIn title="Decor subfolders">
            {subfolders.length ? <Chips items={subfolders} /> : "All subfolders are allowed."}
          </BuiltIn>
          <BuiltIn title="Folders always skipped">
            <p className="mb-1">Names starting with {EXCLUDED_FOLDER_PREFIXES.join(" ")} and also ___old, plus:</p>
            <Chips items={EXCLUDED_FOLDERS} />
          </BuiltIn>
          <BuiltIn title="Other files always skipped">
            Shortcuts (symbolic links), and every other file type. Adding a new file type needs a software change, because previews and the library must support it first.
          </BuiltIn>
          <p className="text-xs text-muted-foreground">
            Date cutoff and subfolders are edited under NAS & Folders and Scanning. PopSG style guides have their own separate rules.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Your added rules</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {rulesQuery.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {rulesQuery.isError && <p className="text-sm text-destructive">Could not load the rules. Nothing has changed.</p>}
          {rulesQuery.isSuccess && rules.length === 0 && <p className="text-sm text-muted-foreground">None yet. Only the built-in rules apply.</p>}
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-3 rounded border border-border p-2 text-sm">
              <Switch
                checked={rule.enabled}
                disabled={save.isPending}
                aria-label={`Turn rule "${rule.value}" on or off`}
                onCheckedChange={(enabled) => save.mutate({
                  rules: rules.map((r) => (r.id === rule.id ? { ...r, enabled } : r)),
                  summary: `${enabled ? "Turned on" : "Turned off"}: "${rule.value}"`,
                })}
              />
              <div className={`flex-1 ${rule.enabled ? "" : "opacity-50"}`}>
                {KIND_LABELS[rule.kind]} <span className="font-mono">"{rule.value}"</span>
                {rule.note && <p className="text-xs text-muted-foreground">{rule.note}</p>}
              </div>
              <Button
                variant="ghost"
                size="icon"
                disabled={save.isPending}
                aria-label={`Remove rule "${rule.value}"`}
                onClick={() => save.mutate({ rules: rules.filter((r) => r.id !== rule.id), summary: `Removed: "${rule.value}"` })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Add a rule</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <select
            aria-label="Rule type"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={kind}
            onChange={(e) => { setKind(e.target.value as IngestionRuleKind); setImpact(null); }}
          >
            {Object.entries(KIND_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <Input aria-label="Rule text" placeholder="Text to match" value={value} onChange={(e) => { setValue(e.target.value); setImpact(null); }} />
          <Input aria-label="Why this rule exists" placeholder="Why (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          {problem && <p className="text-sm text-destructive">{problem}</p>}
          {duplicate && <p className="text-sm text-destructive">This rule already exists.</p>}
          {impact && (
            <p className="text-sm text-muted-foreground">
              {impact.count === null
                ? "Could not count matching library files right now."
                : `About ${impact.count.toLocaleString()} files already in the library match. They stay in the library, but stop receiving updates from scans.`}
            </p>
          )}
          <div className="flex gap-2">
            {isExclusion && (
              <Button variant="outline" disabled={!value.trim() || !!problem} onClick={() => void checkImpact()}>Check impact</Button>
            )}
            <Button disabled={!value.trim() || !!problem || duplicate || save.isPending || !rulesQuery.isSuccess} onClick={add}>Add rule</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Rules apply from the next scan. No rule ever deletes a file or library record, and any change can be turned off or undone below.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Test a file</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input aria-label="File name or path to test" placeholder="Decor/Character Licensed/Tech Pack v2.pdf" value={testPath} onChange={(e) => setTestPath(e.target.value)} />
          {verdict && (
            <p className="flex items-center gap-2 text-sm">
              {verdict.ingested ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
              <span>{verdict.ingested ? "Would be ingested." : "Would be skipped."} {verdict.reason}</span>
            </p>
          )}
          <p className="text-xs text-muted-foreground">Checks the name and folders only, not the date cutoff, a matching PDF, or the other files in the folder.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Change history</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(rulesQuery.data?.history ?? []).length === 0 && <p className="text-sm text-muted-foreground">No changes yet.</p>}
          {(rulesQuery.data?.history ?? []).map((entry) => (
            <div key={entry.revision} className="flex items-center justify-between gap-3 text-sm">
              <span><span className="text-muted-foreground">{formatDateTime(entry.at)}</span> · {entry.summary}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={save.isPending}
                onClick={() => save.mutate({ rules: entry.rules_before, summary: `Undid: ${entry.summary}`.slice(0, 200) })}
              >
                <RotateCcw className="mr-1 h-3 w-3" /> Restore to before this
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
