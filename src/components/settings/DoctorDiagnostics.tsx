import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Stethoscope, RefreshCw, AlertCircle, AlertTriangle, Info,
  CheckCircle2, Loader2, ChevronRight, Zap,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────

interface DoctorIssue {
  severity: "critical" | "warn" | "info";
  code: string;
  title: string;
  details: string;
  recommended_fix: string;
  fix_action?: string;
  fix_payload?: Record<string, unknown>;
}

// ── Severity config ─────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertCircle,
    badgeClass: "bg-destructive text-destructive-foreground",
    borderClass: "border-destructive/40",
    bgClass: "bg-destructive/5",
    label: "Critical",
  },
  warn: {
    icon: AlertTriangle,
    badgeClass: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground,0_0%_0%))]",
    borderClass: "border-[hsl(var(--warning)/0.4)]",
    bgClass: "bg-[hsl(var(--warning)/0.05)]",
    label: "Warning",
  },
  info: {
    icon: Info,
    badgeClass: "bg-[hsl(var(--info))] text-[hsl(var(--info-foreground,0_0%_100%))]",
    borderClass: "border-[hsl(var(--info)/0.3)]",
    bgClass: "bg-[hsl(var(--info)/0.05)]",
    label: "Info",
  },
} as const;

// ── Fix action labels ───────────────────────────────────────────────

const FIX_ACTION_LABELS: Record<string, string> = {
  "reset-scan-state": "Reset Scan State",
  "resume-scanning": "Clear Stop Flags",
  "request-path-test": "Request Path Test",
  "retry-failed-renders": "Requeue Failed Renders",
  "retry-failed-jobs": "Retry Failed Jobs",
};

// ── Issue Card ──────────────────────────────────────────────────────

function IssueCard({
  issue,
  onFix,
  isFixing,
}: {
  issue: DoctorIssue;
  onFix: (action: string, payload?: Record<string, unknown>) => void;
  isFixing: boolean;
}) {
  const sev = SEVERITY_CONFIG[issue.severity];
  const SevIcon = sev.icon;

  return (
    <div className={`border ${sev.borderClass} ${sev.bgClass} rounded-lg p-4 space-y-2`}>
      <div className="flex items-start gap-3">
        <SevIcon className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`text-[10px] px-1.5 py-0 ${sev.badgeClass}`}>
              {sev.label}
            </Badge>
            <span className="font-semibold text-sm">{issue.title}</span>
            <code className="text-[10px] text-muted-foreground font-mono ml-auto hidden sm:block">
              {issue.code}
            </code>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {issue.details}
          </p>
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <ChevronRight className="h-3 w-3 text-primary shrink-0" />
            <span className="text-sm text-foreground">
              {issue.recommended_fix}
            </span>
            {issue.fix_action && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-7 text-xs ml-auto"
                onClick={() => onFix(issue.fix_action!, issue.fix_payload)}
                disabled={isFixing}
              >
                {isFixing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Zap className="h-3 w-3" />
                )}
                {FIX_ACTION_LABELS[issue.fix_action] || issue.fix_action}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export default function DoctorDiagnostics() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [fixingAction, setFixingAction] = useState<string | null>(null);

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin-doctor"],
    queryFn: () => call("doctor"),
    refetchInterval: 30_000,
  });

  const issues: DoctorIssue[] = data?.issues || [];
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warnCount = issues.filter((i) => i.severity === "warn").length;
  const allClear = issues.length === 1 && issues[0].code === "ALL_CLEAR";

  const handleFix = useCallback(
    async (action: string, payload?: Record<string, unknown>) => {
      setFixingAction(action);
      try {
        await call(action, payload || {});
        toast.success(`${FIX_ACTION_LABELS[action] || action} completed`);
        // Refresh doctor after fix
        setTimeout(() => {
          refetch();
          queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
          queryClient.invalidateQueries({ queryKey: ["admin-config"] });
        }, 1000);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setFixingAction(null);
      }
    },
    [call, refetch, queryClient]
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Stethoscope className="h-4 w-4" /> Doctor
          {!isLoading && !allClear && (
            <div className="flex items-center gap-1.5 ml-2">
              {criticalCount > 0 && (
                <Badge className="bg-destructive text-destructive-foreground text-[10px] px-1.5">
                  {criticalCount} critical
                </Badge>
              )}
              {warnCount > 0 && (
                <Badge className="bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground,0_0%_0%))] text-[10px] px-1.5">
                  {warnCount} warning{warnCount > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          )}
          {allClear && (
            <Badge className="bg-[hsl(var(--success))] text-[hsl(var(--success-foreground,0_0%_100%))] text-[10px] ml-2 gap-1">
              <CheckCircle2 className="h-3 w-3" /> All Clear
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {dataUpdatedAt > 0 && (
            <span>Updated {new Date(dataUpdatedAt).toLocaleTimeString()}</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && issues.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Running diagnostics…
          </div>
        ) : (
          <div className="space-y-3">
            {issues.map((issue, idx) => (
              <IssueCard
                key={`${issue.code}-${idx}`}
                issue={issue}
                onFix={handleFix}
                isFixing={fixingAction === issue.fix_action}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
