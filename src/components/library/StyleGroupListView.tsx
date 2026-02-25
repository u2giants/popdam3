import type { StyleGroup } from "@/hooks/useStyleGroups";
import { Badge } from "@/components/ui/badge";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface StyleGroupListViewProps {
  groups: StyleGroup[];
  selectedIds: Set<string>;
  onSelect: (id: string, event: React.MouseEvent) => void;
  isLoading: boolean;
}

export default function StyleGroupListView({ groups, selectedIds, onSelect, isLoading }: StyleGroupListViewProps) {
  if (isLoading && groups.length === 0) {
    return (
      <div className="p-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 rounded bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ImageOff className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground">No style groups found</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Run "Rebuild Style Groups" in Diagnostics to generate groups from your assets
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[56px]" />
          <TableHead>SKU</TableHead>
          <TableHead>Licensor / Property</TableHead>
          <TableHead>Workflow</TableHead>
          <TableHead className="text-right">Files</TableHead>
          <TableHead>Latest Date</TableHead>
          <TableHead>Type</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => {
          const selected = selectedIds.has(group.id);
          const subtitle = group.is_licensed
            ? [group.licensor_name, group.property_name].filter(Boolean).join(" · ")
            : group.product_category || "—";

          return (
            <TableRow
              key={group.id}
              onClick={(e) => onSelect(group.id, e)}
              className={cn(
                "cursor-pointer",
                selected && "bg-primary/10"
              )}
            >
              <TableCell className="p-2">
                <div className="h-10 w-10 rounded overflow-hidden bg-muted/30 flex-shrink-0">
                  {group.thumbnail_url ? (
                    <img
                      src={group.thumbnail_url}
                      alt={group.sku}
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
                <span className="font-semibold font-mono text-sm">{group.sku}</span>
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">{subtitle}</span>
              </TableCell>
              <TableCell>
                {group.workflow_status && group.workflow_status !== "other" && (
                  <span className="rounded bg-tag px-1.5 py-0.5 text-[10px] text-tag-foreground capitalize whitespace-nowrap">
                    {group.workflow_status.replace(/_/g, " ")}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm">
                {group.asset_count}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                {group.latest_file_date
                  ? format(new Date(group.latest_file_date), "MMM d, yyyy")
                  : "—"}
              </TableCell>
              <TableCell>
                <Badge variant={group.is_licensed ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                  {group.is_licensed ? "Licensed" : "Generic"}
                </Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
