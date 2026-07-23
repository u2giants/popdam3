import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Single source of truth for DAM customer lists: the curated hub view
 * api.dam_customer_list (active + potential customers only). Replaces the legacy
 * free-text customer facets that were built from style_groups.customer.
 */
export interface DamCustomer {
  id: string;
  /** Canonical picker label: display_name when set, else name. */
  label: string;
}

interface DamCustomerRow {
  id: string;
  name: string | null;
  display_name: string | null;
}

/** The full curated customer list, for assignment pickers (assign any active customer). */
export function useDamCustomers() {
  return useQuery({
    queryKey: ["dam-customers"],
    queryFn: async (): Promise<DamCustomer[]> => {
      const { data, error } = await (supabase as any)
        .schema("api")
        .from("dam_customer_list")
        .select("id, name, display_name");
      if (error) throw error;
      return ((data ?? []) as DamCustomerRow[])
        .map((c) => ({ id: c.id, label: (c.display_name ?? c.name ?? "").trim() }))
        .filter((c) => c.id && c.label)
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

export interface DamCustomerFacet extends DamCustomer {
  count: number;
}

/**
 * Curated customer filter facets for the Library: only hub customers that
 * actually have DAM assets/style groups, with counts and canonical labels.
 * Sourced from the get_dam_customer_facets RPC.
 */
export function useDamCustomerFacets() {
  return useQuery({
    queryKey: ["dam-customer-facets"],
    queryFn: async (): Promise<DamCustomerFacet[]> => {
      const { data, error } = await (supabase.rpc as any)("get_dam_customer_facets");
      if (error) throw error;
      return ((data ?? []) as { id: string; name: string; count: number }[])
        .map((c) => ({ id: c.id, label: c.name, count: c.count }))
        .filter((c) => c.id && c.label);
    },
    staleTime: 60_000,
  });
}
