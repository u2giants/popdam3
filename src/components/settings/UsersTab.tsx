import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Users, UserPlus, Eye, RefreshCw, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface UserRecord {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  isAdmin: boolean;
  apps: string[];
}

const APP_OPTIONS = [
  { id: "popdam", label: "PopDAM" },
  { id: "styleguides", label: "PopSG" },
] as const;

export function UsersSection() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const { startImpersonation } = useImpersonation();
  const navigate = useNavigate();
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => call("list-users").then((r) => r.users as UserRecord[]),
    staleTime: 60_000,
  });

  const handleImpersonate = (u: UserRecord) => {
    startImpersonation({ id: u.id, email: u.email, isAdmin: u.isAdmin });
    navigate("/library");
  };

  const handleToggleApp = async (u: UserRecord, app: string, checked: boolean) => {
    const nextApps = checked
      ? Array.from(new Set([...u.apps, app]))
      : u.apps.filter((a) => a !== app);
    setSavingUserId(u.id);
    try {
      await call("set-user-apps", { user_id: u.id, apps: nextApps });
      toast.success(`Updated app access for ${u.email}`);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (e) {
      toast.error((e as Error).message || "Failed to update app access");
    } finally {
      setSavingUserId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" /> Active Users
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && (!data || data.length === 0) && (
          <p className="text-xs text-muted-foreground">No users found.</p>
        )}
        <div className="space-y-2">
          {data?.map((u) => (
            <div key={u.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{u.email}</p>
                <p className="text-xs text-muted-foreground">{u.isAdmin ? "Admin" : "User"}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {APP_OPTIONS.map((opt) => {
                  const checked = u.apps.includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
                      title={`Toggle ${opt.label} access for ${u.email}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={savingUserId === u.id}
                        onChange={(e) => handleToggleApp(u, opt.id, e.target.checked)}
                        className="h-3.5 w-3.5 accent-primary cursor-pointer"
                      />
                      <span className={checked ? "" : "text-muted-foreground"}>{opt.label}</span>
                    </label>
                  );
                })}
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-1 shrink-0 gap-1.5"
                  onClick={() => handleImpersonate(u)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  View as
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function InvitationSection() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const [apps, setApps] = useState<string[]>(["styleguides"]);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-invites"],
    queryFn: () => call("list-invites"),
  });

  const inviteMutation = useMutation({
    mutationFn: () => call("invite-user", { email, role, apps }),
    onSuccess: () => {
      toast.success("Invitation sent");
      setEmail("");
      setApps(["styleguides"]);
      queryClient.invalidateQueries({ queryKey: ["admin-invites"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => call("revoke-invite", { invitation_id: id }),
    onSuccess: () => {
      toast.success("Invitation revoked");
      queryClient.invalidateQueries({ queryKey: ["admin-invites"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const handleResend = async (invitationId: string, invEmail: string) => {
    setResendingId(invitationId);
    try {
      const { externalSupabase } = await import("@/lib/external-supabase");
      const { data: fnData, error } = await externalSupabase.functions.invoke("send-invite-email", {
        body: { email: invEmail, invitation_id: invitationId },
      });
      if (error) throw error;
      if (fnData?.ok === false) {
        toast.error(fnData.error || "Failed to send invite", {
          description: fnData.rawBody ? `Brevo response: ${fnData.rawBody}` : undefined,
          duration: 10000,
        });
      } else if (fnData?.warning) {
        toast.warning(`Invite sent to ${invEmail} — but with a warning`, {
          description: fnData.warning,
          duration: 15000,
        });
      } else {
        const brevoId = fnData?.messageId ? ` (Brevo ID: ${fnData.messageId})` : "";
        toast.success(`Invite sent to ${invEmail}${brevoId}`, { duration: 8000 });
      }
    } catch (e) {
      toast.error((e as Error).message || "Failed to resend invitation");
    } finally {
      setResendingId(null);
    }
  };

  const invitations = data?.invitations || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserPlus className="h-4 w-4" /> Invitations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="text-sm"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="bg-secondary text-secondary-foreground rounded-md px-2 text-sm border border-border"
              title="Role"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <Button
              size="sm"
              onClick={() => inviteMutation.mutate()}
              disabled={!email.trim() || apps.length === 0}
              title={!email.trim() ? "Enter an email address first" : apps.length === 0 ? "Pick at least one app" : undefined}
            >
              Invite
            </Button>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">Grant access to:</span>
            {APP_OPTIONS.map((opt) => {
              const checked = apps.includes(opt.id);
              return (
                <label key={opt.id} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setApps((prev) =>
                        e.target.checked
                          ? Array.from(new Set([...prev, opt.id]))
                          : prev.filter((a) => a !== opt.id),
                      );
                    }}
                    className="h-3.5 w-3.5 accent-primary cursor-pointer"
                  />
                  <span className={checked ? "" : "text-muted-foreground"}>{opt.label}</span>
                </label>
              );
            })}
          </div>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-1">
            {invitations.map((inv: Record<string, unknown>) => {
              const invApps = Array.isArray(inv.apps) ? (inv.apps as string[]) : ["styleguides"];
              return (
                <div key={inv.id as string} className="flex items-center justify-between text-xs py-1 border-b border-border">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono">{inv.email as string}</span>
                    <Badge variant="secondary">{inv.role as string}</Badge>
                    {invApps.map((a) => (
                      <Badge key={a} variant="outline" className="text-[10px]">
                        {APP_OPTIONS.find((o) => o.id === a)?.label ?? a}
                      </Badge>
                    ))}
                    {inv.accepted_at ? (
                      <Badge className="bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]">Accepted</Badge>
                    ) : (
                      <Badge variant="outline">Pending</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!inv.accepted_at && (
                      <>
                        <Button
                          variant="outline" size="sm" className="h-6 text-xs gap-1"
                          onClick={() => handleResend(inv.id as string, inv.email as string)}
                          disabled={resendingId === inv.id}
                          title={resendingId === inv.id ? "Sending invitation…" : undefined}
                        >
                          {resendingId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          Resend
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => revokeMutation.mutate(inv.id as string)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {invitations.length === 0 && <p className="text-muted-foreground text-xs">No invitations yet.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
