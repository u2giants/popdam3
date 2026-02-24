import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { StyleGroup } from "@/hooks/useStyleGroups";
import type { Enums } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Sparkles, ArrowRightLeft, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Constants } from "@/integrations/supabase/types";
import { toast } from "@/hooks/use-toast";

interface BulkActionBarProps {
  selectedGroups: StyleGroup[];
  onClearSelection: () => void;
}

interface TagProgress {
  total: number;
  completed: number;
  failed: number;
  inProgress: boolean;
}

export default function BulkActionBar({ selectedGroups, onClearSelection }: BulkActionBarProps) {
  const queryClient = useQueryClient();
  const [tagProgress, setTagProgress] = useState<TagProgress | null>(null);
  const [workflowValue, setWorkflowValue] = useState<string>("");

  // Bulk AI tag — fetch all assets across selected groups, then tag sequentially
  const handleBulkAiTag = async () => {
    const groupIds = selectedGroups.map(g => g.id);
    const { data: groupAssets, error } = await supabase
      .from("assets")
      .select("id, thumbnail_url")
      .in("style_group_id", groupIds)
      .eq("is_deleted", false);

    if (error || !groupAssets) {
      toast({ title: "Failed to fetch assets", description: error?.message, variant: "destructive" });
      return;
    }

    const taggable = groupAssets.filter((a) => a.thumbnail_url);
    if (taggable.length === 0) {
      toast({ title: "No taggable assets", description: "Selected groups have no assets with thumbnails.", variant: "destructive" });
      return;
    }

    setTagProgress({ total: taggable.length, completed: 0, failed: 0, inProgress: true });

    let completed = 0;
    let failed = 0;

    for (const asset of taggable) {
      try {
        const { error } = await supabase.functions.invoke("ai-tag", {
          body: { asset_id: asset.id, thumbnail_url: asset.thumbnail_url },
        });
        if (error) throw error;
        completed++;
      } catch {
        failed++;
      }
      setTagProgress({ total: taggable.length, completed, failed, inProgress: true });
    }

    setTagProgress({ total: taggable.length, completed, failed, inProgress: false });
    queryClient.invalidateQueries({ queryKey: ["style-groups"] });

    if (failed === 0) {
      toast({ title: `AI tagged ${completed} asset${completed !== 1 ? "s" : ""} across ${selectedGroups.length} group${selectedGroups.length !== 1 ? "s" : ""}` });
    } else {
      toast({
        title: `Tagged ${completed}, failed ${failed}`,
        variant: "destructive",
      });
    }

    setTimeout(() => setTagProgress(null), 3000);
  };

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

  const progressPercent = tagProgress
    ? Math.round(((tagProgress.completed + tagProgress.failed) / tagProgress.total) * 100)
    : 0;

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
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={handleBulkAiTag}
        disabled={tagProgress?.inProgress}
      >
        {tagProgress?.inProgress ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        AI Tag
      </Button>

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
      {tagProgress && (
        <div className="flex items-center gap-2 ml-auto">
          {tagProgress.inProgress ? (
            <>
              <Progress value={progressPercent} className="w-32 h-2" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {tagProgress.completed + tagProgress.failed}/{tagProgress.total}
              </span>
            </>
          ) : (
            <div className="flex items-center gap-1.5 text-xs">
              {tagProgress.failed === 0 ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  <span className="text-success">Done</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-3.5 w-3.5 text-warning" />
                  <span className="text-warning">{tagProgress.failed} failed</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
