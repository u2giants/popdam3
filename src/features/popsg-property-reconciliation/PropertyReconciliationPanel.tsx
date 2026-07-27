import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileLock2, Hash, Search, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PSG2_FIXTURE_ROWS } from "./generated-psg2-fixture";
import {
  APPROVED_BATCH,
  AT_RISK_RELATIONSHIP_COUNT,
  AT_RISK_EVIDENCE_SHA256,
  FROZEN_PROPOSAL_SHA256,
  assertPendingSetCanAdd,
  canPreparePending,
  isEffectivelyAmbiguous,
  preparePendingProposal,
  queueForDisposition,
  sha256Text,
  stableDecisionExport,
  type PendingProposal,
  type ReconciliationQueue,
  type ReconciliationRole,
  type ReconciliationRow,
} from "./contract";

const rows = PSG2_FIXTURE_ROWS as unknown as ReconciliationRow[];
const queueLabels: Record<ReconciliationQueue, string> = {
  needs_review: "Needs review",
  intentionally_untagged: "Intentionally untagged",
  mapped: "Mapped",
  create_approval_required: "Create approval required",
  licensor_unresolved: "Licensor unresolved",
};

function downloadText(filename: string, value: string) {
  const url = URL.createObjectURL(new Blob([value], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PropertyReconciliationPanel({ role }: { role: ReconciliationRole }) {
  const [queue, setQueue] = useState<ReconciliationQueue>("mapped");
  const [licensor, setLicensor] = useState("all");
  const [disposition, setDisposition] = useState("all");
  const [minimumFiles, setMinimumFiles] = useState("");
  const [ambiguityOnly, setAmbiguityOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Record<string, PendingProposal>>({});
  const [selected, setSelected] = useState<ReconciliationRow | null>(null);
  const [note, setNote] = useState("");
  const [exportHash, setExportHash] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(100);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (role !== "administrator") {
      setPending({});
      setSelected(null);
      setExportHash("");
      setActionError("");
    }
  }, [role]);

  useEffect(() => {
    setVisibleLimit(100);
  }, [ambiguityOnly, disposition, licensor, minimumFiles, queue, search]);

  const licensors = useMemo(
    () => [...new Set(rows.map((row) => row.licensorName))].sort((a, b) => a.localeCompare(b)),
    [],
  );
  const dispositions = useMemo(
    () => [...new Set(rows.map((row) => row.disposition))].sort((a, b) => a.localeCompare(b)),
    [],
  );
  const queueCounts = useMemo(() => {
    const result = {} as Record<ReconciliationQueue, { rows: number; files: number }>;
    for (const key of Object.keys(queueLabels) as ReconciliationQueue[]) {
      const subset = rows.filter((row) => queueForDisposition(row.disposition) === key);
      result[key] = {
        rows: subset.length,
        files: subset.reduce((sum, row) => sum + row.activeFileCount, 0),
      };
    }
    return result;
  }, []);
  const totals = useMemo(() => {
    const approvedRows = rows.filter((row) => row.batchId === APPROVED_BATCH.id);
    return {
      rows: rows.length,
      files: rows.reduce((sum, row) => sum + row.activeFileCount, 0),
      approvedRows: approvedRows.length,
      approvedFiles: approvedRows.reduce((sum, row) => sum + row.activeFileCount, 0),
    };
  }, []);
  const visibleRows = useMemo(() => {
    const min = Number(minimumFiles) || 0;
    const normalizedSearch = search.trim().toLowerCase();
    return rows
      .filter((row) => queueForDisposition(row.disposition) === queue)
      .filter((row) => licensor === "all" || row.licensorName === licensor)
      .filter((row) => disposition === "all" || row.disposition === disposition)
      .filter((row) => row.activeFileCount >= min)
      .filter((row) => !ambiguityOnly || isEffectivelyAmbiguous(row))
      .filter((row) =>
        !normalizedSearch ||
        row.observedValue.toLowerCase().includes(normalizedSearch) ||
        row.targetPropertyName?.toLowerCase().includes(normalizedSearch) ||
        row.targetPropertyCode?.toLowerCase().includes(normalizedSearch),
      )
      .sort((a, b) => b.activeFileCount - a.activeFileCount);
  }, [ambiguityOnly, disposition, licensor, minimumFiles, queue, search]);

  const pendingRows = Object.values(pending);
  const prepare = () => {
    try {
      if (!selected || !canPreparePending(role, selected)) {
        throw new Error("This row is not valid for the approved pending-proposal batch.");
      }
      const proposal = preparePendingProposal(role, selected, note);
      assertPendingSetCanAdd(pendingRows, proposal);
      setPending((current) => ({ ...current, [proposal.observationKey]: proposal }));
      setSelected(null);
      setNote("");
      setActionError("");
    } catch (error) {
      setActionError((error as Error).message);
    }
  };
  const exportPending = async () => {
    try {
      if (role !== "administrator") throw new Error("Only an administrator can export.");
      const output = stableDecisionExport(pendingRows);
      const hash = await sha256Text(output);
      setExportHash(hash);
      setActionError("");
      downloadText(`popsg-property-pending-${hash.slice(0, 12)}.json`, output);
    } catch (error) {
      setActionError((error as Error).message);
    }
  };

  return (
    <div className="space-y-5" data-testid="property-reconciliation">
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileLock2 className="h-4 w-4 text-amber-600" />
            Pending proposals only
          </CardTitle>
          <CardDescription>
            PSG-3 cannot change tags, master data, or the database. Activation is unavailable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="grid gap-2 md:grid-cols-3">
            <div className="rounded-md border bg-background/70 p-3">
              <p className="text-muted-foreground">Approved owner batch</p>
              <p className="mt-1 font-semibold">{APPROVED_BATCH.id}</p>
              <p>{APPROVED_BATCH.rowCount} values · {APPROVED_BATCH.activeFileCount.toLocaleString()} files</p>
            </div>
            <div className="rounded-md border bg-background/70 p-3 md:col-span-2">
              <p className="flex items-center gap-1 text-muted-foreground"><Hash className="h-3 w-3" /> Exact owner-approved SHA-256</p>
              <code className="mt-1 block break-all text-[11px]" data-testid="owner-hash">{APPROVED_BATCH.sha256}</code>
            </div>
          </div>
          <p className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            This approval excludes non-Property rows, create candidates, 6,961 at-risk removals,
            schema, rebuilds, deployment, and production.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["File occurrences", totals.files.toLocaleString(), "Frozen PSG-2 coverage"],
          ["Observed values", totals.rows.toLocaleString(), "Every value has one queue"],
          ["Approved baseline", totals.approvedFiles.toLocaleString(), `${totals.approvedRows} values in batch-01`],
          ["At-risk evidence", AT_RISK_RELATIONSHIP_COUNT.toLocaleString(), "Read-only and not approved"],
        ].map(([label, value, detail]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{value}</p>
              <p className="text-[11px] text-muted-foreground">{detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Reconciliation queues</CardTitle>
          <CardDescription>Each value appears in exactly one business state.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={queue} onValueChange={(value) => setQueue(value as ReconciliationQueue)}>
            <TabsList className="h-auto flex-wrap justify-start">
              {(Object.keys(queueLabels) as ReconciliationQueue[]).map((key) => (
                <TabsTrigger key={key} value={key} className="gap-1.5">
                  {queueLabels[key]}
                  <Badge variant="secondary" className="px-1.5">{queueCounts[key].rows}</Badge>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input aria-label="Search observations" placeholder="Search value or target" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-8" />
            </div>
            <select aria-label="Filter by licensor" value={licensor} onChange={(event) => setLicensor(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
              <option value="all">All licensors</option>
              {licensors.map((value) => <option key={value}>{value}</option>)}
            </select>
            <select aria-label="Filter by disposition" value={disposition} onChange={(event) => setDisposition(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
              <option value="all">All dispositions</option>
              {dispositions.map((value) => <option key={value}>{value}</option>)}
            </select>
            <Input aria-label="Minimum file occurrences" type="number" min="0" placeholder="Minimum files" value={minimumFiles} onChange={(event) => setMinimumFiles(event.target.value)} />
            <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
              <input type="checkbox" checked={ambiguityOnly} onChange={(event) => setAmbiguityOnly(event.target.checked)} />
              Ambiguous only
            </label>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">Observed value</th>
                  <th scope="col" className="px-3 py-2">Licensor</th>
                  <th scope="col" className="px-3 py-2">Files</th>
                  <th scope="col" className="px-3 py-2">Disposition</th>
                  <th scope="col" className="px-3 py-2">Canonical candidate</th>
                  <th scope="col" className="px-3 py-2">Representative evidence</th>
                  <th scope="col" className="px-3 py-2">Approved-batch-only action</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.slice(0, visibleLimit).map((row) => {
                  const proposal = pending[row.observationKey];
                  const sameParentProved =
                    !!row.licensorId &&
                    row.targetPropertyParentLicensorId === row.licensorId;
                  const pendingLicensorId = pendingRows[0]?.licensorId;
                  const allowed =
                    canPreparePending(role, row) &&
                    (!pendingLicensorId || pendingLicensorId === row.licensorId);
                  return (
                    <tr key={row.observationKey} className="border-t align-top">
                      <td className="px-3 py-3 font-medium">{row.observedValue}</td>
                      <td className="px-3 py-3">{row.licensorName}</td>
                      <td className="px-3 py-3 tabular-nums">{row.activeFileCount.toLocaleString()}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={isEffectivelyAmbiguous(row) ? "destructive" : "outline"}>{row.disposition.replaceAll("_", " ")}</Badge>
                          {row.currentlyTaggedAtRisk && <Badge variant="destructive">at-risk evidence</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {row.targetPropertyName ? (
                          <>
                            <p className="font-medium">{row.targetPropertyName}</p>
                            <p className="text-muted-foreground">
                              Code {row.targetPropertyCode} · {row.targetPropertyStatus} ·{" "}
                              {sameParentProved ? "same parent proved" : "parent mismatch, preparation locked"}
                            </p>
                            <p className="max-w-[240px] truncate font-mono text-[9px] text-muted-foreground" title={row.targetPropertyParentLicensorId ?? ""}>
                              Parent {row.targetPropertyParentLicensorId}
                            </p>
                          </>
                        ) : row.disposition === "canonical_create_candidate" ? (
                          <span className="text-amber-700">ColdLion Phase 5 gate required</span>
                        ) : (
                          <span className="text-muted-foreground">No target selected</span>
                        )}
                      </td>
                      <td className="max-w-[260px] px-3 py-3">
                        {row.representativeExamples[0] ? (
                          <span title={row.representativeExamples[0].path} className="block truncate font-mono text-[10px]">
                            {row.representativeExamples[0].path}
                          </span>
                        ) : <span className="text-muted-foreground">No bounded example</span>}
                      </td>
                      <td className="px-3 py-3">
                        {proposal ? (
                          <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Prepared</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!allowed}
                            onClick={() => { setSelected(row); setActionError(""); }}
                            title={allowed
                              ? `Preview ${row.activeFileCount.toLocaleString()} affected files`
                              : pendingLicensorId && pendingLicensorId !== row.licensorId
                                ? "Clear the pending set before preparing a different Licensor"
                                : "This row is outside the approved owner batch or your role cannot prepare proposals"}
                          >
                            {allowed ? `Prepare (${row.activeFileCount.toLocaleString()})` : "Locked"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {visibleLimit < visibleRows.length && (
            <Button variant="outline" size="sm" onClick={() => setVisibleLimit((value) => value + 100)}>
              Load more ({Math.min(100, visibleRows.length - visibleLimit)} next)
            </Button>
          )}
          <p data-testid="pagination-summary" className="text-xs text-muted-foreground">
            Showing {Math.min(visibleRows.length, visibleLimit)} of {visibleRows.length} filtered values.
            Create candidates stay routed to ColdLion Phase 5. Open-review rows are not mappings.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" /> Pending decision export</CardTitle>
          <CardDescription>
            {role === "administrator"
              ? "Administrator preparation remains in this browser memory only. Refreshing clears it."
              : "This role may inspect evidence but cannot prepare or export pending proposals."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{role}</Badge>
            <Badge variant="secondary">{pendingRows.length} prepared</Badge>
            <Button size="sm" onClick={exportPending} disabled={role !== "administrator" || pendingRows.length === 0} className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> Export frozen decision set
            </Button>
            {pendingRows.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => { setPending({}); setExportHash(""); setActionError(""); }}>
                Clear pending set
              </Button>
            )}
          </div>
          {actionError && <p role="alert" className="font-medium text-destructive">{actionError}</p>}
          {exportHash && <p><span className="text-muted-foreground">Export SHA-256:</span> <code className="break-all">{exportHash}</code></p>}
          <p><span className="text-muted-foreground">Frozen proposal SHA-256:</span> <code className="break-all">{FROZEN_PROPOSAL_SHA256}</code></p>
          <p><span className="text-muted-foreground">At-risk evidence SHA-256:</span> <code className="break-all">{AT_RISK_EVIDENCE_SHA256}</code> · never an approval</p>
          <p className="font-medium text-destructive">There is no activate action in this contract.</p>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prepare pending mapping</DialogTitle>
            <DialogDescription>
              This prepares a browser-only proposal. It does not change a tag or database row.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/20 p-3">
                <p><strong>{selected.observedValue}</strong> → <strong>{selected.targetPropertyName}</strong> ({selected.targetPropertyCode})</p>
                <p className="mt-1 text-muted-foreground">{selected.licensorName} · same-parent proof · {selected.activeFileCount.toLocaleString()} affected files</p>
              </div>
              <label className="space-y-1">
                <span className="text-xs font-medium">Review note (optional for this exact deterministic match)</span>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} className="w-full rounded-md border bg-background p-2 text-sm" placeholder="Add context if this decision is not obvious." />
              </label>
              <p className="text-xs text-muted-foreground">Owner batch hash: {APPROVED_BATCH.sha256}</p>
              {actionError && <p role="alert" className="text-xs font-medium text-destructive">{actionError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button onClick={prepare} disabled={!selected || !canPreparePending(role, selected)}>
              Prepare pending proposal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
