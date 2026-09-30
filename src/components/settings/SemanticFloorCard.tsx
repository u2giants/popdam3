import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminApi } from "@/hooks/useAdminApi";
import { toast } from "sonner";

const KEY = "SEARCH_MIN_SEMANTIC_SCORE";

export function readSemanticFloor(raw: unknown): number | null {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw
    ? (raw as { value: unknown }).value
    : raw;
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

export function SemanticFloorCard() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const config = useQuery({
    queryKey: ["admin-config", KEY],
    queryFn: () => call("get-config", { keys: [KEY] }),
  });
  const current = readSemanticFloor(config.data?.config?.[KEY]);
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
          <Input id="semantic-floor" type="number" min={0} max={1} step={0.01} placeholder="No floor" value={draft}
            onChange={(e) => setDraft(e.target.value)} disabled={config.isLoading} className="max-w-[10rem]" />
          <Button size="sm" disabled={invalid || save.isPending || config.isLoading} onClick={() => save.mutate(parsed)}>Save</Button>
        </div>
        {invalid && <p className="text-xs text-destructive">Enter a number between 0 and 1, or leave blank.</p>}
      </CardContent>
    </Card>
  );
}
