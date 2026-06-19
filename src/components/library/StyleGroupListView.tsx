import { useState } from "react";
import type { StyleGroup } from "@/hooks/useStyleGroups";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface StyleGroupListViewProps {
  groups: StyleGroup[];
  selectedIds: Set<string>;
  onSelect: (id: string, event: React.MouseEvent) => void;
  isLoading: boolean;
  rebuildHint?: boolean;
}

// ── Workflow tag ─────────────────────────────────────────────────────────────

const WF_STYLES: Record<string, { bg: string; color: string }> = {
  in_progress: { bg: "var(--pd-wf-progress-soft, hsl(38 92% 50% / .15))", color: "var(--pd-wf-progress, hsl(38 80% 40%))" },
  in_review:   { bg: "var(--pd-wf-review-soft,   hsl(210 80% 50% / .15))", color: "var(--pd-wf-review,   hsl(210 70% 45%))" },
  approved:    { bg: "var(--pd-wf-approved-soft,  hsl(142 60% 40% / .15))", color: "var(--pd-wf-approved,  hsl(142 55% 32%))" },
  on_hold:     { bg: "var(--pd-wf-hold-soft,      hsl(0   70% 50% / .15))", color: "var(--pd-wf-hold,      hsl(0   60% 42%))" },
  archived:    { bg: "var(--pd-wf-archived-soft,  hsl(0   0%  50% / .12))", color: "var(--pd-wf-archived,  hsl(0   0%  45%))" },
};

function WfTag({ status }: { status: string }) {
  if (!status || status === "other") return null;
  const s = WF_STYLES[status] ?? { bg: "var(--pd-surface-3)", color: "var(--pd-fg-muted)" };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        fontSize: 10,
        fontWeight: 700,
        borderRadius: 99,
        padding: "2px 8px",
        whiteSpace: "nowrap",
        display: "inline-block",
        letterSpacing: ".02em",
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ── Thumbnail placeholder with hue-based gradient ────────────────────────────

function skuHue(sku: string): number {
  let h = 0;
  for (let i = 0; i < sku.length; i++) h = (h * 31 + sku.charCodeAt(i)) >>> 0;
  return h % 360;
}

function skuInitials(sku: string): string {
  const parts = sku.replace(/[-_]/g, " ").trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return sku.slice(0, 2).toUpperCase();
}

function Thumbnail({ thumbnailUrl, sku }: { thumbnailUrl: string | null; sku: string }) {
  const [imgError, setImgError] = useState(false);
  const hue = skuHue(sku);

  return (
    <div
      style={{
        width: 52,
        height: 40,
        borderRadius: 6,
        overflow: "hidden",
        flexShrink: 0,
        position: "relative",
      }}
    >
      {thumbnailUrl && !imgError ? (
        <img
          src={thumbnailUrl}
          alt={sku}
          loading="lazy"
          onError={() => setImgError(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: `linear-gradient(135deg, hsl(${hue} 55% 60%), hsl(${(hue + 40) % 360} 45% 45%))`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              color: "rgba(255,255,255,0.92)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".04em",
              userSelect: "none",
            }}
          >
            {skuInitials(sku)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Column grid shared between header and rows ────────────────────────────────

const GRID = "52px 1fr minmax(140px,220px) minmax(100px,150px) 50px";
const GAP = 12;
const PAD = "0 18px";

// ── Main component ────────────────────────────────────────────────────────────

export default function StyleGroupListView({
  groups,
  selectedIds,
  onSelect,
  isLoading,
  rebuildHint,
}: StyleGroupListViewProps) {
  if (isLoading && groups.length === 0) {
    return (
      <div style={{ padding: "8px 0" }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 52,
              margin: "2px 18px",
              borderRadius: 6,
              background: "var(--pd-surface-2, hsl(0 0% 94%))",
              opacity: 0.6,
              animation: "pulse 1.4s ease-in-out infinite",
            }}
          />
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "96px 24px",
          textAlign: "center",
          gap: 12,
        }}
      >
        <ImageOff
          style={{ width: 48, height: 48, color: "var(--pd-fg-muted, hsl(0 0% 60%))", opacity: 0.4 }}
        />
        <p style={{ color: "var(--pd-fg-muted, hsl(0 0% 50%))", fontSize: 14, margin: 0 }}>
          {rebuildHint
            ? 'Style group stats are not finalized (rebuild interrupted). Resume "Rebuild Style Groups" in Diagnostics.'
            : "No style groups found"}
        </p>
        {!rebuildHint && (
          <p style={{ color: "var(--pd-fg-subtle, hsl(0 0% 60%))", fontSize: 12, margin: 0, opacity: 0.7 }}>
            Run "Rebuild Style Groups" in Diagnostics to generate groups from your assets
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {/* Header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--pd-surface-2, hsl(0 0% 96%))",
          borderBottom: "1px solid var(--pd-border, hsl(0 0% 88%))",
          display: "grid",
          gridTemplateColumns: GRID,
          gap: GAP,
          padding: PAD,
          alignItems: "center",
          height: 36,
        }}
      >
        {(["Art", "SKU / Property", "Category", "Workflow", "Files"] as const).map((label, i) => (
          <span
            key={label}
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".06em",
              color: "var(--pd-fg-subtle, hsl(0 0% 52%))",
              textAlign: i === 4 ? "right" : "left",
            }}
          >
            {label}
          </span>
        ))}
      </div>

      {/* Rows */}
      {groups.map((group) => {
        const selected = selectedIds.has(group.id);
        const propertyLine = group.is_licensed
          ? [group.licensor_name, group.property_name].filter(Boolean).join(" · ")
          : null;
        const isStatsPending = !group.latest_file_date && (group.asset_count === 0 || group.asset_count == null);

        return (
          <Row
            key={group.id}
            group={group}
            selected={selected}
            propertyLine={propertyLine}
            isStatsPending={isStatsPending}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

// ── Row (isolated for hover state) ────────────────────────────────────────────

function Row({
  group,
  selected,
  propertyLine,
  isStatsPending,
  onSelect,
}: {
  group: StyleGroup;
  selected: boolean;
  propertyLine: string | null;
  isStatsPending: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={(e) => onSelect(group.id, e)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "52px 1fr minmax(140px,220px) minmax(100px,150px) 50px",
        gap: 12,
        padding: "8px 18px",
        alignItems: "center",
        minHeight: 52,
        cursor: "pointer",
        borderBottom: "1px solid var(--pd-border, hsl(0 0% 90%))",
        background: selected
          ? "var(--pd-accent-soft, hsl(var(--primary) / .08))"
          : hovered
          ? "var(--pd-surface, hsl(0 0% 98%))"
          : "transparent",
        borderRadius: hovered && !selected ? 6 : 0,
        transition: "background 0.1s",
      }}
    >
      {/* Art */}
      <Thumbnail thumbnailUrl={group.thumbnail_url} sku={group.sku} />

      {/* SKU / Property */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontWeight: 700,
            fontSize: 13,
            color: "var(--pd-fg, inherit)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={group.sku}
        >
          {group.sku}
        </span>
        {propertyLine && (
          <span
            style={{
              fontSize: 12,
              color: "var(--pd-fg-muted, hsl(0 0% 50%))",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={propertyLine}
          >
            {propertyLine}
          </span>
        )}
      </div>

      {/* Category + Lic/Gen badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {group.product_category && (
          <span
            style={{
              fontSize: 12,
              color: "var(--pd-fg, inherit)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={group.product_category}
          >
            {group.product_category}
          </span>
        )}
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            borderRadius: 99,
            padding: "2px 6px",
            whiteSpace: "nowrap",
            flexShrink: 0,
            background: group.is_licensed
              ? "var(--pd-licensed-soft, hsl(270 60% 55% / .15))"
              : "var(--pd-surface-3, hsl(0 0% 90%))",
            color: group.is_licensed
              ? "var(--pd-licensed, hsl(270 55% 45%))"
              : "var(--pd-fg-muted, hsl(0 0% 50%))",
          }}
        >
          {group.is_licensed ? "Lic" : "Gen"}
        </span>
      </div>

      {/* Workflow */}
      <div>
        <WfTag status={group.workflow_status} />
      </div>

      {/* Files */}
      <span
        style={{
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 12,
          color: "var(--pd-fg-muted, hsl(0 0% 50%))",
          textAlign: "right",
        }}
      >
        {isStatsPending ? "…" : group.asset_count}
      </span>
    </div>
  );
}
