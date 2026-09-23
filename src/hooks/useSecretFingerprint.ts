import { useEffect, useState } from "react";
import { safeSecretFingerprint } from "../../supabase/functions/_shared/direct-batch-model";

/**
 * Returns a non-secret cache identity, or null while a changed secret is
 * hashing. The fingerprint is bound to the secret it was computed from, so the
 * render right after a rotation never reports the previous account's identity.
 */
export function useSecretFingerprint(secret: string): string | null {
  const [computed, setComputed] = useState<{ secret: string; fingerprint: string } | null>(null);

  useEffect(() => {
    if (!secret) return;
    let cancelled = false;
    void safeSecretFingerprint(secret).then((fingerprint) => {
      if (!cancelled) setComputed({ secret, fingerprint });
    });
    return () => { cancelled = true; };
  }, [secret]);

  if (!secret) return "none";
  return computed && computed.secret === secret ? computed.fingerprint : null;
}
