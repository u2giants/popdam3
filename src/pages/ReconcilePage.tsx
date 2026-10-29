import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useColdLionLinkCandidates, useColdLionTriage, useResolveColdLionTriage } from "@/hooks/useColdLionTriage";
import {
  TRIAGE_KIND_LABEL,
  describeColdLionSource,
  formatQuantity,
  rankLinkCandidates,
  type TriageAction,
  type TriageItem,
  type TriageKind,
} from "@/lib/coldlion-triage";

const KINDS: TriageKind[] = ["quantity", "import_po", "unmatched"];

function LineFacts({ item }: { item: TriageItem }) {
  const { row } = item;
  const facts: Array<[string, string | null]> = [
    ["Customer", row.customer_name],
    ["Customer PO", row.customer_po_number],
    ["SKU", row.sku],
    [item.kind === "unmatched" ? "ColdLion quantity" : "Import PO", item.kind === "unmatched" ? formatQuantity(row.quantity_ordered) : row.production_order_number],
    ["Source", describeColdLionSource(row.coldlion_source_id)],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {facts.filter(([, value]) => value).map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Choice({ title, detail, onClick, disabled, testId }: { title: string; detail: string; onClick: () => void; disabled: boolean; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="flex-1 rounded-md border-2 border-border p-4 text-left transition hover:border-primary hover:bg-accent disabled:opacity-50"
    >
      <div className="font-semibold">{title}</div>
      <div className="text-sm text-muted-foreground">{detail}</div>
    </button>
  );
}

function MismatchStep({ item, resolve, busy }: { item: TriageItem; resolve: (action: TriageAction) => void; busy: boolean }) {
  const { row } = item;
  if (item.kind === "quantity") {
    return (
      <div className="space-y-4">
        <p>
          The Google sheet says <b>{formatQuantity(row.quantity_ordered)}</b> pieces, but ColdLion says{" "}
          <b className="text-destructive">{formatQuantity(row.coldlion_quantity_ordered)}</b>. Which is right?
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Choice testId="keep-google" disabled={busy} onClick={() => resolve("keep_google_quantity")}
            title={`Google is right — keep ${formatQuantity(row.quantity_ordered)}`}
            detail="Nothing changes. This item leaves the list unless ColdLion changes again." />
          <Choice testId="use-coldlion" disabled={busy} onClick={() => resolve("use_coldlion_quantity")}
            title={`ColdLion is right — change to ${formatQuantity(row.coldlion_quantity_ordered)}`}
            detail="The OrderList quantity is updated." />
        </div>
        <p className="text-sm text-muted-foreground">If neither number is right, correct it in ColdLion or in the order first, then come back.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p>
        This line sits on Import PO <b>{row.production_order_number}</b>, but ColdLion puts it on{" "}
        <b className="text-destructive">{row.coldlion_import_po}</b>. Which is right?
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Choice testId="keep-google" disabled={busy} onClick={() => resolve("keep_google_import_po")}
          title={`Google is right — stay on ${row.production_order_number}`}
          detail="Nothing changes. This item leaves the list unless ColdLion changes again." />
        <Choice testId="use-coldlion" disabled={busy} onClick={() => resolve("use_coldlion_import_po")}
          title={`ColdLion is right — move to ${row.coldlion_import_po}`}
          detail="The line moves to that Import PO. It must already exist for the same customer." />
      </div>
    </div>
  );
}

function UnmatchedStep({ item, resolve, busy }: { item: TriageItem; resolve: (action: TriageAction, target?: string) => void; busy: boolean }) {
  const { data = [], isLoading } = useColdLionLinkCandidates(item.row.sku);
  const candidates = useMemo(() => rankLinkCandidates(item.row, data), [item.row, data]);
  return (
    <div className="space-y-4">
      <p>
        This ColdLion line did not match exactly one Google OrderList line, so it shows as its own row.
        {candidates.length ? " Is it one of these Google lines with the same SKU?" : " No open Google line has this SKU."}
      </p>
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <div className="space-y-2">
          {candidates.map((candidate) => (
            <div key={candidate.order_line_id} data-testid="link-candidate"
              className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
              <div>
                <div className="font-medium">
                  Import PO {candidate.production_order_number} · Customer PO {candidate.customer_po_number ?? "—"}
                  {candidate.samePo && <Badge className="ml-2" variant="secondary">Same customer PO</Badge>}
                </div>
                <div className="text-muted-foreground">
                  {candidate.customer_name ?? "Unknown customer"} · quantity {formatQuantity(candidate.quantity_ordered)}
                </div>
              </div>
              <Button size="sm" disabled={busy} onClick={() => resolve("link_google_line", candidate.order_line_id)}>
                This is the one
              </Button>
            </div>
          ))}
        </div>
      )}
      <Choice testId="keep-separate" disabled={busy} onClick={() => resolve("keep_separate")}
        title="None of these — keep it as its own row"
        detail="The ColdLion line stays in the OrderList on its own and leaves this list." />
    </div>
  );
}

export default function ReconcilePage() {
  const { data: items = [], isLoading, error, refetch, isFetching } = useColdLionTriage();
  const resolver = useResolveColdLionTriage();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [lastIndex, setLastIndex] = useState(0);

  // After a decision the item leaves the list; stay at the same position so the next one follows.
  useEffect(() => {
    if (!items.length) return;
    if (!selectedKey || !items.some((item) => item.key === selectedKey)) {
      setSelectedKey(items[Math.min(lastIndex, items.length - 1)].key);
    }
  }, [items, selectedKey, lastIndex]);

  const index = items.findIndex((item) => item.key === selectedKey);
  const current = index >= 0 ? items[index] : null;
  const resolve = (action: TriageAction, target?: string) => {
    if (!current) return;
    setLastIndex(index);
    resolver.mutate({ line: current.row.order_line_id, action, target });
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">To reconcile</h1>
          <p className="text-sm text-muted-foreground">Where ColdLion and the Google OrderList disagree. Pick the right answer for each one.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {error ? <p className="text-destructive">Could not load the list: {(error as Error).message}</p> : null}
      {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : null}

      {!isLoading && !error && !items.length ? (
        <Card data-testid="triage-empty">
          <CardContent className="flex items-center gap-3 p-6">
            <CheckCircle2 className="h-6 w-6 text-green-600" /> Everything is reconciled. Nothing needs a decision.
          </CardContent>
        </Card>
      ) : null}

      {items.length ? (
        <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
          <Card className="max-h-[75vh] overflow-auto">
            <CardContent className="space-y-4 p-3">
              {KINDS.map((kind) => {
                const group = items.filter((item) => item.kind === kind);
                if (!group.length) return null;
                return (
                  <div key={kind}>
                    <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase text-muted-foreground">
                      {TRIAGE_KIND_LABEL[kind]} <Badge variant="outline">{group.length}</Badge>
                    </div>
                    {group.map((item) => (
                      <button key={item.key} type="button" data-testid="triage-item"
                        onClick={() => setSelectedKey(item.key)}
                        className={`block w-full rounded px-2 py-1 text-left text-sm ${item.key === selectedKey ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
                        {item.row.customer_po_number ?? "—"} · {item.row.sku ?? "—"}
                      </button>
                    ))}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {current ? (
            <Card data-testid="triage-step">
              <CardHeader>
                <div className="text-sm text-muted-foreground">Item {index + 1} of {items.length}</div>
                <CardTitle>{TRIAGE_KIND_LABEL[current.kind]}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <LineFacts item={current} />
                {current.kind === "unmatched" ? (
                  <UnmatchedStep key={current.key} item={current} resolve={resolve} busy={resolver.isPending} />
                ) : (
                  <MismatchStep item={current} resolve={resolve} busy={resolver.isPending} />
                )}
                <div className="flex justify-between">
                  <Button variant="ghost" size="sm" disabled={index <= 0} onClick={() => setSelectedKey(items[index - 1].key)}>Previous</Button>
                  <Button variant="ghost" size="sm" disabled={index >= items.length - 1} onClick={() => setSelectedKey(items[index + 1].key)}>Skip for now</Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
