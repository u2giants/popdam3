import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CrawlStatus = "idle" | "queued" | "running" | "completed" | "failed";

export interface CrawlProgress {
  status: CrawlStatus;
  requestId?: string;
  filesFound?: number;
  completedAt?: string;
  error?: string;
}

const DEFAULT: CrawlProgress = { status: "idle" };

async function fetchCrawlProgress(): Promise<CrawlProgress> {
  const { data, error } = await supabase
    .from("admin_config")
    .select("value")
    .eq("key", "STYLE_GUIDE_CRAWL_REQUEST")
    .maybeSingle();

  if (error || !data?.value) return DEFAULT;

  const v = data.value as Record<string, unknown>;
  const rawStatus = v.status as string;

  let status: CrawlStatus = "idle";
  if (rawStatus === "pending") status = "queued";
  else if (rawStatus === "claimed") status = "running";
  else if (rawStatus === "completed") status = "completed";
  else if (rawStatus === "failed") status = "failed";

  return {
    status,
    requestId: v.request_id as string | undefined,
    filesFound: v.files_found as number | undefined,
    completedAt: v.completed_at as string | undefined,
    error: v.error as string | undefined,
  };
}

export function useCrawlProgress(): CrawlProgress {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["crawl-progress"],
    queryFn: fetchCrawlProgress,
    staleTime: Infinity,
    placeholderData: DEFAULT,
  });

  useEffect(() => {
    const channel = supabase
      .channel("crawl-progress-realtime")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "admin_config",
        filter: "key=eq.STYLE_GUIDE_CRAWL_REQUEST",
      }, () => queryClient.invalidateQueries({ queryKey: ["crawl-progress"] }))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  return data ?? DEFAULT;
}
