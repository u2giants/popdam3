import { useEffect, useRef, useState } from "react";
import { safeSecretFingerprint } from "../../supabase/functions/_shared/direct-batch-model";

/** Returns a non-secret cache identity, or null while a changed secret is hashing. */
export function useSecretFingerprint(secret: string): string | null {
  const currentSecret = useRef(secret);
  const [fingerprint, setFingerprint] = useState<string | null>(secret ? null : "none");

  useEffect(() => {
    let cancelled = false;
    currentSecret.current = secret;
    if (!secret) {
      setFingerprint("none");
      return () => { cancelled = true; };
    }
    setFingerprint(null);
    void safeSecretFingerprint(secret).then((value) => {
      if (!cancelled && currentSecret.current === secret) setFingerprint(value);
    });
    return () => { cancelled = true; };
  }, [secret]);

  return fingerprint;
}
