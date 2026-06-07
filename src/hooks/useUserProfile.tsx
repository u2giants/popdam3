import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export interface UserProfile {
  name: string;
  email: string;
  avatarUrl: string | null;
}

function deriveName(metadata: Record<string, unknown>, email: string): string {
  const m = metadata ?? {};
  const candidate =
    (m.full_name as string) ||
    (m.name as string) ||
    (m.preferred_username as string) ||
    "";
  if (candidate && !candidate.includes("@")) return candidate;
  return email ? email.split("@")[0] : "User";
}

/**
 * Resolves the signed-in user's display name + email + avatar.
 *
 * Avatar resolution order:
 *  1. picture/avatar_url already on user_metadata (some IdPs include it)
 *  2. a previously cached Microsoft Graph photo (localStorage)
 *  3. a fresh Microsoft Graph /me/photo fetch using session.provider_token
 *     (only available immediately after an Azure OAuth sign-in)
 *  → otherwise null, and callers fall back to initials.
 */
export function useUserProfile(): UserProfile {
  const { user, session } = useAuth();
  const email = user?.email ?? "";
  const metadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const name = deriveName(metadata, email);
  const metaPic =
    (metadata.avatar_url as string) || (metadata.picture as string) || null;
  const cacheKey = user ? `m365_photo_${user.id}` : null;

  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => {
    if (metaPic) return metaPic;
    if (cacheKey) return localStorage.getItem(cacheKey);
    return null;
  });

  const providerToken = session?.provider_token ?? null;

  useEffect(() => {
    if (metaPic) {
      setAvatarUrl(metaPic);
      return;
    }
    if (!cacheKey) return;

    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      setAvatarUrl(cached);
      return;
    }
    // provider_token is only present right after an Azure OAuth redirect.
    if (!providerToken) return;

    let aborted = false;
    (async () => {
      try {
        const res = await fetch("https://graph.microsoft.com/v1.0/me/photo/$value", {
          headers: { Authorization: `Bearer ${providerToken}` },
        });
        if (!res.ok) return; // 404 = user has no photo set
        const blob = await res.blob();
        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        if (aborted) return;
        try {
          localStorage.setItem(cacheKey, dataUrl);
        } catch {
          /* localStorage quota — show without caching */
        }
        setAvatarUrl(dataUrl);
      } catch {
        /* network/Graph error — fall back to initials */
      }
    })();

    return () => {
      aborted = true;
    };
  }, [cacheKey, metaPic, providerToken]);

  return { name, email, avatarUrl };
}
