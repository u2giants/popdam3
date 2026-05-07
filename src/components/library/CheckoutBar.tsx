import { Download, Upload, Trash2, Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssetCheckout } from "@/hooks/useAssetCheckout";

interface CheckoutBarProps {
  assetId: string | null | undefined;
}

export default function CheckoutBar({ assetId }: CheckoutBarProps) {
  const { checkout, currentUser, checkoutBusy, handleCheckout, handleCheckin, handleDiscard } =
    useAssetCheckout(assetId);

  if (!assetId) return null;

  if (checkout) {
    const profile = (checkout as any).profiles;
    const checkedOutByMe = currentUser && profile?.email === currentUser.email;
    const checkerName = profile?.full_name ?? profile?.email ?? "another user";
    const since = new Date(checkout.checked_out_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const isTransferring = ["checkin_queued", "uploading", "verifying"].includes(checkout.status);

    if (checkedOutByMe) {
      return (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            className="gap-1 text-xs h-7 px-2"
            onClick={handleCheckin}
            disabled={checkoutBusy || isTransferring}
          >
            {isTransferring ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            Check In
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 shrink-0"
            title="Discard checkout"
            onClick={handleDiscard}
            disabled={checkoutBusy || isTransferring}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    return (
      <div
        className="flex items-center gap-1 shrink-0 text-xs text-amber-500"
        title={`Locked by ${checkerName} since ${since}`}
      >
        <Lock className="h-3 w-3 shrink-0" />
        <span className="truncate max-w-[90px] hidden sm:inline">{checkerName}</span>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1 text-xs h-7 px-2 shrink-0"
      onClick={handleCheckout}
      disabled={checkoutBusy}
    >
      {checkoutBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
      Check Out
    </Button>
  );
}
