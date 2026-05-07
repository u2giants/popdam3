import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useAssetCheckout(assetId: string | null | undefined) {
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  const { data: checkout, refetch: refetchCheckout } = useQuery({
    queryKey: ["asset-checkout", assetId],
    enabled: !!assetId,
    queryFn: async () => {
      const { data } = await supabase
        .from("asset_checkouts")
        .select("id, status, checked_out_at, profiles(full_name, email)")
        .eq("asset_id", assetId!)
        .in("status", ["active", "checkin_queued", "uploading", "verifying"])
        .maybeSingle();
      return data ?? null;
    },
    refetchInterval: 15000,
  });

  const { data: currentUser } = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
    staleTime: 60000,
  });

  async function handleCheckout(): Promise<void> {
    if (!assetId) return;
    setCheckoutBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("helper-api/tokens", {
        body: { action: "checkout", asset_id: assetId },
      });
      if (error || !data?.ok) {
        toast.error("Could not create checkout link", { description: error?.message ?? data?.error });
        return;
      }
      window.location.href = data.url;
      setTimeout(() => refetchCheckout(), 2000);
    } catch (e: unknown) {
      toast.error("Checkout failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function handleCheckin(): Promise<void> {
    if (!checkout) return;
    setCheckoutBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("helper-api/tokens", {
        body: { action: "checkin", checkout_id: checkout.id },
      });
      if (error || !data?.ok) {
        toast.error("Could not create check-in link", { description: error?.message ?? data?.error });
        return;
      }
      window.location.href = data.url;
      setTimeout(() => refetchCheckout(), 2000);
    } catch (e: unknown) {
      toast.error("Check-in failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function handleDiscard(): Promise<void> {
    if (!checkout) return;
    if (!confirm("Discard checkout? The file will be unlocked and your local edits will remain in your workspace.")) return;
    setCheckoutBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("helper-api/checkouts/discard", {
        body: { checkout_id: checkout.id },
      });
      if (error || !data?.ok) {
        toast.error("Discard failed", { description: error?.message ?? data?.error });
      } else {
        toast("Checkout discarded — file is now available.");
      }
      refetchCheckout();
    } catch (e: unknown) {
      toast.error("Discard failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setCheckoutBusy(false);
    }
  }

  return { checkout, currentUser, checkoutBusy, handleCheckout, handleCheckin, handleDiscard };
}
