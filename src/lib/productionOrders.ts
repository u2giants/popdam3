import { supabase } from "@/integrations/supabase/client";

/** One PLM production order containing a design (popdam3#1272). */
export interface StyleProductionOrder {
  id: string;
  prod_order_number: string;
  order_status: string | null;
  customer_name: string | null;
  quantity: number | null;
  due_date: string | null;
  order_date: string | null;
  erp_updated_at: string | null;
}

type ApiRow = {
  production_order_id: string;
  production_order_number: string;
  status: string | null;
  customer_name: string | null;
  quantity: number | string | null;
  order_date: string | null;
  due_date: string | null;
  updated_at: string | null;
};

/** Map shared-database rows to the panel's shape, soonest due first. */
export function toStyleProductionOrders(rows: ApiRow[]): StyleProductionOrder[] {
  return rows
    .map((r) => ({
      id: r.production_order_id,
      prod_order_number: r.production_order_number,
      order_status: r.status,
      customer_name: r.customer_name,
      quantity: r.quantity == null ? null : Number(r.quantity),
      due_date: r.due_date,
      order_date: r.order_date,
      erp_updated_at: r.updated_at,
    }))
    .sort((a, b) =>
      (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
      a.prod_order_number.localeCompare(b.prod_order_number));
}

/**
 * Production orders live in the shared database (plm.production_order*), so
 * PopDAM reads them there instead of keeping a copy.
 */
export async function fetchStyleProductionOrders(sku: string): Promise<StyleProductionOrder[]> {
  const { data, error } = await (supabase as any)
    .schema("api")
    .rpc("dam_production_orders_for_sku", { p_sku: sku });
  if (error) throw error;
  return toStyleProductionOrders((data ?? []) as ApiRow[]);
}
