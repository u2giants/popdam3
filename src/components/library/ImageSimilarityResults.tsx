import { X, ImageIcon, Loader2, TriangleAlert, Clock } from "lucide-react";
import {
  BAND_LABELS,
  IMAGE_SIM_DEFAULTS,
  bandForScore,
  type ImageSimMatch,
} from "@/lib/image-similarity-config";

export type ImageSimilarityPhase =
  | { kind: "uploading" }
  | { kind: "pending"; sinceMs: number }
  | { kind: "done"; matches: ImageSimMatch[]; floor: number; truncated: boolean }
  | { kind: "rejected"; reason?: string | null }
  | { kind: "unavailable"; reason?: string | null }
  | { kind: "error"; message: string };

const BAND_COLORS: Record<string, string> = {
  same_export: "var(--pd-accent)",
  same_art: "hsl(var(--success))",
  close: "hsl(var(--warning))",
  review: "var(--pd-fg-muted)",
};

function Chip({ band }: { band: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: "18px",
        padding: "0 7px",
        borderRadius: "9px",
        fontSize: "10px",
        fontWeight: 600,
        letterSpacing: "0.02em",
        background: "color-mix(in srgb, " + (BAND_COLORS[band] ?? "var(--pd-fg-muted)") + " 15%, transparent)",
        color: BAND_COLORS[band] ?? "var(--pd-fg-muted)",
        whiteSpace: "nowrap",
      }}
    >
      {BAND_LABELS[band as keyof typeof BAND_LABELS] ?? band}
    </span>
  );
}

function MatchCard({ match, floor }: { match: ImageSimMatch; floor: number }) {
  const band = bandForScore(match.combined_pct, { floor });
  return (
    <a
      href={match.thumbnail_url}
      target="_blank"
      rel="noreferrer"
      title={`${match.filename}\n${match.relative_path}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px",
        borderRadius: "8px",
        border: "1px solid var(--pd-border)",
        background: "var(--pd-surface)",
        textDecoration: "none",
        color: "inherit",
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          borderRadius: "6px",
          overflow: "hidden",
          background: "var(--pd-accent-soft, rgba(127,127,127,0.08))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {match.thumbnail_url ? (
          <img
            src={match.thumbnail_url}
            alt={match.filename}
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <ImageIcon style={{ width: 22, height: 22, color: "var(--pd-fg-muted)" }} />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
        <strong style={{ fontSize: "13px", fontVariantNumeric: "tabular-nums", color: "var(--pd-fg)" }}>
          {match.combined_pct.toFixed(1)}%
        </strong>
        {band && <Chip band={band} />}
      </div>
      <div
        style={{
          fontSize: "11px",
          color: "var(--pd-fg-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={match.filename}
      >
        {match.filename}
      </div>
      {match.sku && (
        <div style={{ fontSize: "10px", color: "var(--pd-fg-muted)" }}>{match.sku}</div>
      )}
    </a>
  );
}

export default function ImageSimilarityResults({
  phase,
  onClose,
}: {
  phase: ImageSimilarityPhase;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        padding: "12px 18px",
        borderBottom: "1px solid var(--pd-border)",
        background: "var(--pd-surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--pd-fg)" }}>
          Find same artwork
        </span>
        <span style={{ fontSize: "12px", color: "var(--pd-fg-muted)" }}>
          {phase.kind === "done" && `${phase.matches.length} match${phase.matches.length === 1 ? "" : "es"} at ${Math.round(phase.floor * 100)}%+`}
          {phase.kind === "pending" && "Embedding your picture…"}
          {phase.kind === "uploading" && "Uploading…"}
          {phase.kind === "rejected" && "That picture was rejected"}
          {phase.kind === "unavailable" && "Image search is temporarily unavailable"}
          {phase.kind === "error" && "Something went wrong"}
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "24px",
            height: "24px",
            borderRadius: "5px",
            border: "1px solid var(--pd-border)",
            background: "transparent",
            color: "var(--pd-fg-muted)",
            cursor: "pointer",
          }}
        >
          <X style={{ width: 13, height: 13 }} />
        </button>
      </div>

      {phase.kind === "uploading" && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--pd-fg-muted)" }}>
          <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
          Sending your picture to the embed worker…
        </div>
      )}

      {phase.kind === "pending" && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--pd-fg-muted)" }}>
          <Clock style={{ width: 14, height: 14 }} />
          The embed worker is processing the upload. Results appear automatically.
        </div>
      )}

      {(phase.kind === "rejected" || phase.kind === "unavailable" || phase.kind === "error") && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px", color: "var(--pd-fg-muted)" }}>
          <TriangleAlert style={{ width: 14, height: 14, flexShrink: 0, marginTop: "2px", color: "hsl(var(--warning))" }} />
          <span>
            {phase.kind === "error" ? phase.message : phase.reason ?? "Try again in a moment."}
            {phase.kind === "unavailable" && " No image embed worker is currently active — uploads resume when a worker reconnects."}
          </span>
        </div>
      )}

      {phase.kind === "done" && (
        <>
          {phase.matches.length === 0 ? (
            <div style={{ fontSize: "13px", color: "var(--pd-fg-muted)" }}>
              No library artwork scored {Math.round(phase.floor * 100)}% or higher.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                gap: "8px",
              }}
            >
              {phase.matches.map((match) => (
                <MatchCard key={match.asset_id} match={match} floor={phase.floor} />
              ))}
            </div>
          )}
          {phase.truncated && (
            <div style={{ fontSize: "11px", color: "var(--pd-fg-muted)" }}>
              Showing the top {phase.matches.length} matches (result list truncated).
            </div>
          )}
        </>
      )}
    </div>
  );
}
