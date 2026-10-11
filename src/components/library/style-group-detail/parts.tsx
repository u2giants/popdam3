import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Copy, Check, FileText } from "lucide-react";

/* ── Tiny helpers ─────────────────────────────────────────── */

export function CopyInlineButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const btn = (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={copy}
    >
      {copied ? <Check className="h-3 w-3 text-[hsl(var(--success))]" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
  if (!label) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side="top">{copied ? "Copied!" : `Copy ${label}`}</TooltipContent>
    </Tooltip>
  );
}

export function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDateValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, "MMM d, yyyy");
}

/** Full-screen lightbox for viewing images */
export function Lightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <img
        src={url}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/* ── Section label ────────────────────────────────────────── */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-[700] uppercase tracking-widest text-[var(--pd-fg-subtle,hsl(var(--muted-foreground)/0.6))] mb-2">
      {children}
    </p>
  );
}

/* ── Rich product details (from tech-pack / licensing-sheet PDF extraction) ── */
export function RichProductDetails({ rich }: { rich?: Record<string, unknown> | null }) {
  if (!rich || typeof rich !== "object") return null;
  const r = rich as Record<string, any>;
  const specs = (r.production_specs ?? {}) as Record<string, any>;
  const compliance = (r.compliance ?? {}) as Record<string, any>;

  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const colors = arr(
    (Array.isArray(r.colors) ? r.colors : []).map((c: any) => c?.pantone || c?.name).filter(Boolean),
  );

  const rows: Array<[string, React.ReactNode]> = [];
  const push = (label: string, value: React.ReactNode) => {
    if (value) rows.push([label, value]);
  };
  push("Dimensions", specs.dimensions);
  push("Materials", arr(specs.materials).join(", ") || null);
  push("Finish", arr(specs.finish).join(", ") || null);
  push("Hardware", arr(specs.hardware).join(", ") || null);
  push("Packaging", specs.packaging);
  push("Print process", specs.print_process);
  push("Colors", colors.join(", ") || null);
  push("Compliance", arr(compliance.regulatory).join(", ") || null);
  push("Age rating", compliance.age_rating);
  push("Origin", compliance.country_of_origin);
  push("Style guide ref", typeof r.style_guide_reference === "string" ? r.style_guide_reference : null);
  push("Approved", typeof r.approval_date === "string" ? r.approval_date : null);

  if (rows.length === 0) return null;

  return (
    <div>
      <SectionLabel>
        <span className="flex items-center gap-1.5"><FileText className="h-3 w-3" /> Product Details</span>
      </SectionLabel>
      <dl className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[96px_1fr] gap-2 text-[12px]">
            <dt className="text-muted-foreground/70">{label}</dt>
            <dd className="text-foreground break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ── Details DL row ───────────────────────────────────────── */
export function DlRow({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children || children === "—") return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <dt className="text-[12.5px] text-[var(--pd-fg-muted,hsl(var(--muted-foreground)))] shrink-0">{label}</dt>
      <dd className="text-[13px] text-[var(--pd-fg,hsl(var(--foreground)))] text-right min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{children}</dd>
    </div>
  );
}

/* ── File type tile colors ─────────────────────────────────── */
export function fileTypeTileClass(fileType: string): string {
  const t = (fileType ?? "").toLowerCase();
  if (t === "ai") return "bg-[#FF7900] text-white";
  if (t === "psd") return "bg-[#31A8FF] text-white";
  if (t === "pdf") return "bg-[#E13D34] text-white";
  if (t === "eps") return "bg-[#9B59B6] text-white";
  if (t === "png" || t === "jpg" || t === "jpeg" || t === "webp") return "bg-[#27AE60] text-white";
  if (t === "svg") return "bg-[#F39C12] text-white";
  return "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]";
}

/* ── Find Alternative Images component ────────────────────── */
