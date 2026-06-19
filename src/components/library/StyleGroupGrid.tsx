import { useState } from "react";
import type { StyleGroup } from "@/hooks/useStyleGroups";
import type { CardStyle } from "@/types/assets";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── helpers ────────────────────────────────────────────────────────────────

function skuHue(sku: string): number {
  let sum = 0;
  for (let i = 0; i < sku.length; i++) sum += sku.charCodeAt(i);
  return sum % 360;
}

function initials(g: StyleGroup): string {
  const src = g.property_name || g.sku || "";
  return src.slice(0, 2).toUpperCase();
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function fileBadge(count: number): string {
  return `${count} file${count !== 1 ? "s" : ""}`;
}

// ─── WfTag ──────────────────────────────────────────────────────────────────

const WF_MAP: Record<string, { bg: string; color: string; label: string }> = {
  in_progress: { bg: "var(--pd-info-soft)", color: "var(--pd-info)", label: "In progress" },
  in_review:   { bg: "var(--pd-warning-soft)", color: "var(--pd-warning)", label: "In review" },
  approved:    { bg: "var(--pd-success-soft)", color: "var(--pd-success)", label: "Approved" },
  on_hold:     { bg: "var(--pd-surface-3)", color: "var(--pd-fg-muted)", label: "On hold" },
  archived:    { bg: "var(--pd-surface-3)", color: "var(--pd-fg-muted)", label: "Archived" },
};

function WfTag({ status }: { status: string }) {
  const cfg = WF_MAP[status];
  if (!cfg) return null;
  return (
    <span
      style={{
        background: cfg.bg,
        color: cfg.color,
        padding: "2px 7px",
        borderRadius: 5,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
        lineHeight: "1.5",
      }}
    >
      {cfg.label}
    </span>
  );
}

// ─── LicensedBadge ──────────────────────────────────────────────────────────

function LicensedBadge({ licensed }: { licensed: boolean }) {
  return (
    <span
      style={{
        background: licensed ? "var(--pd-licensed-soft)" : "var(--pd-surface-3)",
        color: licensed ? "var(--pd-licensed)" : "var(--pd-fg-muted)",
        padding: "2px 7px",
        borderRadius: 5,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: "1.5",
        whiteSpace: "nowrap",
      }}
    >
      {licensed ? "🔒 Licensed" : "Generic"}
    </span>
  );
}

// ─── Thumbnail placeholder ───────────────────────────────────────────────────

function Placeholder({ hue, inits, style }: { hue: number; inits: string; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(135deg, oklch(0.75 0.06 ${hue}), oklch(0.65 0.09 ${hue}))`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      <span
        style={{
          color: `oklch(0.45 0.08 ${hue})`,
          fontSize: 32,
          fontWeight: 800,
          letterSpacing: 2,
          userSelect: "none",
        }}
      >
        {inits}
      </span>
    </div>
  );
}

// ─── Glass badge ─────────────────────────────────────────────────────────────

function GlassBadge({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        background: "rgba(0,0,0,0.38)",
        backdropFilter: "blur(6px)",
        color: "#fff",
        padding: "2px 8px",
        borderRadius: 5,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: "1.5",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// ─── Card shell styles ───────────────────────────────────────────────────────

const cardBase: React.CSSProperties = {
  background: "var(--pd-surface)",
  border: "1px solid var(--pd-border)",
  borderRadius: 14,
  transition: "all 0.14s",
  overflow: "hidden",
  cursor: "pointer",
  textAlign: "left",
  display: "flex",
  padding: 0,
};

function cardStyle(selected: boolean, hovered: boolean): React.CSSProperties {
  return {
    ...cardBase,
    borderColor: selected
      ? "var(--pd-accent)"
      : hovered
      ? "var(--pd-border-2)"
      : "var(--pd-border)",
    boxShadow: selected
      ? "0 0 0 3px var(--pd-accent-ring)"
      : hovered
      ? "var(--pd-shadow-md)"
      : undefined,
    transform: hovered && !selected ? "translateY(-2px)" : undefined,
  };
}

// ─── Gallery card ────────────────────────────────────────────────────────────

function GalleryCard({
  g,
  selected,
  onSelect,
}: {
  g: StyleGroup;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const [imgErr, setImgErr] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hue = skuHue(g.sku);
  const inits = initials(g);
  const subLine = [g.licensor_name, g.property_name].filter(Boolean).join(" · ") || null;

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...cardStyle(selected, hovered), flexDirection: "column" }}
    >
      {/* 4:3 thumbnail */}
      <div style={{ position: "relative", aspectRatio: "4/3", width: "100%", overflow: "hidden" }}>
        {g.thumbnail_url && !imgErr ? (
          <img
            src={g.thumbnail_url}
            alt={g.sku}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            loading="lazy"
            onError={() => setImgErr(true)}
          />
        ) : (
          <Placeholder hue={hue} inits={inits} />
        )}
        {selected && (
          <div style={{ position: "absolute", inset: 0, background: "var(--pd-accent-ring)", opacity: 0.18 }} />
        )}
        {/* top-left: licensed badge */}
        <div style={{ position: "absolute", top: 8, left: 8 }}>
          <LicensedBadge licensed={g.is_licensed} />
        </div>
        {/* bottom-right: file count */}
        <div style={{ position: "absolute", bottom: 8, right: 8 }}>
          <GlassBadge>{fileBadge(g.asset_count ?? 0)}</GlassBadge>
        </div>
      </div>

      {/* Meta */}
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 13.5,
            fontWeight: 700,
            color: "var(--pd-fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {g.sku}
        </span>
        {subLine && (
          <span
            style={{
              fontSize: 13,
              color: "var(--pd-fg-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subLine}
          </span>
        )}
        {g.cover_description && (
          <span
            style={{
              fontSize: 13,
              color: "var(--pd-fg-subtle)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {g.cover_description}
          </span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {g.workflow_status && <WfTag status={g.workflow_status} />}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--pd-fg-muted)" }}>
            {timeAgo(g.updated_at)}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Editorial card ───────────────────────────────────────────────────────────

function EditorialCard({
  g,
  selected,
  onSelect,
}: {
  g: StyleGroup;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const [imgErr, setImgErr] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hue = skuHue(g.sku);
  const inits = initials(g);
  const categoryCustomer = [g.product_category, g.customer].filter(Boolean).join(" · ") || null;

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...cardStyle(selected, hovered), flexDirection: "column" }}
    >
      {/* 1:1 thumbnail */}
      <div style={{ position: "relative", aspectRatio: "1/1", width: "100%", overflow: "hidden" }}>
        {g.thumbnail_url && !imgErr ? (
          <img
            src={g.thumbnail_url}
            alt={g.sku}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            loading="lazy"
            onError={() => setImgErr(true)}
          />
        ) : (
          <Placeholder hue={hue} inits={inits} />
        )}

        {/* dark gradient overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.18) 55%, transparent 100%)",
          }}
        />
        {selected && (
          <div style={{ position: "absolute", inset: 0, background: "var(--pd-accent-ring)", opacity: 0.18 }} />
        )}

        {/* top-left: licensed */}
        <div style={{ position: "absolute", top: 8, left: 8 }}>
          <LicensedBadge licensed={g.is_licensed} />
        </div>
        {/* top-right: file count */}
        <div style={{ position: "absolute", top: 8, right: 8 }}>
          <GlassBadge>{fileBadge(g.asset_count ?? 0)}</GlassBadge>
        </div>

        {/* bottom overlay text */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "8px 10px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              fontWeight: 600,
              color: "#fff",
              opacity: 0.85,
            }}
          >
            {g.sku}
          </span>
          {g.property_name && (
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "#fff",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {g.property_name}
            </span>
          )}
        </div>
      </div>

      {/* Meta row */}
      <div
        style={{
          padding: "8px 10px",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 12.5,
            color: "var(--pd-fg-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {categoryCustomer}
        </span>
        {g.workflow_status && <WfTag status={g.workflow_status} />}
      </div>
    </button>
  );
}

// ─── Compact card ─────────────────────────────────────────────────────────────

function CompactCard({
  g,
  selected,
  onSelect,
}: {
  g: StyleGroup;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const [imgErr, setImgErr] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hue = skuHue(g.sku);
  const inits = initials(g);
  const subLine = [g.licensor_name, g.property_name].filter(Boolean).join(" · ") || g.product_category || null;

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...cardStyle(selected, hovered), flexDirection: "row", alignItems: "stretch" }}
    >
      {/* 78px thumbnail strip */}
      <div
        style={{
          width: 78,
          flexShrink: 0,
          overflow: "hidden",
          borderRadius: "14px 0 0 14px",
          position: "relative",
        }}
      >
        {g.thumbnail_url && !imgErr ? (
          <img
            src={g.thumbnail_url}
            alt={g.sku}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            loading="lazy"
            onError={() => setImgErr(true)}
          />
        ) : (
          <Placeholder hue={hue} inits={inits} style={{ fontSize: 22 } as React.CSSProperties} />
        )}
        {selected && (
          <div style={{ position: "absolute", inset: 0, background: "var(--pd-accent-ring)", opacity: 0.18 }} />
        )}
      </div>

      {/* Meta */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: "10px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--pd-fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {g.sku}
        </span>
        {subLine && (
          <span
            style={{
              fontSize: 12.5,
              color: "var(--pd-fg-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subLine}
          </span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {g.workflow_status && <WfTag status={g.workflow_status} />}
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "monospace",
              fontSize: 12,
              color: "var(--pd-fg-muted)",
              whiteSpace: "nowrap",
            }}
          >
            {fileBadge(g.asset_count ?? 0)}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard({ cardStyle: cs }: { cardStyle: CardStyle }) {
  const isCompact = cs === "compact";
  return (
    <div
      className="animate-pulse"
      style={{
        ...cardBase,
        flexDirection: isCompact ? "row" : "column",
        cursor: "default",
      }}
    >
      {isCompact ? (
        <>
          <div style={{ width: 78, height: 68, background: "var(--pd-surface-3)", flexShrink: 0 }} />
          <div style={{ flex: 1, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ height: 13, width: "60%", background: "var(--pd-surface-3)", borderRadius: 4 }} />
            <div style={{ height: 12, width: "80%", background: "var(--pd-surface-3)", borderRadius: 4, opacity: 0.6 }} />
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              aspectRatio: cs === "editorial" ? "1/1" : "4/3",
              width: "100%",
              background: "var(--pd-surface-3)",
            }}
          />
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ height: 14, width: "55%", background: "var(--pd-surface-3)", borderRadius: 4 }} />
            <div style={{ height: 12, width: "75%", background: "var(--pd-surface-3)", borderRadius: 4, opacity: 0.6 }} />
          </div>
        </>
      )}
    </div>
  );
}

// ─── StyleGroupGridProps ───────────────────────────────────────────────────────

interface StyleGroupGridProps {
  groups: StyleGroup[];
  selectedIds: Set<string>;
  onSelect: (id: string, event: React.MouseEvent) => void;
  isLoading: boolean;
  cardStyle: CardStyle;
  rebuildHint?: boolean;
}

// ─── StyleGroupGrid ───────────────────────────────────────────────────────────

export default function StyleGroupGrid({
  groups,
  selectedIds,
  onSelect,
  isLoading,
  cardStyle: cs,
  rebuildHint,
}: StyleGroupGridProps) {
  const cardMin = cs === "editorial" ? "208px" : cs === "compact" ? "280px" : "232px";

  if (isLoading && groups.length === 0) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${cardMin}, 1fr))`,
          gap: 12,
          padding: 18,
        }}
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <SkeletonCard key={i} cardStyle={cs} />
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ImageOff className="h-12 w-12 mb-4" style={{ color: "var(--pd-fg-muted)", opacity: 0.35 }} />
        <p style={{ color: "var(--pd-fg-muted)" }}>
          {rebuildHint
            ? 'Style group stats are not finalized (rebuild interrupted). Resume "Rebuild Style Groups" in Diagnostics.'
            : "No style groups found"}
        </p>
        {!rebuildHint && (
          <p style={{ fontSize: 12, color: "var(--pd-fg-muted)", opacity: 0.6, marginTop: 4 }}>
            Run "Rebuild Style Groups" in Diagnostics to generate groups from your assets
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${cardMin}, 1fr))`,
        gap: 12,
        padding: 18,
      }}
    >
      {groups.map((g) => {
        const selected = selectedIds.has(g.id);
        const handler = (e: React.MouseEvent) => onSelect(g.id, e);
        if (cs === "editorial") return <EditorialCard key={g.id} g={g} selected={selected} onSelect={handler} />;
        if (cs === "compact") return <CompactCard key={g.id} g={g} selected={selected} onSelect={handler} />;
        return <GalleryCard key={g.id} g={g} selected={selected} onSelect={handler} />;
      })}
    </div>
  );
}
