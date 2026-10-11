import { useState } from "react";
import { Trash2, Save, Gauge, Calendar as CalendarIcon, Loader2, RefreshCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { SpacesConfigSettings, FolderManager } from "./SpacesAndFolders";
import { ResourceGuardSettings, PollingConfig } from "./ResourceAndPolling";

export function DateCutoffSettings() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config", "DATE_CUTOFFS"],
    queryFn: () => call("get-config", { keys: ["SCAN_MIN_DATE", "THUMBNAIL_MIN_DATE"] }),
  });

  const currentScan = (() => {
    const val = data?.config?.SCAN_MIN_DATE?.value ?? data?.config?.SCAN_MIN_DATE;
    return typeof val === "string" ? val : "2010-01-01";
  })();
  const currentThumb = (() => {
    const val = data?.config?.THUMBNAIL_MIN_DATE?.value ?? data?.config?.THUMBNAIL_MIN_DATE;
    return typeof val === "string" ? val : "2020-01-01";
  })();

  const [scanDate, setScanDate] = useState<string | null>(null);
  const [thumbDate, setThumbDate] = useState<string | null>(null);

  const scanVal = scanDate ?? currentScan;
  const thumbVal = thumbDate ?? currentThumb;
  const dirty = scanDate !== null || thumbDate !== null;

  const saveMutation = useMutation({
    mutationFn: () => {
      const entries: Record<string, string> = {};
      if (scanDate !== null) entries.SCAN_MIN_DATE = scanDate;
      if (thumbDate !== null) entries.THUMBNAIL_MIN_DATE = thumbDate;
      return call("set-config", { entries });
    },
    onSuccess: () => {
      toast.success("Date cutoffs saved");
      setScanDate(null);
      setThumbDate(null);
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const [isPurging, setIsPurging] = useState(false);

  const { data: purgePreview } = useQuery({
    queryKey: ["purge-preview", thumbVal],
    queryFn: async () => {
      const result = await call("run-query", {
        sql: `SELECT COUNT(*) as count FROM assets WHERE is_deleted = false AND modified_at < '${thumbVal}'`,
      });
      return Number(result.rows?.[0]?.count ?? 0);
    },
    enabled: !!thumbVal,
  });

  async function handlePurge() {
    if (!window.confirm(
      `This will permanently remove ${purgePreview?.toLocaleString()} assets ` +
      `with a file date before ${thumbVal} from the library. ` +
      `This cannot be undone. Continue?`
    )) return;
    setIsPurging(true);
    let totalPurged = 0;
    let totalGroupsRemoved = 0;
    let totalGroupsUpdated = 0;
    try {
      while (true) {
        const result = await call("purge-old-assets", {
          cutoff_date: thumbVal,
        });
        totalPurged += result.assets_purged ?? 0;
        totalGroupsRemoved += result.groups_removed ?? 0;
        totalGroupsUpdated += result.groups_updated ?? 0;
        if (result.done) break;
      }
      toast.success(
        `Purged ${totalPurged.toLocaleString()} assets. ` +
        `Removed ${totalGroupsRemoved} empty groups, ` +
        `updated ${totalGroupsUpdated} groups.`
      );
      queryClient.invalidateQueries({ queryKey: ["style-groups"] });
      queryClient.invalidateQueries({ queryKey: ["purge-preview"] });
      queryClient.invalidateQueries({ queryKey: ["style-group-stats"] });
      queryClient.invalidateQueries({ queryKey: ["ungrouped-asset-count"] });
    } catch (e: any) {
      toast.error(e.message || "Purge failed");
    } finally {
      setIsPurging(false);
    }
  }

  if (isLoading) return <Card><CardContent className="py-6"><p className="text-sm text-muted-foreground">Loading...</p></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarIcon className="h-4 w-4" /> Date Cutoffs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Files older than <strong>Scan Min Date</strong> are skipped during ingestion entirely. 
          Files older than <strong>Thumbnail Min Date</strong> are ingested but hidden from the library unless they have a thumbnail.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Scan Min Date (don't ingest files older than this)</Label>
            <Input
              type="date"
              className="font-mono text-xs"
              value={scanVal}
              onChange={(e) => setScanDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Thumbnail Min Date (visibility threshold)</Label>
            <Input
              type="date"
              className="font-mono text-xs"
              value={thumbVal}
              onChange={(e) => setThumbDate(e.target.value)}
            />
            {purgePreview != null && purgePreview > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                {purgePreview.toLocaleString()} assets older than this date are currently in the library
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {dirty && (
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} title={saveMutation.isPending ? "Saving…" : undefined}>
              <Save className="h-3.5 w-3.5 mr-1.5" /> Save Date Cutoffs
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={handlePurge}
            disabled={isPurging || !thumbVal || !purgePreview}
            title={isPurging ? "Purge in progress…" : !thumbVal ? "Configure a thumbnail storage setting first" : !purgePreview ? "Preview the purge results first" : undefined}
          >
            {isPurging ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
            Purge {purgePreview?.toLocaleString() ?? "…"} assets older than {thumbVal}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Image Output Settings ───────────────────────────────────────────

export function ImageOutputSettings() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config", "IMAGE_OUTPUT"],
    queryFn: () => call("get-config", { keys: ["IMAGE_OUTPUT"] }),
  });

  const currentConfig = (() => {
    const val = data?.config?.IMAGE_OUTPUT?.value ?? data?.config?.IMAGE_OUTPUT;
    return (val && typeof val === "object" ? val : {
      thumbnail_height: 400,
      preview_height: 1200,
      jpeg_quality: 85,
    }) as Record<string, number>;
  })();

  const [form, setForm] = useState<Record<string, number> | null>(null);
  const values = form ?? currentConfig;
  const dirty = form !== null;

  const update = (key: string, val: number) => {
    setForm({ ...values, [key]: val });
  };

  const saveMutation = useMutation({
    mutationFn: () => call("set-config", { entries: { IMAGE_OUTPUT: values } }),
    onSuccess: () => {
      toast.success("Image output settings saved — agent picks up on next heartbeat");
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Card><CardContent className="py-6"><p className="text-sm text-muted-foreground">Loading...</p></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4" /> Image Output Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-xs text-muted-foreground">
          Control the output resolution (by height — width scales proportionally) and JPEG compression quality for generated thumbnails and previews.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Thumbnail Height</Label>
            <Badge variant="secondary" className="font-mono text-xs">{values.thumbnail_height ?? 400}px</Badge>
          </div>
          <Slider
            value={[values.thumbnail_height ?? 400]}
            onValueChange={(v) => update("thumbnail_height", v[0])}
            min={200}
            max={800}
            step={50}
          />
          <p className="text-[10px] text-muted-foreground">Used for grid view cards. Default: 400px.</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Preview Height</Label>
            <Badge variant="secondary" className="font-mono text-xs">{values.preview_height ?? 1200}px</Badge>
          </div>
          <Slider
            value={[values.preview_height ?? 1200]}
            onValueChange={(v) => update("preview_height", v[0])}
            min={600}
            max={2400}
            step={100}
          />
          <p className="text-[10px] text-muted-foreground">Used for detail panel / lightbox. Default: 1200px.</p>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">JPEG Quality</Label>
            <Badge variant="secondary" className="font-mono text-xs">{values.jpeg_quality ?? 85}%</Badge>
          </div>
          <Slider
            value={[values.jpeg_quality ?? 85]}
            onValueChange={(v) => update("jpeg_quality", v[0])}
            min={50}
            max={100}
            step={5}
          />
          <p className="text-[10px] text-muted-foreground">Higher = better quality, larger files. Default: 85%.</p>
        </div>

        {dirty && (
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} title={saveMutation.isPending ? "Saving…" : undefined}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Save Image Settings
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Grouped Tab Exports ──────────────────────────────────────────────

/** NAS & Storage tab: Volume mapping, scan folders, DO Spaces config */
export function NasStorageTab() {
  return (
    <div className="space-y-4">
      <FolderManager />
      <SpacesConfigSettings />
    </div>
  );
}

/** Image Output tab: Thumbnail/preview resolution, JPEG quality */
export function ImageOutputTab() {
  return (
    <div className="space-y-4">
      <ImageOutputSettings />
    </div>
  );
}

// ── Auto-Scan Toggle ────────────────────────────────────────────────

export function AutoScanSettings() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-config", "AUTO_SCAN_CONFIG"],
    queryFn: () => call("get-config", { keys: ["AUTO_SCAN_CONFIG"] }),
  });

  const currentConfig = (() => {
    const val = data?.config?.AUTO_SCAN_CONFIG?.value ?? data?.config?.AUTO_SCAN_CONFIG;
    return (val && typeof val === "object" ? val : { enabled: false, interval_hours: 6 }) as { enabled: boolean; interval_hours: number };
  })();

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [intervalHours, setIntervalHours] = useState<number | null>(null);

  const effectiveEnabled = enabled ?? currentConfig.enabled;
  const effectiveInterval = intervalHours ?? currentConfig.interval_hours;
  const dirty = enabled !== null || intervalHours !== null;

  const saveMutation = useMutation({
    mutationFn: () => call("set-config", {
      entries: {
        AUTO_SCAN_CONFIG: {
          enabled: effectiveEnabled,
          interval_hours: effectiveInterval,
        },
      },
    }),
    onSuccess: () => {
      toast.success(effectiveEnabled ? "Auto-scan enabled" : "Auto-scan disabled");
      setEnabled(null);
      setIntervalHours(null);
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  // Auto-save on toggle
  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    // Save immediately on toggle
    call("set-config", {
      entries: {
        AUTO_SCAN_CONFIG: {
          enabled: checked,
          interval_hours: effectiveInterval,
        },
      },
    }).then(() => {
      toast.success(checked ? "Auto-scan enabled — agent will scan automatically" : "Auto-scan disabled — manual scans only");
      setEnabled(null);
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    }).catch((e) => toast.error((e as Error).message));
  };

  if (isLoading) return <Card><CardContent className="py-6"><p className="text-sm text-muted-foreground">Loading...</p></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <RefreshCw className="h-4 w-4" /> Auto-Scan Mode
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Automatic Scanning</Label>
            <p className="text-xs text-muted-foreground">
              {effectiveEnabled
                ? `Agent will automatically scan every ${effectiveInterval} hour${effectiveInterval !== 1 ? "s" : ""}`
                : "Scans must be triggered manually from the library toolbar"}
            </p>
          </div>
          <Switch
            checked={effectiveEnabled}
            onCheckedChange={handleToggle}
          />
        </div>

        {effectiveEnabled && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Scan Interval</Label>
              <Badge variant="secondary" className="font-mono text-xs">{effectiveInterval}h</Badge>
            </div>
            <Slider
              value={[effectiveInterval]}
              onValueChange={(v) => setIntervalHours(v[0])}
              min={1}
              max={48}
              step={1}
            />
            <p className="text-[10px] text-muted-foreground">
              How often the agent re-scans all configured folders. Default: 6 hours.
            </p>
            {intervalHours !== null && (
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} title={saveMutation.isPending ? "Saving…" : undefined}>
                <Save className="h-3.5 w-3.5 mr-1.5" /> Save Interval
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Scanning tab: Auto-scan mode, date cutoffs, resource guard, polling config */
export function ScanningTab() {
  return (
    <div className="space-y-4">
      <AutoScanSettings />
      <DateCutoffSettings />
      <ResourceGuardSettings />
      <PollingConfig />
    </div>
  );
}

// ── Update Bridge Agent ─────────────────────────────────────────────
