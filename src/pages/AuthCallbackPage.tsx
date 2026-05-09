import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { exchangeCode } from "@/lib/authentik";
import { externalSupabase } from "@/lib/external-supabase";

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    // Strict-mode guard — effect fires twice in dev but must only run once
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    const errorDesc = params.get("error_description");

    if (error || !code || !state) {
      navigate(`/login?error=${encodeURIComponent(errorDesc ?? error ?? "Authentication cancelled")}`, { replace: true });
      return;
    }

    (async () => {
      try {
        // Exchange PKCE code → id_token (public client, no secret needed)
        const idToken = await exchangeCode(code, state);

        // Validate id_token and get a Supabase session token_hash from the edge function
        const supabaseUrl = externalSupabase.supabaseUrl;
        const anonKey = externalSupabase.supabaseKey;
        const fnResp = await fetch(`${supabaseUrl}/functions/v1/authenticate-with-authentik`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: anonKey },
          body: JSON.stringify({ id_token: idToken }),
        });

        if (!fnResp.ok) {
          const { error: fnErr } = await fnResp.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(fnErr ?? `Edge function error ${fnResp.status}`);
        }

        const { token_hash } = await fnResp.json();

        // Exchange token_hash for a live Supabase session
        const { error: otpErr } = await externalSupabase.auth.verifyOtp({
          token_hash,
          type: "email",
        });
        if (otpErr) throw new Error(otpErr.message);

        navigate("/library", { replace: true });
      } catch (e) {
        navigate(`/login?error=${encodeURIComponent((e as Error).message)}`, { replace: true });
      }
    })();
  }, [navigate]);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Signing you in…</p>
      </div>
    </div>
  );
}
