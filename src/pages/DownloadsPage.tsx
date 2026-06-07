import { Download, Container, Monitor, Copy, Check, ExternalLink, FolderOpen, Laptop, Cloud } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState, useCallback } from "react";
import { useIsAdmin } from "@/hooks/useIsAdmin";

/** Fetch a public file as blob and trigger a real download (bypasses auth bridge). */
function useBlobDownload() {
  return useCallback(async (path: string, filename: string) => {
    try {
      const res = await fetch(path);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed:", e);
    }
  }, []);
}

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

const HELPER_BASE = "https://github.com/u2giants/popdam3/releases/download/popdam-helper-latest";

export default function DownloadsPage() {
  const { isAdmin } = useIsAdmin();
  const download = useBlobDownload();

  const winStep1 = `New-Item -ItemType Directory -Path 'C:\\PopDAM' -Force | Out-Null; @('@echo off','setlocal','powershell -NoProfile -Command "$u=$args[0];$raw=$u -replace ''^popdam://open-folder\\?path='','''';$p=[uri]::UnescapeDataString($raw);Start-Process explorer.exe $p" -- "%~1"') | Set-Content -Path 'C:\\PopDAM\\popdam-open.bat' -Encoding ASCII; Write-Host '[OK] Created C:\\PopDAM\\popdam-open.bat'`;

  const winStep2 = `New-Item -Path 'HKCU:\\Software\\Classes\\popdam\\shell\\open\\command' -Force | Out-Null; Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\popdam' -Name '(Default)' -Value 'URL:PopDAM Protocol'; New-Item -Path 'HKCU:\\Software\\Classes\\popdam' -Name 'URL Protocol' -Value '' -Force | Out-Null; Set-ItemProperty -Path 'HKCU:\\Software\\Classes\\popdam\\shell\\open\\command' -Name '(Default)' -Value '"C:\\PopDAM\\popdam-open.bat" "%1"'; Write-Host '[OK] Protocol handler registered'`;

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Download className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">{isAdmin ? "Downloads & Agents" : "Downloads"}</h1>
      </div>
      <p className="text-muted-foreground text-sm">
        {isAdmin
          ? "PopDAM uses agents to scan your NAS and render thumbnails. Download and deploy them below."
          : "Install the DAM Helper app to enable \"Open Containing Folder\" from the asset browser."}
      </p>

      {/* DAM Helper — visible to all users */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Laptop className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">DAM Helper App</CardTitle>
          </div>
          <CardDescription>
            Install on your workstation to enable the <code>popdam://</code> protocol handler.
            This lets "Open Containing Folder" buttons open asset folders directly in Explorer or Finder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
              <Badge variant="secondary" className="text-[10px]">Windows 10 / 11</Badge>
              <p className="text-xs text-muted-foreground">Run the installer, then launch from the Start Menu.</p>
              <Button size="sm" className="gap-1.5 text-xs w-full" asChild>
                <a href={`${HELPER_BASE}/POP-DAM-Helper-Windows-Setup.exe`} target="_blank" rel="noopener noreferrer">
                  <Download className="h-3 w-3" />
                  Download (.exe)
                </a>
              </Button>
            </div>

            <div className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
              <Badge variant="secondary" className="text-[10px]">macOS — Apple Silicon</Badge>
              <p className="text-xs text-muted-foreground">M1 / M2 / M3. Open the DMG, drag to Applications.</p>
              <Button size="sm" className="gap-1.5 text-xs w-full" asChild>
                <a href={`${HELPER_BASE}/POP-DAM-Helper-Mac-arm64.dmg`} target="_blank" rel="noopener noreferrer">
                  <Download className="h-3 w-3" />
                  Download (.dmg)
                </a>
              </Button>
            </div>

            <div className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
              <Badge variant="secondary" className="text-[10px]">macOS — Intel</Badge>
              <p className="text-xs text-muted-foreground">Older Intel Mac. Open the DMG, drag to Applications.</p>
              <Button size="sm" className="gap-1.5 text-xs w-full" asChild>
                <a href={`${HELPER_BASE}/POP-DAM-Helper-Mac-x64.dmg`} target="_blank" rel="noopener noreferrer">
                  <Download className="h-3 w-3" />
                  Download (.dmg)
                </a>
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            After installing, open the app once to complete setup. Then go to{" "}
            <strong>Settings → Path Tester</strong> to choose your preferred path mode.
          </p>
        </CardContent>
      </Card>

      {/* SeaDrive — for work-from-home / Seafile users */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">SeaDrive (Work-from-Home)</CardTitle>
          </div>
          <CardDescription>
            For designers working off-site. SeaDrive mounts the art libraries as an on-demand
            virtual drive (<code>~/SeaDrive</code>) — files download only when you open them, so a
            laptop never has to hold the whole library. Sign in with your <strong>Microsoft account</strong>.
            Install this <em>and</em> the DAM Helper above, then choose <strong>Seafile</strong> in the Helper&apos;s settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
              <Badge variant="secondary" className="text-[10px]">macOS</Badge>
              <p className="text-xs text-muted-foreground">Download the <strong>SeaDrive</strong> client, open the DMG, and drag it to Applications.</p>
              <Button size="sm" className="gap-1.5 text-xs w-full" asChild>
                <a href="https://www.seafile.com/en/download/" target="_blank" rel="noopener noreferrer">
                  <Download className="h-3 w-3" />
                  Get SeaDrive
                </a>
              </Button>
            </div>
            <div className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
              <Badge variant="secondary" className="text-[10px]">Windows 10 / 11</Badge>
              <p className="text-xs text-muted-foreground">Download the <strong>SeaDrive</strong> client and run the installer.</p>
              <Button size="sm" className="gap-1.5 text-xs w-full" asChild>
                <a href="https://www.seafile.com/en/download/" target="_blank" rel="noopener noreferrer">
                  <Download className="h-3 w-3" />
                  Get SeaDrive
                </a>
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="https://seafile.designflow.app/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                <ExternalLink className="h-3 w-3" />
                Open Seafile web
              </a>
            </Button>
            <span className="text-xs text-muted-foreground">Server: <code>seafile.designflow.app</code></span>
          </div>
        </CardContent>
      </Card>

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
                href="https://github.com/users/u2giants/packages/container/package/popdam-bridge"
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

      {/* Manual Protocol Handler — visible to all users */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Manual Protocol Handler Setup</CardTitle>
          </div>
          <CardDescription>
            Alternative to the DAM Helper app. Manually register the <code>popdam://</code> protocol
            using PowerShell or a shell script — no app install required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Windows */}
            <div className="border border-border rounded-md p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Windows</Badge>
              </div>
              <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>Open <strong>Command Prompt</strong> or <strong>Windows Terminal</strong></li>
                <li>Paste <strong>Step 1</strong> → press Enter (creates the handler script)</li>
                <li>Paste <strong>Step 2</strong> → press Enter (registers the protocol)</li>
                <li>Restart your browser</li>
              </ol>
              <CopyBlock
                label="Step 1 — Create handler script"
                text={winStep1}
              />
              <CopyBlock
                label="Step 2 — Register popdam:// protocol"
                text={winStep2}
              />
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
              <Button variant="outline" size="sm" onClick={() => download("/downloads/install-popdam-protocol.sh", "install-popdam-protocol.sh")} className="flex items-center gap-2">
                <Download className="h-3 w-3" />
                .sh installer
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
