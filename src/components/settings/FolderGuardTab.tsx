/** Folder name guard (u2giants/popdam3#963, plan Phase 6). Read-only list; no renaming here. */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { folderGuard } from "../../../supabase/functions/_shared/folder-rules/guard.mjs";
import rules from "../../../supabase/functions/_shared/folder-rules/rules.json";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw } from "lucide-react";
import { formatDateTime } from "@/lib/format-date";

interface Rename { old_path: string; new_path: string; rule: string }
interface Over { folder: string; files_over: number; longest: number; longest_after_rules: number; suggested_path: string }
interface Report {
  generated_at: string; target_max_path: number; files_checked: number; folders_checked: number; files_over: number;
  rule_breaking_total: number; over_length_total: number; attention_total: number;
  rule_breaking: Rename[]; over_length: Over[];
}

const ROOT = "Decor/Character Licensed/____New Structure/";
const short = (p: string) => (p.startsWith(ROOT) ? p.slice(ROOT.length) : p);

// Reads every live file path under the design tree (16 parallel id ranges) and
// checks it in the browser with the same rule engine as the rename planner.
async function loadReport(): Promise<Report> {
  const PAGE = 1000;
  const hex = "0123456789abcdef";
  const like = `${rules.root.replace(/_/g, "\\_")}/%`;
  const paths: string[] = [];
  await Promise.all(
    Array.from({ length: 16 }, async (_, i) => {
      const hi = i < 15 ? `${hex[i + 1]}0000000-0000-0000-0000-000000000000` : null;
      let after = `${hex[i]}0000000-0000-0000-0000-000000000000`;
      let first = true;
      for (;;) {
        let qb = supabase.from("assets").select("id, relative_path").eq("is_deleted", false).like("relative_path", like);
        qb = first ? qb.gte("id", after) : qb.gt("id", after);
        if (hi) qb = qb.lt("id", hi);
        const { data, error } = await qb.order("id").limit(PAGE);
        if (error) throw new Error(error.message);
        for (const r of data ?? []) paths.push(r.relative_path);
        if (!data || data.length < PAGE) return;
        after = data[data.length - 1].id;
        first = false;
      }
    }),
  );
  return { generated_at: new Date().toISOString(), ...folderGuard(paths, rules, { limit: 200 }) } as Report;
}

export default function FolderGuardTab() {
  const q = useQuery({
    queryKey: ["folder-guard-report"],
    queryFn: loadReport,
    staleTime: 5 * 60_000,
  });
  const r = q.data;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Folder names</CardTitle>
        <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Check now
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Folders under the design tree that break the naming rules, or hold files whose location is too long for
          Windows programs. Suggested names only — nothing is renamed from this screen.
        </p>
        {q.isLoading && <p><Loader2 className="inline h-4 w-4 animate-spin" /> Checking every file…</p>}
        {q.error && <p className="text-destructive">{String((q.error as Error).message)}</p>}
        {r && (
          <>
            <p data-testid="folder-guard-summary">
              Checked {r.files_checked.toLocaleString()} files in {r.folders_checked.toLocaleString()} folders at{" "}
              {formatDateTime(r.generated_at)}. {r.rule_breaking_total.toLocaleString()} folders break the naming rules;{" "}
              {r.over_length_total.toLocaleString()} folders hold {r.files_over.toLocaleString()} files longer than{" "}
              {r.target_max_path} characters.
            </p>
            <h3 className="font-medium">Folders that break the naming rules (first {r.rule_breaking.length})</h3>
            <Table>
              <TableHeader><TableRow><TableHead>Folder</TableHead><TableHead>Suggested</TableHead><TableHead>Rule</TableHead></TableRow></TableHeader>
              <TableBody>
                {r.rule_breaking.map((x) => (
                  <TableRow key={x.old_path}>
                    <TableCell className="font-mono text-xs">{short(x.old_path)}</TableCell>
                    <TableCell className="font-mono text-xs">{short(x.new_path)}</TableCell>
                    <TableCell className="text-xs">{x.rule}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <h3 className="font-medium">Folders with files over {r.target_max_path} characters (longest first, first {r.over_length.length})</h3>
            <Table>
              <TableHeader><TableRow><TableHead>Folder</TableHead><TableHead>Files</TableHead><TableHead>Longest</TableHead><TableHead>After rules</TableHead><TableHead>Suggested folder</TableHead></TableRow></TableHeader>
              <TableBody>
                {r.over_length.map((x) => (
                  <TableRow key={x.folder}>
                    <TableCell className="font-mono text-xs">{short(x.folder)}</TableCell>
                    <TableCell>{x.files_over}</TableCell>
                    <TableCell>{x.longest}</TableCell>
                    <TableCell className={x.longest_after_rules > r.target_max_path ? "text-destructive" : ""}>{x.longest_after_rules}</TableCell>
                    <TableCell className="font-mono text-xs">{short(x.suggested_path)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
