import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, Layers, Sparkles, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isAuthoritativeSource,
  tagSourceLabel,
  type EffectiveTag,
  type TagScope,
} from "@/hooks/useEffectiveAssetTags";

/**
 * Renders a file's metadata in the two scopes it actually has:
 *
 *   Style Group — facts shared by every file of this product. They live once on
 *   the group and are never copied onto members.
 *   This file    — facts about this file alone: what kind of file it is, the
 *   view, the colours, what is visible in it.
 *
 * Editing defaults to "This file". A group edit is possible but has to be chosen
 * deliberately, so a group fact can never be created by accident while someone
 * is tidying up one image.
 */

export type ScopedTagAction = (input: {
  scope: TagScope;
  tag: string;
  action: "add" | "remove" | "approve" | "demote" | "restore";
}) => void | Promise<void>;

function confidenceLabel(tag: EffectiveTag): string {
  if (tag.confidence == null) return "";
  return ` · ${Math.round(tag.confidence * 100)}% confident`;
}

export function TagChip({
  tag,
  editable,
  onAction,
  busy,
  canReview = false,
  canEditGroup = false,
}: {
  tag: EffectiveTag;
  editable: boolean;
  onAction?: ScopedTagAction;
  busy?: boolean;
  /** Confirming or restoring a suggestion makes it searchable for everyone. */
  canReview?: boolean;
  /** Group facts change what every colleague sees. */
  canEditGroup?: boolean;
}) {
  const authoritative = isAuthoritativeSource(tag.source);
  const isCandidate = tag.status === "candidate";
  const isRejected = tag.status === "rejected";
  const label = tagSourceLabel(tag.source);
  const mayChange = tag.scope === "style_group" ? canEditGroup : true;
  const title = [
    `${label} · ${tag.category.replace(/_/g, " ")}`,
    tag.model ? `Model: ${tag.model}` : "",
    isCandidate ? "Awaiting review" : "",
    isRejected ? "Rejected — AI cannot bring this back" : "",
  ].filter(Boolean).join(" · ") + confidenceLabel(tag);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex"><Badge
          variant="secondary"
          className={cn(
            "text-xs gap-1",
            isRejected && "line-through opacity-60",
            isCandidate && "border border-dashed",
            authoritative ? "bg-accent text-accent-foreground" : "bg-tag text-tag-foreground",
          )}
        >
          {!authoritative && <Sparkles className="h-2.5 w-2.5 opacity-60" />}
          {tag.tag}
          {editable && onAction && mayChange && canReview && !isRejected && isCandidate && (
            <button
              type="button"
              disabled={busy}
              aria-label={`Confirm ${tag.tag}`}
              onClick={() => onAction({ scope: tag.scope, tag: tag.tag, action: "approve" })}
              className="ml-0.5 hover:text-primary"
            >
              <Check className="h-2.5 w-2.5" />
            </button>
          )}
          {editable && onAction && mayChange && canReview && isRejected && (
            <button
              type="button"
              disabled={busy}
              aria-label={`Restore ${tag.tag}`}
              onClick={() => onAction({ scope: tag.scope, tag: tag.tag, action: "restore" })}
              className="ml-0.5 hover:text-primary"
            >
              <Undo2 className="h-2.5 w-2.5" />
            </button>
          )}
          {editable && onAction && mayChange && !isRejected && !authoritative && (
            <button
              type="button"
              disabled={busy}
              aria-label={`Remove ${tag.tag}`}
              onClick={() => onAction({ scope: tag.scope, tag: tag.tag, action: "remove" })}
              className="ml-0.5 hover:text-destructive"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </Badge></span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-center text-xs">{title}</TooltipContent>
    </Tooltip>
  );
}

function SectionHeading({ children, hint }: { children: React.ReactNode; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <h5
          className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider"
          style={{ color: "var(--pd-fg-muted)" }}
        >
          {children}
        </h5>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] text-center text-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}

export function ScopedTagSections({
  groupTags,
  groupCandidates,
  assetTags,
  assetCandidates,
  rejected,
  hasStyleGroup,
  editing,
  busy,
  onAction,
  visualAnalysisUnavailable,
  canReview = false,
  canEditGroup = false,
}: {
  groupTags: EffectiveTag[];
  groupCandidates: EffectiveTag[];
  assetTags: EffectiveTag[];
  assetCandidates: EffectiveTag[];
  rejected: EffectiveTag[];
  hasStyleGroup: boolean;
  editing: boolean;
  busy?: boolean;
  onAction: ScopedTagAction;
  visualAnalysisUnavailable?: boolean;
  canReview?: boolean;
  canEditGroup?: boolean;
}) {
  // Editing defaults to "This file" so a group fact is never created by accident.
  const [editScope, setEditScope] = useState<TagScope>("asset");
  const [tagInput, setTagInput] = useState("");

  const submit = async () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag) return;
    await onAction({ scope: editScope, tag, action: "add" });
    setTagInput("");
    // Return to "This file" so a group scope can never persist unnoticed into
    // the next add.
    setEditScope("asset");
  };

  return (
    <div className="space-y-3">
      {hasStyleGroup && (
        <div className="space-y-1.5">
          <SectionHeading hint="Shared by every file of this product. Stored once on the Style Group — never copied onto individual files.">
            <Layers className="h-3 w-3" /> Style Group
          </SectionHeading>
          <div className="flex flex-wrap gap-1.5">
            {groupTags.length === 0 && (
              <span className="text-xs" style={{ color: "var(--pd-fg-subtle)" }}>No shared facts yet</span>
            )}
            {groupTags.map((tag) => (
              <TagChip key={`g-${tag.tag}`} tag={tag} editable={editing} onAction={onAction} busy={busy} canReview={canReview} canEditGroup={canEditGroup} />
            ))}
          </div>
          {groupCandidates.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px]" style={{ color: "var(--pd-fg-subtle)" }}>
                Suggested for the group — confirm to make these searchable
              </span>
              <div className="flex flex-wrap gap-1.5">
                {groupCandidates.map((tag) => (
                  <TagChip key={`gc-${tag.tag}`} tag={tag} editable={editing} onAction={onAction} busy={busy} canReview={canReview} canEditGroup={canEditGroup} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <SectionHeading hint="Describes this file only — its kind, view, colours, and what is visible in it. Changing it never affects the other files in the group.">
          This file
        </SectionHeading>
        {visualAnalysisUnavailable && (
          <p className="text-[11px]" style={{ color: "var(--pd-fg-subtle)" }}>
            Visual analysis unavailable — this file has no usable preview. It is still findable through its Style Group.
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {assetTags.length === 0 && !visualAnalysisUnavailable && (
            <span className="text-xs" style={{ color: "var(--pd-fg-subtle)" }}>No file tags</span>
          )}
          {assetTags.map((tag) => (
            <TagChip key={`a-${tag.tag}`} tag={tag} editable={editing} onAction={onAction} busy={busy} canReview={canReview} canEditGroup={canEditGroup} />
          ))}
        </div>
        {assetCandidates.length > 0 && (
          <div className="space-y-1">
            <span className="text-[11px]" style={{ color: "var(--pd-fg-subtle)" }}>Suggested — confirm to make searchable</span>
            <div className="flex flex-wrap gap-1.5">
              {assetCandidates.map((tag) => (
                <TagChip key={`ac-${tag.tag}`} tag={tag} editable={editing} onAction={onAction} busy={busy} canReview={canReview} canEditGroup={canEditGroup} />
              ))}
            </div>
          </div>
        )}
      </div>

      {editing && rejected.length > 0 && (
        <div className="space-y-1.5">
          <SectionHeading hint="Rejected facts are remembered so an AI rerun cannot bring them back. Restore one if it was rejected by mistake.">
            Rejected
          </SectionHeading>
          <div className="flex flex-wrap gap-1.5">
            {rejected.map((tag) => (
              <TagChip key={`r-${tag.scope}-${tag.tag}`} tag={tag} editable onAction={onAction} busy={busy} canReview={canReview} canEditGroup={canEditGroup} />
            ))}
          </div>
        </div>
      )}

      {editing && (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-1.5">
          <div className="flex gap-1.5">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder={editScope === "asset" ? "Add a fact about this file…" : "Add a shared product fact…"}
              className="h-7 text-xs bg-background"
            />
            <Button type="submit" size="sm" className="h-7 text-xs px-2" disabled={busy}>Add</Button>
          </div>
          {hasStyleGroup && canEditGroup && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px]" style={{ color: "var(--pd-fg-subtle)" }}>Add to:</span>
              <Button
                type="button"
                size="sm"
                variant={editScope === "asset" ? "secondary" : "ghost"}
                className="h-6 px-2 text-[11px]"
                onClick={() => setEditScope("asset")}
              >
                This file
              </Button>
              <Button
                type="button"
                size="sm"
                variant={editScope === "style_group" ? "secondary" : "ghost"}
                className="h-6 px-2 text-[11px]"
                onClick={() => setEditScope("style_group")}
              >
                Whole Style Group
              </Button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
