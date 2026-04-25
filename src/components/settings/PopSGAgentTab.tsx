import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Copy, RotateCw, Link2 } from "lucide-react";

interface PairingResult {
  pairing_code: string;
  expires_at: string;
  tenants_entry: Record<string, unknown>;
}

export default function PopSGAgentTab() {
  const { call } = useAdminApi();
  const [agentName, setAgentName] = useState("bridge-popsg");
  const [result, setResult] = useState<PairingResult | null>(null);

  const generateMutation = useMutation({
    mutationFn: (name: string) =>
      call("create-popsg-pairing", { agent_name: name }),
    onSuccess: (data) => {
      setResult(data as PairingResult);
      toast.success("PopSG pairing code generated — expires in 15 minutes");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tenantsJson = result
    ? JSON.stringify([result.tenants_entry], null, 2)
    : null;

  const expiresIn = result
    ? Math.max(0, Math.round((new Date(result.expires_at).getTime() - Date.now()) / 60_000))
    : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Connect agent to PopSG
          </CardTitle>
          <CardDescription className="text-xs">
            Generate a PopSG pairing code from here — no need to log into sg.designflow.app.
            The agent will auto-pair on its next restart.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* One-time secret setup notice */}
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs space-y-1.5">
            <p className="font-medium text-foreground">One-time prerequisite</p>
            <p className="text-muted-foreground">
              Both Supabase projects need the same <code className="bg-muted px-1 rounded">CROSS_PROJECT_SECRET</code> env var.
            </p>
            <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
              <li>
                Generate any random string (e.g.{" "}
                <code className="bg-muted px-1 rounded">openssl rand -hex 32</code>)
              </li>
              <li>
                Add it as <code className="bg-muted px-1 rounded">CROSS_PROJECT_SECRET</code> in{" "}
                <a
                  href="https://supabase.com/dashboard/project/ryltkzzernhwnojzouyb/settings/functions"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground"
                >
                  PopDAM Secrets
                </a>{" "}
                and{" "}
                <a
                  href="https://supabase.com/dashboard/project/eeueczxhezfhyrhdmidg/settings/functions"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground"
                >
                  PopSG Secrets
                </a>
              </li>
            </ol>
          </div>

          {/* Generate form */}
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="popsg-agent-name" className="text-xs">
                Agent name
              </Label>
              <Input
                id="popsg-agent-name"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="bridge-popsg"
              />
            </div>
            <Button
              onClick={() =>
                generateMutation.mutate(agentName.trim() || "bridge-popsg")
              }
              disabled={generateMutation.isPending}
              className="gap-1.5"
            >
              <RotateCw
                className={
                  generateMutation.isPending
                    ? "h-4 w-4 animate-spin"
                    : "h-4 w-4"
                }
              />
              Generate
            </Button>
          </div>

          {/* Result */}
          {result && tenantsJson && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-foreground">
                  Add this to your bridge agent's{" "}
                  <code className="bg-muted px-1 rounded">TENANTS</code> env
                  var:
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => {
                    navigator.clipboard.writeText(tenantsJson);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>
              <pre className="rounded-md border border-border bg-muted/30 p-3 text-[11px] font-mono overflow-x-auto whitespace-pre">
                {tenantsJson}
              </pre>
              <p className="text-xs text-muted-foreground">
                Code expires in ~{expiresIn} minutes. Restart the agent
                container after updating <code className="bg-muted px-1 rounded">TENANTS</code>.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Setup steps</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-1.5 text-xs text-muted-foreground">
            <li>Complete the one-time secret setup above</li>
            <li>Click Generate to get a pairing code</li>
            <li>
              If the agent already has a <code className="bg-muted px-1 rounded">TENANTS</code> env
              var, add this entry to the array; otherwise set{" "}
              <code className="bg-muted px-1 rounded">TENANTS</code> to the JSON array shown
            </li>
            <li>Restart the bridge agent container</li>
            <li>
              The agent pairs automatically — within ~30 s it appears in the
              PopSG top bar
            </li>
            <li>
              Go to sg.designflow.app → Library → Sync to trigger the first
              crawl
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
