import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { ORDER_LIST_SUMMARY_QUERY_KEY } from "@/hooks/useOrderList";
import { TRIAGE_SELECT, buildTriageItems, type TriageAction, type TriageRow } from "@/lib/coldlion-triage";

export const COLDLION_TRIAGE_QUERY_KEY = ["coldlion-triage"] as const;

function orderListTable() {
  return (supabase as any).schema("api").from("dam_order_list");
}

export function useColdLionTriage() {
  return useQuery({
    queryKey: COLDLION_TRIAGE_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await orderListTable()
        .select(TRIAGE_SELECT)
        .or("coldlion_quantity_ordered.not.is.null,coldlion_import_po.not.is.null,coldlion_unmatched.is.true")
        .limit(1000);
      if (error) throw error;
      return buildTriageItems((data ?? []) as TriageRow[]);
    },
  });
}

/** Open Google OrderList lines with the same SKU, for linking an unmatched ColdLion line. */
export function useColdLionLinkCandidates(sku: string | null) {
  return useQuery({
    queryKey: ["coldlion-triage-candidates", sku],
    enabled: Boolean(sku),
    queryFn: async () => {
      const { data, error } = await orderListTable()
        .select(TRIAGE_SELECT)
        .eq("sku", sku)
        .not("google_source_id", "is", null)
        .is("coldlion_source_id", null)
        .is("line_voided_at", null)
        .limit(50);
      if (error) throw error;
      return (data ?? []) as TriageRow[];
    },
  });
}

export function useResolveColdLionTriage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { line: string; action: TriageAction; target?: string | null }) => {
      const { data, error } = await (supabase.rpc as any)("resolve_coldlion_triage", {
        p_line: input.line,
        p_action: input.action,
        p_target: input.target ?? null,
      });
      if (error) throw error;
      return String(data ?? "Done.");
    },
    onSuccess: (message) => {
      toast.success(message);
      void queryClient.invalidateQueries({ queryKey: COLDLION_TRIAGE_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["coldlion-triage-candidates"] });
      void queryClient.invalidateQueries({ queryKey: ORDER_LIST_SUMMARY_QUERY_KEY });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey: COLDLION_TRIAGE_QUERY_KEY });
    },
  });
}
