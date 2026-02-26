import type { Asset } from "@/types/assets";
import { Badge } from "@/components/ui/badge";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { formatFilename } from "@/lib/format-filename";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AssetListViewProps {
  assets: Asset[];
  selectedIds: Set<string>;
  onSelect: (id: string, event: React.MouseEvent) => void;
  isLoading: boolean;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AssetListView({ assets, selectedIds, onSelect, isLoading }: AssetListViewProps) {
  if (isLoading && assets.length === 0) {
    return (
      <div className="p-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 rounded bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ImageOff className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground">No assets found</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[56px]" />
          <TableHead>Filename</TableHead>
          <TableHead>SKU</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Workflow</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Modified</TableHead>
          <TableHead>Licensed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assets.map((asset) => {
          const selected = selectedIds.has(asset.id);
          return (
            <TableRow
              key={asset.id}
              onClick={(e) => onSelect(asset.id, e)}
              className={cn("cursor-pointer", selected && "bg-primary/10")}
            >
              <TableCell className="p-2">
                <div className="h-10 w-10 rounded overflow-hidden bg-muted/30 flex-shrink-0">
                  {asset.thumbnail_url ? (
                    <img
                      src={asset.thumbnail_url}
                      alt={asset.filename}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <ImageOff className="h-4 w-4 text-muted-foreground/30" />
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <span className="font-semibold text-sm">{formatFilename(asset.filename, 32)}</span>
              </TableCell>
              <TableCell>
                <span className="text-sm font-mono text-muted-foreground">{asset.sku ?? "—"}</span>
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="text-[10px] uppercase">{asset.file_type}</Badge>
              </TableCell>
              <TableCell>
                {asset.workflow_status && asset.workflow_status !== "other" && (
                  <span className="rounded bg-tag px-1.5 py-0.5 text-[10px] text-tag-foreground capitalize whitespace-nowrap">
                    {asset.workflow_status.replace(/_/g, " ")}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground tabular-nums">
                {formatSize(asset.file_size)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                {format(new Date(asset.modified_at), "MMM d, yyyy")}
              </TableCell>
              <TableCell>
                <Badge variant={asset.is_licensed ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                  {asset.is_licensed ? "Licensed" : "Generic"}
                </Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
