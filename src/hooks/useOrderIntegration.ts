import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
  buildTrackingPatch,
  escapeLiteralOrderSearch,
  normalizeCustomerSuffix,
  normalizeRequiredKey,
  normalizeSampleDepth,
} from "@/lib/order-integration";
import type {
  CustomerSuffix,
  OrderTrackingRow,
  SampleDepth,
  VendorStatistic,
} from "@/types/order-integration";

export const ORDER_INTEGRATION_QUERY_KEY = ["order-integration"] as const;
export const ORDER_TRACKING_PAGE_SIZE = 50;
export const ORDER_INTEGRATION_SETTINGS_PAGE_SIZE = 100;
const REFRESH_INTERVAL_MS = 30_000;

type PageSearchOptions = {
  page: number;
  enabled?: boolean;
};

function assertSearchLength(search: string): string {
  if (search.length > 200) throw new Error("Search is limited to 200 characters");
  return search.trim();
}

function authRequired(userId: string | undefined): asserts userId is string {
  if (!userId) throw new Error("Sign in to access order integration data");
}

function asPageRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

export type UseOrderTrackingOptions = PageSearchOptions & {
  search: string;
  onlyOpen: boolean;
  onRowsChanged?: () => void;
};

export type SaveOrderTrackingVariables = {
  orderId: string;
  original: Parameters<typeof buildTrackingPatch>[0];
  changed: Record<string, unknown>;
};
export type UpsertSampleDepthVariables = { sku: string; customerName: string; depth: unknown };
export type UpsertCustomerSuffixVariables = { customerName: string; suffix: unknown };

/** Authenticated, bounded PO tracking page and its admin-only save action. */
export function useOrderTracking({
  page,
  search,
  onlyOpen,
  enabled = true,
  onRowsChanged,
}: UseOrderTrackingOptions) {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const queryClient = useQueryClient();
  const normalizedSearch = search.trim();
  const query = useQuery({
    queryKey: [...ORDER_INTEGRATION_QUERY_KEY, "tracking", page, normalizedSearch, onlyOpen],
    enabled: enabled && Boolean(user),
    queryFn: async (): Promise<OrderTrackingRow[]> => {
      authRequired(user?.id);
      const boundedSearch = assertSearchLength(search);
      const { data, error } = await (supabase.rpc as any)("get_dam_order_tracking", {
        p_offset: page * ORDER_TRACKING_PAGE_SIZE,
        p_limit: ORDER_TRACKING_PAGE_SIZE,
        p_search: boundedSearch || null,
        p_only_open: onlyOpen,
      });
      if (error) throw error;
      return asPageRows<OrderTrackingRow>(data);
    },
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const saveMutation = useMutation({
    mutationFn: async ({ orderId, original, changed }: SaveOrderTrackingVariables) => {
      authRequired(user?.id);
      if (!isAdmin) throw new Error("Administrator access is required to edit PO tracking");
      const p_patch = buildTrackingPatch(original, changed);
      if (Object.keys(p_patch).length === 0) return;
      const { error } = await (supabase.rpc as any)("update_dam_order_tracking", {
        p_order_id: orderId,
        p_patch,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ORDER_INTEGRATION_QUERY_KEY });
      onRowsChanged?.();
    },
  });

  return {
    ...query,
    rows: query.data ?? [],
    hasNextPage: (query.data?.length ?? 0) === ORDER_TRACKING_PAGE_SIZE,
    canEdit: Boolean(user && isAdmin),
    saveTracking: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error,
  };
}

export type UseSampleDepthsOptions = PageSearchOptions & {
  skuSearch: string;
  customerSearch: string;
};

/** Bounded sample-depth view; style and customer searches remain separate filters. */
export function useSampleDepths({ page, skuSearch, customerSearch, enabled = true }: UseSampleDepthsOptions) {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const queryClient = useQueryClient();
  const style = skuSearch.trim();
  const customer = customerSearch.trim();
  const query = useQuery({
    queryKey: [...ORDER_INTEGRATION_QUERY_KEY, "sample-depth", page, style, customer],
    enabled: enabled && Boolean(user),
    queryFn: async (): Promise<SampleDepth[]> => {
      authRequired(user?.id);
      const boundedStyle = assertSearchLength(skuSearch);
      const boundedCustomer = assertSearchLength(customerSearch);
      let request = (supabase as any)
        .schema("api")
        .from("dam_order_sample_depth")
        .select("sku_normalized,customer_normalized,depth_inches,depth_raw,source_workbook_id,source_row_number,updated_at,updated_by")
        .order("sku_normalized", { ascending: true })
        .order("customer_normalized", { ascending: true });
      if (boundedStyle) request = request.ilike("sku_normalized", `%${escapeLiteralOrderSearch(boundedStyle)}%`);
      if (boundedCustomer) request = request.ilike("customer_normalized", `%${escapeLiteralOrderSearch(boundedCustomer)}%`);
      const { data, error } = await request.range(
        page * ORDER_INTEGRATION_SETTINGS_PAGE_SIZE,
        (page + 1) * ORDER_INTEGRATION_SETTINGS_PAGE_SIZE - 1,
      );
      if (error) throw error;
      return asPageRows<SampleDepth>(data);
    },
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const mutation = useMutation({
    mutationFn: async ({ sku, customerName, depth }: UpsertSampleDepthVariables) => {
      authRequired(user?.id);
      if (!isAdmin) throw new Error("Administrator access is required to edit sample settings");
      const p_sku = normalizeRequiredKey(sku, "Style number");
      const p_customer = normalizeRequiredKey(customerName, "Customer");
      const p_depth_inches = normalizeSampleDepth(depth);
      const { error } = await (supabase.rpc as any)("upsert_dam_order_sample_depth", {
        p_sku,
        p_customer,
        p_depth_inches,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ORDER_INTEGRATION_QUERY_KEY }),
  });

  return {
    ...query,
    rows: query.data ?? [],
    hasNextPage: (query.data?.length ?? 0) === ORDER_INTEGRATION_SETTINGS_PAGE_SIZE,
    canEdit: Boolean(user && isAdmin),
    upsertSampleDepth: mutation.mutateAsync,
    isSaving: mutation.isPending,
    saveError: mutation.error,
  };
}

export type UseCustomerSuffixesOptions = PageSearchOptions & { customerSearch: string };

export function useCustomerSuffixes({ page, customerSearch, enabled = true }: UseCustomerSuffixesOptions) {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const queryClient = useQueryClient();
  const customer = customerSearch.trim();
  const query = useQuery({
    queryKey: [...ORDER_INTEGRATION_QUERY_KEY, "customer-settings", page, customer],
    enabled: enabled && Boolean(user),
    queryFn: async (): Promise<CustomerSuffix[]> => {
      authRequired(user?.id);
      const boundedCustomer = assertSearchLength(customerSearch);
      let request = (supabase as any)
        .schema("api")
        .from("dam_order_customer_settings")
        .select("customer_normalized,suffix,updated_at,updated_by")
        .order("customer_normalized", { ascending: true });
      if (boundedCustomer) request = request.ilike("customer_normalized", `%${escapeLiteralOrderSearch(boundedCustomer)}%`);
      const { data, error } = await request.range(
        page * ORDER_INTEGRATION_SETTINGS_PAGE_SIZE,
        (page + 1) * ORDER_INTEGRATION_SETTINGS_PAGE_SIZE - 1,
      );
      if (error) throw error;
      return asPageRows<CustomerSuffix>(data);
    },
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const mutation = useMutation({
    mutationFn: async ({ customerName, suffix }: UpsertCustomerSuffixVariables) => {
      authRequired(user?.id);
      if (!isAdmin) throw new Error("Administrator access is required to edit customer settings");
      const p_customer = normalizeRequiredKey(customerName, "Customer");
      const p_suffix = normalizeCustomerSuffix(suffix);
      const { error } = await (supabase.rpc as any)("upsert_dam_order_customer_settings", {
        p_customer,
        p_suffix,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ORDER_INTEGRATION_QUERY_KEY }),
  });

  return {
    ...query,
    rows: query.data ?? [],
    hasNextPage: (query.data?.length ?? 0) === ORDER_INTEGRATION_SETTINGS_PAGE_SIZE,
    canEdit: Boolean(user && isAdmin),
    upsertCustomerSuffix: mutation.mutateAsync,
    isSaving: mutation.isPending,
    saveError: mutation.error,
  };
}

export type UseVendorStatisticsOptions = PageSearchOptions & { vendorSearch: string };

export function useVendorStatistics({ page, vendorSearch, enabled = true }: UseVendorStatisticsOptions) {
  const { user } = useAuth();
  const search = vendorSearch.trim();
  const query = useQuery({
    queryKey: [...ORDER_INTEGRATION_QUERY_KEY, "vendor-statistics", page, search],
    enabled: enabled && Boolean(user),
    queryFn: async (): Promise<VendorStatistic[]> => {
      authRequired(user?.id);
      const boundedSearch = assertSearchLength(vendorSearch);
      let request = (supabase as any)
        .schema("api")
        .from("dam_order_vendor_statistics")
        .select("factory_id,vendor_name,order_count,closed_orders,open_orders,last_sent_po_date,activity_status")
        .order("vendor_name", { ascending: true })
        .order("factory_id", { ascending: true, nullsFirst: true });
      if (boundedSearch) request = request.ilike("vendor_name", `%${escapeLiteralOrderSearch(boundedSearch)}%`);
      const { data, error } = await request.range(
        page * ORDER_INTEGRATION_SETTINGS_PAGE_SIZE,
        (page + 1) * ORDER_INTEGRATION_SETTINGS_PAGE_SIZE - 1,
      );
      if (error) throw error;
      return asPageRows<VendorStatistic>(data);
    },
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  return {
    ...query,
    rows: query.data ?? [],
    hasNextPage: (query.data?.length ?? 0) === ORDER_INTEGRATION_SETTINGS_PAGE_SIZE,
  };
}
