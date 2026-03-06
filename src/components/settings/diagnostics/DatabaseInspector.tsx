import { useState } from "react";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Database, Play, Loader2 } from "lucide-react";

function formatCellValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(val)) {
      try {
        return new Date(val).toLocaleDateString("en-US", {
          year: "numeric", month: "short", day: "numeric",
        });
      } catch { return val; }
    }
    return val;
  }
  if (typeof val === "number") return val.toLocaleString();
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

const QUICK_QUERIES = [
  { label: "Asset count by is_licensed", sql: "SELECT is_licensed, COUNT(*) as count FROM assets GROUP BY is_licensed" },
  { label: "Asset count by workflow_status", sql: "SELECT workflow_status, COUNT(*) as count FROM assets GROUP BY workflow_status ORDER BY count DESC" },
  { label: "Recent assets", sql: "SELECT relative_path, is_licensed, workflow_status, created_at FROM assets ORDER BY created_at DESC LIMIT 50" },
  { label: "Assets with no thumbnail", sql: "SELECT relative_path, thumbnail_error FROM assets WHERE thumbnail_url IS NULL AND is_deleted = false LIMIT 100" },
  { label: "Admin config", sql: "SELECT key, value, updated_at FROM admin_config ORDER BY key" },
];

export function DatabaseInspector() {
  const { call } = useAdminApi();
  const [sql, setSql] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [rowCount, setRowCount] = useState<number>(0);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  async function runQuery(queryText?: string) {
    const q = (queryText ?? sql).trim();
    if (!q) return;
    if (!/^select\s/i.test(q)) {
      setQueryError("Only SELECT queries are allowed.");
      setRows(null);
      return;
    }
    setIsRunning(true);
    setQueryError(null);
    setRows(null);
    try {
      const data = await call("run-query", { sql: q });
      setRows(data.rows ?? []);
      setRowCount(data.count ?? 0);
    } catch (e: any) {
      setQueryError(e.message || "Query failed");
    } finally {
      setIsRunning(false);
    }
  }

  function selectQuickQuery(q: typeof QUICK_QUERIES[number]) {
    setSql(q.sql);
    runQuery(q.sql);
  }

  const columns = rows && rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-4 w-4" /> Database Inspector
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Read-only. SELECT queries only.</p>

        <div className="flex flex-wrap gap-1.5">
          {QUICK_QUERIES.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => selectQuickQuery(q)}
              className="px-2.5 py-1 text-xs rounded-full border border-border bg-muted/50 text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              {q.label}
            </button>
          ))}
        </div>

        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="SELECT * FROM assets LIMIT 10"
          className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runQuery(); }}
        />

        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm" className="gap-1.5"
            onClick={() => runQuery()}
            disabled={isRunning || !sql.trim()}
          >
            {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run Query
          </Button>
          {rows !== null && (
            <span className="text-xs text-muted-foreground">{rowCount} row{rowCount !== 1 ? "s" : ""} returned</span>
          )}
        </div>

        {queryError && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-md p-2 text-xs text-destructive font-mono whitespace-pre-wrap">
            {queryError}
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="border border-border rounded-md overflow-x-auto max-h-[400px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead key={col} className="text-xs font-mono whitespace-nowrap">{col}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i}>
                    {columns.map((col) => (
                      <TableCell key={col} className="text-xs font-mono max-w-[300px] truncate">
                        {row[col] === null
                          ? <span className="text-muted-foreground italic">null</span>
                          : formatCellValue(row[col])
                        }
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {rows && rows.length === 0 && !queryError && (
          <p className="text-xs text-muted-foreground">Query returned 0 rows.</p>
        )}
      </CardContent>
    </Card>
  );
}
