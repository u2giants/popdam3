import { useState, useEffect } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Loader2, XCircle, Monitor, Server, Check } from "lucide-react";
import { AgentStatusBadges, AgentStatusInfo, MethodBadge, ProgressInfo, stepLabel } from "./shared";

export function LiveProgressPanel({ request, agentStatuses, targetAgentType }: {
  request: Record<string, unknown>;
  agentStatuses: AgentStatusInfo[];
  targetAgentType: string;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const status = request.status as string;
  const agentName = (request.claimed_by_agent_name as string) ?? null;
  const progress = request.progress as ProgressInfo | undefined;
  const requestedAt = request.requested_at as string | undefined;
  const errorMsg = request.error as string | undefined;

  const isProcessing = status === "processing";
  const isPending = status === "pending";
  const isError = status === "error";

  const processed = progress?.processed ?? 0;
  const total = progress?.total ?? 0;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const currentFile = progress?.current_file ?? null;
  const currentStep = progress?.current_step ?? null;
  const fileResults = progress?.file_results ?? [];

  // Time since requested
  const elapsed = requestedAt
    ? Math.round((nowMs - new Date(requestedAt).getTime()) / 1000)
    : 0;
  const elapsedStr = elapsed > 60
    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
    : `${elapsed}s`;

  // Check if target agents are online
  const targetAgents = agentStatuses.filter((a) => a.type === targetAgentType);
  const anyTargetOnline = targetAgents.some((a) => a.online);

  return (
    <div className="mt-3 space-y-3">
      {/* Agent connectivity status */}
      <AgentStatusBadges agents={agentStatuses} targetType={targetAgentType} />

      {/* Status line */}
      <div className="flex items-center gap-3 text-sm">
        {isPending && !agentName && (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
            <div className="space-y-0.5">
              <span className="text-amber-600">
                Waiting for {targetAgentType === "windows-render" ? "Windows" : "Bridge"} agent to claim… ({elapsedStr})
              </span>
              {!anyTargetOnline && targetAgents.length > 0 && (
                <p className="text-xs text-destructive">
                  ⚠ Target agent{targetAgents.length > 1 ? "s" : ""} ({targetAgents.map((a) => a.name).join(", ")}) {targetAgents.length > 1 ? "are" : "is"} OFFLINE.
                  {" "}Request will auto-timeout at 3 minutes.
                </p>
              )}
              {targetAgents.length === 0 && (
                <p className="text-xs text-destructive">
                  ⚠ No {targetAgentType} agents registered. This request cannot be claimed. Will auto-timeout at 3 minutes.
                </p>
              )}
            </div>
          </>
        )}
        {(isProcessing || (isPending && agentName)) && (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-foreground">
              Processing on{" "}
              <span className="font-medium inline-flex items-center gap-1">
                {agentName?.toLowerCase().includes("windows") ? (
                  <><Monitor className="h-3.5 w-3.5" /> {agentName}</>
                ) : (
                  <><Server className="h-3.5 w-3.5" /> {agentName ?? "agent"}</>
                )}
              </span>
              <span className="text-muted-foreground ml-2">({elapsedStr})</span>
            </span>
          </>
        )}
        {isError && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
              <span className="text-destructive font-medium">Failed</span>
            </div>
            <p className="text-xs text-destructive/90 bg-destructive/5 rounded p-2 font-mono whitespace-pre-wrap">
              {errorMsg ?? "Unknown error"}
            </p>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{processed} / {total} PDFs</span>
            <span>{pct}%</span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>
      )}

      {/* Current file + step */}
      {currentFile && currentStep && currentStep !== "done" && (
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{currentFile}</span>
          {" — "}
          <span className="italic">{stepLabel(currentStep)}</span>
        </p>
      )}

      {/* Live file results */}
      {fileResults.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs py-1">File</TableHead>
                <TableHead className="text-xs py-1">Result</TableHead>
                <TableHead className="text-xs py-1 text-center">Chars</TableHead>
                <TableHead className="text-xs py-1">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fileResults.map((fr, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs font-mono py-1 max-w-[200px] truncate">
                    {fr.filename}
                  </TableCell>
                  <TableCell className="py-1">
                    <MethodBadge method={fr.method} />
                  </TableCell>
                  <TableCell className="text-xs text-center py-1 text-muted-foreground">
                    {fr.chars.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs py-1 text-red-600 max-w-[200px] truncate">
                    {fr.error ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
