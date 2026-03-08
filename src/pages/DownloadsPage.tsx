import { Download, Container, Monitor, Copy, Check, ExternalLink, FolderOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { useIsAdmin } from "@/hooks/useIsAdmin";

function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2 bg-[hsl(var(--surface-overlay))] border border-border rounded-md p-2">
        <code className="text-xs font-mono text-foreground flex-1 break-all">{text}</code>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={copy}>
          {copied ? <Check className="h-3 w-3 text-[hsl(var(--success))]" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
    </div>
  );
}

export default function DownloadsPage() {
  const { isAdmin } = useIsAdmin();

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Download className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">{isAdmin ? "Downloads & Agents" : "Downloads"}</h1>
      </div>
      <p className="text-muted-foreground text-sm">
        {isAdmin
          ? "PopDAM uses agents to scan your NAS and render thumbnails. Download and deploy them below."
          : "Install the protocol handler to enable \"Open Containing Folder\" from the asset browser."}
      </p>

      {isAdmin && (
      <div className="grid gap-6 md:grid-cols-2">
        {/* Bridge Agent Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Container className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Bridge Agent</CardTitle>
            </div>
            <CardDescription>
              Runs on your Synology NAS via Docker. Scans files, generates thumbnails,
              uploads to DigitalOcean Spaces, and reports to the cloud.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Docker</Badge>
              <Badge variant="outline">Synology NAS</Badge>
            </div>

            <CopyBlock
              label="Pull from GHCR"
              text="docker pull ghcr.io/u2giants/popdam-bridge:latest"
            />

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Deployment steps:</p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Go to <strong>Setup Wizard</strong> → generate your <code>.env</code> and <code>docker-compose.yml</code></li>
                <li>Copy both files to your Synology NAS</li>
                <li>Open Synology Container Manager → Project → Create</li>
                <li>Select the folder with your files and deploy</li>
              </ol>
            </div>

            <Button variant="outline" size="sm" asChild>
              <a
                href="https://github.com/u2giants/popdam3/pkgs/container/popdam-bridge"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                <ExternalLink className="h-3 w-3" />
                View on GHCR
              </a>
            </Button>
          </CardContent>
        </Card>

        {/* Windows Render Agent Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Monitor className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Windows Render Agent</CardTitle>
            </div>
             <CardDescription>
               Optional. Runs on a Windows PC to share the rendering workload with the Bridge Agent.
               Uses Sharp + Ghostscript to thumbnail <code>.ai</code> and <code>.psd</code> files.
             </CardDescription>
           </CardHeader>
           <CardContent className="space-y-4">
             <div className="flex items-center gap-2">
               <Badge variant="secondary">Windows</Badge>
               <Badge variant="outline">Ghostscript</Badge>
             </div>

             <div className="space-y-1">
               <p className="text-xs text-muted-foreground">How it works:</p>
               <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                 <li>Claims render jobs from the cloud queue</li>
                 <li>Renders thumbnails using Sharp and Ghostscript</li>
                 <li>Uploads to DigitalOcean Spaces</li>
                 <li>Reports completion back to the cloud</li>
               </ol>
             </div>

            <Button variant="outline" size="sm" asChild>
              <a
                href="https://github.com/u2giants/popdam3/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                <ExternalLink className="h-3 w-3" />
                GitHub Releases
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
      )}

      {/* Protocol Handler Card — visible to all users */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">"Open Folder" Protocol Handler</CardTitle>
          </div>
          <CardDescription>
            Install the <code>popdam://</code> protocol handler on your workstation to enable "Open Containing Folder"
            buttons in the asset browser. Clicking the button opens the asset's folder directly in Explorer or Finder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Windows */}
            <div className="border border-border rounded-md p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Windows</Badge>
              </div>
              <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>Create a folder <code>C:\PopDAM\</code></li>
                <li>Download <code>popdam-open.bat</code> into that folder</li>
                <li>Import <code>install-popdam-protocol.reg</code> (double-click)</li>
                <li>Restart your browser</li>
              </ol>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" asChild>
                  <a
                    href="https://raw.githubusercontent.com/u2giants/popdam3/main/scripts/protocol-handler/install-popdam-protocol.reg"
                    download="install-popdam-protocol.reg"
                    className="flex items-center gap-2"
                  >
                    <Download className="h-3 w-3" />
                    .reg file
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href="https://raw.githubusercontent.com/u2giants/popdam3/main/scripts/protocol-handler/popdam-open.bat"
                    download="popdam-open.bat"
                    className="flex items-center gap-2"
                  >
                    <Download className="h-3 w-3" />
                    .bat handler
                  </a>
                </Button>
              </div>
            </div>

            {/* macOS */}
            <div className="border border-border rounded-md p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">macOS</Badge>
              </div>
              <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>Download <code>install-popdam-protocol.sh</code></li>
                <li>Run: <code>bash install-popdam-protocol.sh</code></li>
                <li>Restart your browser</li>
              </ol>
              <Button variant="outline" size="sm" asChild>
                <a
                  href="https://raw.githubusercontent.com/u2giants/popdam3/main/scripts/protocol-handler/install-popdam-protocol.sh"
                  download="install-popdam-protocol.sh"
                  className="flex items-center gap-2"
                >
                  <Download className="h-3 w-3" />
                  .sh installer
                </a>
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            After installing, go to <strong>Settings → Path Tester</strong> to choose your preferred path mode
            (UNC hostname, UNC IP, or Synology Drive).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
