import { ChangeEvent, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, ImageDown, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  createSellThroughPreviewRows,
  generateSellThroughWorkbook,
  normalizeStockNumber,
  parseSellThroughCsv,
  summarizeSellThroughRows,
  type ParsedSellThroughCsv,
  type SellThroughRowPreview,
  type SellThroughSummary,
  type StyleGroupImageMatch,
  type ThumbnailFetchFailure,
} from "@/lib/sell-through-export";

type Step = "idle" | "parsing" | "ready" | "generating";

interface MatchLoadResult {
  previewRows: SellThroughRowPreview[];
  summary: SellThroughSummary;
}

const SKU_QUERY_CHUNK_SIZE = 200;

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

async function loadStyleGroupMatches(parsed: ParsedSellThroughCsv): Promise<MatchLoadResult> {
  const uniqueSkus = Array.from(
    new Set(
      parsed.rows
        .map((row) => normalizeStockNumber(row[parsed.vendorStockNumberIndex]))
        .filter(Boolean),
    ),
  );

  const matchesBySku = new Map<string, StyleGroupImageMatch>();

  for (const chunk of chunkValues(uniqueSkus, SKU_QUERY_CHUNK_SIZE)) {
    const queryValues = Array.from(new Set(chunk.flatMap((sku) => [sku, sku.toLowerCase()])));
    const { data, error } = await supabase
      .from("style_groups")
      .select("sku, primary_thumbnail_url")
      .in("sku", queryValues);

    if (error) throw error;

    for (const row of data ?? []) {
      const sku = normalizeStockNumber(row.sku);
      const existing = matchesBySku.get(sku);
      if (!existing || (!existing.thumbnailUrl && row.primary_thumbnail_url)) {
        matchesBySku.set(sku, {
          sku: row.sku,
          thumbnailUrl: row.primary_thumbnail_url,
        });
      }
    }
  }

  const previewRows = createSellThroughPreviewRows(parsed, matchesBySku);
  return {
    previewRows,
    summary: summarizeSellThroughRows(previewRows),
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function makeOutputFilename(inputName: string | null): string {
  const base = (inputName || "sell-through")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "sell-through";
  return `${base}-popdam-images.xlsx`;
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value.toLocaleString()}</div>
    </div>
  );
}

export default function SellThroughExportPage() {
  const [step, setStep] = useState<Step>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSellThroughCsv | null>(null);
  const [previewRows, setPreviewRows] = useState<SellThroughRowPreview[]>([]);
  const [summary, setSummary] = useState<SellThroughSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [download, setDownload] = useState<{ blob: Blob; filename: string } | null>(null);
  const [thumbnailFailures, setThumbnailFailures] = useState<ThumbnailFetchFailure[]>([]);

  const sampleRows = useMemo(() => previewRows.slice(0, 8), [previewRows]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setErrorMessage(null);
    setDownload(null);
    setThumbnailFailures([]);
    setPreviewRows([]);
    setSummary(null);
    setParsed(null);

    if (!file) {
      setFileName(null);
      setStep("idle");
      return;
    }

    setFileName(file.name);
    setStep("parsing");

    try {
      const text = await file.text();
      const nextParsed = parseSellThroughCsv(text);

      if (nextParsed.rows.length === 0) {
        throw new Error("The CSV has a header row but no data rows.");
      }

      const result = await loadStyleGroupMatches(nextParsed);
      setParsed(nextParsed);
      setPreviewRows(result.previewRows);
      setSummary(result.summary);
      setStep("ready");
    } catch (error) {
      setStep("idle");
      setErrorMessage(error instanceof Error ? error.message : "Could not parse this CSV.");
    }
  }

  async function handleGenerateWorkbook() {
    if (!parsed || previewRows.length === 0) return;

    setStep("generating");
    setErrorMessage(null);
    setThumbnailFailures([]);

    try {
      const generated = await generateSellThroughWorkbook(parsed.headers, previewRows);
      const filename = makeOutputFilename(fileName);
      setDownload({ blob: generated.blob, filename });
      setThumbnailFailures(generated.thumbnailFailures);
      setStep("ready");
      toast("Workbook ready", { description: `${filename} has embedded PopDAM images.` });
    } catch (error) {
      setStep("ready");
      setErrorMessage(error instanceof Error ? error.message : "Could not generate the workbook.");
    }
  }

  const isBusy = step === "parsing" || step === "generating";

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <ImageDown className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">Sell-through Image Export</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Upload a retailer sell-through CSV and generate an Excel file with PopDAM thumbnails embedded beside matching stock numbers.
          </p>
        </div>
        {download && (
          <Button onClick={() => downloadBlob(download.blob, download.filename)} className="gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Download XLSX
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">CSV Upload</CardTitle>
          <CardDescription>
            The file must include a <code>Vendor Stock Number</code> column. Stock numbers are matched after trimming and uppercasing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input type="file" accept=".csv,text/csv" onChange={handleFileChange} disabled={isBusy} className="max-w-lg" />
            {fileName && (
              <Badge variant="secondary" className="w-fit gap-1.5">
                <Upload className="h-3 w-3" />
                {fileName}
              </Badge>
            )}
          </div>

          {errorMessage && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Could not process CSV</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          {step === "parsing" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading CSV and matching SKUs…
            </div>
          )}
        </CardContent>
      </Card>

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard label="Data rows" value={summary.totalDataRows} />
          <SummaryCard label="Unique stock numbers" value={summary.uniqueStockNumbers} />
          <SummaryCard label="Matched SKUs" value={summary.matchedSkus} />
          <SummaryCard label="Unmatched SKUs" value={summary.unmatchedSkus} />
          <SummaryCard label="Rows missing thumbnail" value={summary.rowsMissingThumbnail} />
        </div>
      )}

      {summary && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">Workbook</CardTitle>
              <CardDescription>
                Original CSV columns are preserved. <code>Image</code> and <code>PopDAM Match</code> are inserted first.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleGenerateWorkbook} disabled={step === "generating" || previewRows.length === 0} className="gap-2">
                {step === "generating" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />}
                Generate XLSX
              </Button>
              {download && (
                <Button variant="outline" onClick={() => downloadBlob(download.blob, download.filename)} className="gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  Download XLSX
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {download && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Workbook generated</AlertTitle>
                <AlertDescription>
                  {download.filename} is ready. The download button will stay available until another CSV is uploaded.
                </AlertDescription>
              </Alert>
            )}

            {thumbnailFailures.length > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Some thumbnails could not be embedded</AlertTitle>
                <AlertDescription>
                  {thumbnailFailures.length.toLocaleString()} matched row{thumbnailFailures.length === 1 ? "" : "s"} will show an image fetch failure marker in Excel.
                </AlertDescription>
              </Alert>
            )}

            <div className="overflow-hidden rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor Stock Number</TableHead>
                    <TableHead>PopDAM Match</TableHead>
                    <TableHead>Thumbnail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sampleRows.map((row, index) => (
                    <TableRow key={`${row.stockNumber}-${index}`}>
                      <TableCell className="font-mono text-xs">{row.stockNumber || "Blank"}</TableCell>
                      <TableCell>
                        {row.match ? (
                          <Badge variant="secondary">Matched {row.match.sku}</Badge>
                        ) : (
                          <Badge variant="outline">Unmatched</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.match?.thumbnailUrl ? "Ready" : row.match ? "Missing thumbnail" : "No match"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
