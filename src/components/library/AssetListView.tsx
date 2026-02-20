import type { Asset } from "@/types/assets";
import { Badge } from "@/components/ui/badge";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";

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
          <div key={i} className="h-12 rounded bg-muted/20 animate-pulse" />
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
    <div className="overflow-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-12" />
            <TableHead>Filename</TableHead>
            <TableHead className="w-16">Type</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead className="w-32">Workflow</TableHead>
            <TableHead className="w-28">Modified</TableHead>
            <TableHead className="w-20 text-right">Size</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.map((asset) => (
            <TableRow
              key={asset.id}
              onClick={(e) => onSelect(asset.id, e)}
              className={cn(
                "cursor-pointer",
                selectedIds.has(asset.id) && "bg-primary/5"
              )}
            >
              <TableCell className="p-1">
                <div className="h-9 w-9 rounded bg-muted/30 overflow-hidden flex items-center justify-center">
                  {asset.thumbnail_url ? (
                    <img src={asset.thumbnail_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <ImageOff className="h-4 w-4 text-muted-foreground/30" />
                  )}
                </div>
              </TableCell>
              <TableCell className="font-medium text-sm truncate max-w-[300px]" title={asset.filename}>
                {asset.filename}
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="text-[10px] uppercase">{asset.file_type}</Badge>
              </TableCell>
              <TableCell className="text-xs capitalize">{asset.status}</TableCell>
              <TableCell className="text-xs capitalize text-muted-foreground">
                {asset.workflow_status?.replace(/_/g, " ") ?? "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {asset.modified_at ? format(new Date(asset.modified_at), "MMM d, yyyy") : "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground text-right">
                {formatSize(asset.file_size)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
