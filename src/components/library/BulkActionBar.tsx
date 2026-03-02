import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { StyleGroup } from "@/hooks/useStyleGroups";
import type { Enums } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Sparkles, ArrowRightLeft, Loader2, CheckCircle2, AlertCircle, Square } from "lucide-react";
import { Constants } from "@/integrations/supabase/types";
import { toast } from "@/hooks/use-toast";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";
import { useState } from "react";

interface BulkActionBarProps {
  selectedGroups: StyleGroup[];
  onClearSelection: () => void;
}

export default function BulkActionBar({ selectedGroups, onClearSelection }: BulkActionBarProps) {
  const queryClient = useQueryClient();
  const [workflowValue, setWorkflowValue] = useState<string>("");

  const op = usePersistentOperation("ai-tag-groups");

  // Start server-side AI tagging for selected groups
  const handleBulkAiTag = async () => {
    const groupIds = selectedGroups.map(g => g.id);
    // Count taggable assets for progress display
    const { count, error } = await supabase
      .from("assets")
      .select("id", { count: "exact", head: true })
      .in("style_group_id", groupIds)
      .eq("is_deleted", false)
      .not("thumbnail_url", "is", null);

    if (error) {
      toast({ title: "Failed to count assets", description: error.message, variant: "destructive" });
      return;
    }

    if (!count || count === 0) {
      toast({ title: "No taggable assets", description: "Selected groups have no assets with thumbnails.", variant: "destructive" });
      return;
    }

    await op.start({
      params: { type: "bulk-ai-tag-all", group_ids: groupIds, total: count },
      initialProgress: { tagged: 0, skipped: 0, failed: 0, total: count },
    });

    toast({ title: `AI tagging ${count} asset${count !== 1 ? "s" : ""} across ${selectedGroups.length} group${selectedGroups.length !== 1 ? "s" : ""}…` });
  };

  // Invalidate queries when operation completes
  const progress = op.state.progress ?? {};
  const isRunning = op.isActive;
  const isDone = op.state.status === "completed";
  const isFailed = op.state.status === "failed";

  // Auto-invalidate on completion
  if (isDone || isFailed) {
    queryClient.invalidateQueries({ queryKey: ["style-groups"] });
  }

  const total = (progress.total as number) || 0;
  const tagged = (progress.tagged as number) || 0;
  const skipped = (progress.skipped as number) || 0;
  const failed = (progress.failed as number) || 0;
  const processed = tagged + skipped + failed;
  const progressPercent = total > 0 ? Math.round((processed / total) * 100) : 0;

  // Bulk workflow change — update style_groups directly
  const bulkWorkflow = useMutation({
    mutationFn: async (status: string) => {
      const ids = selectedGroups.map((g) => g.id);
      const { error } = await supabase
        .from("style_groups")
        .update({ workflow_status: status as Enums<"workflow_status"> })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["style-groups"] });
      toast({ title: `Workflow updated for ${selectedGroups.length} group${selectedGroups.length !== 1 ? "s" : ""}` });
      setWorkflowValue("");
    },
    onError: (e) => {
      toast({ title: "Bulk update failed", description: e.message, variant: "destructive" });
    },
  });

  return (
    <div className="flex items-center gap-3 border-b border-primary/30 bg-primary/5 px-4 py-2.5 animate-in slide-in-from-top duration-200">
      {/* Selection count */}
      <div className="flex items-center gap-2">
        <Badge variant="default" className="text-xs">
          {selectedGroups.length} group{selectedGroups.length !== 1 ? "s" : ""} selected
        </Badge>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClearSelection}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* AI Tag button */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {isRunning ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => op.stop()}
              >
                <Square className="h-3 w-3 fill-current" />
                Stop
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={handleBulkAiTag}
                disabled={isDone}
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI Tag
              </Button>
            )}
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[240px] text-center">
            {isRunning
              ? "AI tagging is running server-side — safe to navigate away"
              : "Sends each asset's thumbnail to the AI model for automatic tagging (runs server-side)"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Bulk workflow change */}
      <div className="flex items-center gap-1.5">
        <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
        <Select
          value={workflowValue}
          onValueChange={(v) => {
            setWorkflowValue(v);
            bulkWorkflow.mutate(v);
          }}
          disabled={bulkWorkflow.isPending}
        >
          <SelectTrigger className="h-8 w-[160px] text-xs bg-background">
            <SelectValue placeholder="Set workflow…" />
          </SelectTrigger>
          <SelectContent>
            {Constants.public.Enums.workflow_status.map((ws) => (
              <SelectItem key={ws} value={ws} className="text-xs capitalize">
                {ws.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Progress indicator */}
      {(isRunning || isDone || isFailed) && (
        <div className="flex items-center gap-2 ml-auto">
          {isRunning ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <Progress value={progressPercent} className="w-32 h-2" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {processed}/{total}
              </span>
            </>
          ) : isDone ? (
            <div className="flex items-center gap-1.5 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              <span className="text-success">
                Tagged {tagged}{failed > 0 ? `, ${failed} failed` : ""}
              </span>
              <Button variant="ghost" size="sm" className="h-5 px-1 text-xs" onClick={() => op.reset()}>
                Dismiss
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs">
              <AlertCircle className="h-3.5 w-3.5 text-warning" />
              <span className="text-warning">{op.state.error || "Failed"}</span>
              <Button variant="ghost" size="sm" className="h-5 px-1 text-xs" onClick={() => op.reset()}>
                Dismiss
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
