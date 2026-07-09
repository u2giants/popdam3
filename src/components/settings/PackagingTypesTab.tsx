import { useMemo, useState } from "react";
import { Check, Loader2, PackageOpen, Pencil, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import {
  cleanPackagingTypeInput,
  type PackagingTypeStatus,
} from "@/lib/packaging-types";

type PackagingTypeRow = {
  id: string;
  name: string;
  code: string | null;
  status: PackagingTypeStatus;
  updated_at: string;
};

type DraftRow = {
  name: string;
  code: string;
  status: PackagingTypeStatus;
};

type SupabaseError = { message: string };
type SupabaseSingleResult = Promise<{ error: SupabaseError | null }>;
type SupabaseFilterBuilder = {
  eq: (column: string, value: string) => SupabaseSingleResult;
};
type PackagingTypeTable = {
  select: (columns: string) => {
    order: (column: string, options: { ascending: boolean }) => Promise<{
      data: unknown[] | null;
      error: SupabaseError | null;
    }>;
  };
  insert: (values: Record<string, unknown>) => SupabaseSingleResult;
  update: (values: Record<string, unknown>) => SupabaseFilterBuilder;
  delete: () => SupabaseFilterBuilder;
};
type CoreSupabaseClient = {
  schema: (schema: "core") => {
    from: (table: "packaging_type") => PackagingTypeTable;
  };
};

const emptyDraft: DraftRow = {
  name: "",
  code: "",
  status: "active",
};

function packagingTypeTable() {
  return (supabase as unknown as CoreSupabaseClient).schema("core").from("packaging_type");
}

async function loadPackagingTypes(): Promise<PackagingTypeRow[]> {
  const { data, error } = await packagingTypeTable()
    .select("id, name, code, status, updated_at")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as PackagingTypeRow[];
}

export default function PackagingTypesTab() {
  const queryClient = useQueryClient();
  const [newDraft, setNewDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftRow>(emptyDraft);

  const query = useQuery({
    queryKey: ["core-packaging-types"],
    queryFn: loadPackagingTypes,
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const activeCount = useMemo(() => rows.filter((row) => row.status === "active").length, [rows]);

  const createMutation = useMutation({
    mutationFn: async (draft: DraftRow) => {
      const clean = cleanPackagingTypeInput(draft.name, draft.code);
      if (!clean.name) throw new Error("Name is required");

      const { error } = await packagingTypeTable()
        .insert({
          name: clean.name,
          code: clean.code,
          status: draft.status,
          metadata: { source: "popdam_settings" },
        });

      if (error) throw error;
    },
    onSuccess: () => {
      setNewDraft(emptyDraft);
      queryClient.invalidateQueries({ queryKey: ["core-packaging-types"] });
      toast.success("Packaging type added");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: DraftRow }) => {
      const clean = cleanPackagingTypeInput(draft.name, draft.code);
      if (!clean.name) throw new Error("Name is required");

      const { error } = await packagingTypeTable()
        .update({
          name: clean.name,
          code: clean.code,
          status: draft.status,
        })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      setEditingId(null);
      setEditDraft(emptyDraft);
      queryClient.invalidateQueries({ queryKey: ["core-packaging-types"] });
      toast.success("Packaging type saved");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await packagingTypeTable()
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["core-packaging-types"] });
      toast.success("Packaging type removed");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const startEditing = (row: PackagingTypeRow) => {
    setEditingId(row.id);
    setEditDraft({
      name: row.name,
      code: row.code ?? "",
      status: row.status,
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-3">
            <PackageOpen className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Packaging Types</CardTitle>
            <Badge variant="secondary" className="h-6">
              {activeCount} active
            </Badge>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => query.refetch()}
                disabled={query.isFetching}
              >
                {query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh packaging types</TooltipContent>
          </Tooltip>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-2 md:grid-cols-[minmax(0,1fr)_12rem_auto_auto] items-center"
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate(newDraft);
            }}
          >
            <Input
              value={newDraft.name}
              onChange={(event) => setNewDraft((draft) => ({ ...draft, name: event.target.value }))}
              placeholder="Packaging type"
              autoComplete="off"
            />
            <Input
              value={newDraft.code}
              onChange={(event) => setNewDraft((draft) => ({ ...draft, code: event.target.value }))}
              placeholder="Code"
              autoComplete="off"
            />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch
                checked={newDraft.status === "active"}
                onCheckedChange={(checked) => setNewDraft((draft) => ({ ...draft, status: checked ? "active" : "inactive" }))}
              />
              <span className="w-14">{newDraft.status === "active" ? "Active" : "Inactive"}</span>
            </div>
            <Button type="submit" disabled={createMutation.isPending} className="gap-2">
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </Button>
          </form>

          {query.isLoading && (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading packaging types
            </div>
          )}

          {query.error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {(query.error as Error).message}
            </div>
          )}

          {!query.isLoading && !query.error && rows.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
              No packaging types yet
            </div>
          )}

          {rows.length > 0 && (
            <div className="overflow-hidden rounded-md border border-border">
              <div className="grid grid-cols-[minmax(0,1fr)_9rem_8rem_7.5rem] gap-2 bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>Name</span>
                <span>Code</span>
                <span>Status</span>
                <span className="text-right">Actions</span>
              </div>
              <div className="divide-y divide-border">
                {rows.map((row) => {
                  const isEditing = editingId === row.id;
                  return (
                    <div
                      key={row.id}
                      className="grid grid-cols-1 gap-2 px-3 py-2 md:grid-cols-[minmax(0,1fr)_9rem_8rem_7.5rem] md:items-center"
                    >
                      {isEditing ? (
                        <>
                          <Input
                            value={editDraft.name}
                            onChange={(event) => setEditDraft((draft) => ({ ...draft, name: event.target.value }))}
                            autoComplete="off"
                          />
                          <Input
                            value={editDraft.code}
                            onChange={(event) => setEditDraft((draft) => ({ ...draft, code: event.target.value }))}
                            autoComplete="off"
                          />
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Switch
                              checked={editDraft.status === "active"}
                              onCheckedChange={(checked) => setEditDraft((draft) => ({ ...draft, status: checked ? "active" : "inactive" }))}
                            />
                            <span className="w-14">{editDraft.status === "active" ? "Active" : "Inactive"}</span>
                          </div>
                          <div className="flex justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => updateMutation.mutate({ id: row.id, draft: editDraft })}
                                  disabled={updateMutation.isPending}
                                >
                                  {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Save packaging type</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => {
                                    setEditingId(null);
                                    setEditDraft(emptyDraft);
                                  }}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Cancel</TooltipContent>
                            </Tooltip>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{row.name}</div>
                          </div>
                          <div className="font-mono text-sm text-muted-foreground">{row.code || "-"}</div>
                          <Badge variant={row.status === "active" ? "default" : "secondary"} className="w-fit gap-1">
                            {row.status === "active" && <Check className="h-3 w-3" />}
                            {row.status}
                          </Badge>
                          <div className="flex justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => startEditing(row)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit packaging type</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  onClick={() => deleteMutation.mutate(row.id)}
                                  disabled={deleteMutation.isPending}
                                >
                                  {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Remove packaging type</TooltipContent>
                            </Tooltip>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
