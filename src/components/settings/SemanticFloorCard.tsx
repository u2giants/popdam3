import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminApi } from "@/hooks/useAdminApi";
import { toast } from "sonner";
import { parseSemanticFloor, SEARCH_MIN_SEMANTIC_SCORE_KEY } from "../../../supabase/functions/_shared/semantic-floor.ts";

// Same parser the dam-search-ai edge function applies, so the UI and search agree.
const KEY = SEARCH_MIN_SEMANTIC_SCORE_KEY;
export const readSemanticFloor = parseSemanticFloor;

export function SemanticFloorCard() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const config = useQuery({
    queryKey: ["admin-config", KEY],
    queryFn: () => call("get-config", { keys: [KEY] }),
  });
  // get-config returns { value: <stored row value>, updated_at }; the stored
  // row value is { value: n } as written by Save below, which parseSemanticFloor unwraps.
  const current = readSemanticFloor(config.data?.config?.[KEY]?.value);
  const [draft, setDraft] = useState("");
  useEffect(() => setDraft(current === null ? "" : String(current)), [current]);

  const save = useMutation({
    mutationFn: (value: number | null) => call("set-config", { entries: { [KEY]: { value } } }),
    onSuccess: () => {
      toast.success("Semantic floor saved");
      queryClient.invalidateQueries({ queryKey: ["admin-config", KEY] });
    },
    onError: (e: Error) => toast.error(`Could not save semantic floor: ${e.message}`),
  });

  const trimmed = draft.trim();
  const parsed = trimmed === "" ? null : readSemanticFloor(trimmed);
  const invalid = trimmed !== "" && parsed === null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="h-4 w-4" /> Semantic match floor</CardTitle>
        <CardDescription>Smart-search matches below this similarity (0–1) are dropped. Keyword matches always stay. Leave blank for no floor.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="semantic-floor">Minimum semantic score</Label>
        <div className="flex gap-2">
          <Input id="semantic-floor" type="text" inputMode="decimal" placeholder="No floor" value={draft}
            onChange={(e) => setDraft(e.target.value)} disabled={config.isLoading || config.isError} className="max-w-[10rem]" />
          <Button size="sm" disabled={invalid || save.isPending || config.isLoading || config.isError} onClick={() => save.mutate(parsed)}>Save</Button>
        </div>
        {config.isError && <p className="text-xs text-destructive">Could not load the current floor; editing is disabled.</p>}
        {invalid && <p className="text-xs text-destructive">Enter a number between 0 and 1, or leave blank.</p>}
      </CardContent>
    </Card>
  );
}
