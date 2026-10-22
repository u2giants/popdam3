import { useState } from "react";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export default function SearchAccessNotice({ expired }: { expired: boolean }) {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  async function signIn() {
    setBusy(true);
    setFailed(false);
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      window.location.assign("/login");
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return <div className="flex flex-col items-center justify-center py-24 text-center" role="alert">
    <ShieldOff className="mb-4 h-12 w-12 text-muted-foreground/30" />
    <p className="font-medium">{expired ? "Your session has expired" : "You don't have PopDAM access yet"}</p>
    <p className="mt-1 text-sm text-muted-foreground">{expired ? "Sign in again to search your library." : "Ask an administrator to grant you access to PopDAM."}</p>
    {expired && <Button className="mt-4" disabled={busy} onClick={() => void signIn()}>Sign in again</Button>}
    {failed && <p className="mt-2 text-sm text-destructive">Couldn't open sign-in. Please try again.</p>}
  </div>;
}
