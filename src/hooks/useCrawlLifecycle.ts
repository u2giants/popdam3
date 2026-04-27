import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAdminApi } from "./useAdminApi";
import type { CrawlProgress, CrawlStatus } from "./useCrawlProgress";

export interface CrawlLifecycleState {
  crawlTriggered: boolean;
  handleTriggerCrawl: () => Promise<void>;
}

export function useCrawlLifecycle(
  crawlProgress: CrawlProgress,
  action: string = "trigger-scan",
): CrawlLifecycleState {
  const queryClient = useQueryClient();
  const { call } = useAdminApi();
  const [crawlTriggered, setCrawlTriggered] = useState(false);
  const prevStatusRef = useRef<CrawlStatus>(crawlProgress.status);

  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = crawlProgress.status;
    prevStatusRef.current = curr;
    if (prev === curr) return;

    if (curr === "running" && (prev === "queued" || prev === "idle")) {
      toast("Crawl started", { description: "The Bridge Agent is scanning the NAS…" });
    }

    if (curr === "completed") {
      setCrawlTriggered(false);
      const filesFound = crawlProgress.filesFound;
      const desc = filesFound != null
        ? `${filesFound.toLocaleString()} files indexed`
        : "Library updated";
      toast.success("Crawl complete", { description: desc });
      queryClient.invalidateQueries({ queryKey: ["popsg", "files"] });
      queryClient.invalidateQueries({ queryKey: ["popsg", "tree"] });
    }

    if (curr === "failed") {
      setCrawlTriggered(false);
      toast.error("Crawl failed", { description: crawlProgress.error || "Check Settings for details." });
    }
  }, [crawlProgress.status, crawlProgress.filesFound, crawlProgress.error, queryClient]);

  // Clear crawlTriggered once the agent picks it up
  useEffect(() => {
    if (crawlTriggered && (crawlProgress.status === "running" || crawlProgress.status === "queued")) {
      setCrawlTriggered(false);
    }
  }, [crawlTriggered, crawlProgress.status]);

  // Safety timeout
  useEffect(() => {
    if (!crawlTriggered) return;
    const timer = setTimeout(() => setCrawlTriggered(false), 120_000);
    return () => clearTimeout(timer);
  }, [crawlTriggered]);

  const handleTriggerCrawl = useCallback(async () => {
    try {
      await call(action);
      setCrawlTriggered(true);
      toast("Crawl triggered", { description: "The Bridge Agent will start crawling on its next poll (~30s)." });
    } catch (e) {
      toast.error("Failed to trigger crawl", { description: (e as Error).message });
    }
  }, [call, action]);

  return { crawlTriggered, handleTriggerCrawl };
}
