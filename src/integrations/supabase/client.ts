// All queries now go through the external Supabase client.
// The Lovable-managed .env values are intentionally ignored.
export { externalSupabase as supabase } from "@/lib/external-supabase";
