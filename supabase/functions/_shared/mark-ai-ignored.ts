import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function markAiIgnored(
  db: SupabaseClient,
  relativePath: string,
  reason: "no_pdf_compat" | "pdf_sibling" | "blank_render",
): Promise<void> {
  const { error } = await db
    .from("scanner_ai_ignores")
    .upsert({ relative_path: relativePath, reason }, { onConflict: "relative_path", ignoreDuplicates: true });
  if (error) throw new Error(`mark-ai-ignored failed: ${error.message}`);
}
