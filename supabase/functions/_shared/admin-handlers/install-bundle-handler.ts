/**
 * Extracted admin-api handler for generating agent install bundles (Bridge + Windows).
 */

import { corsHeaders, err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
import { optionalString, requireString } from "../validators.ts";

export async function handleGenerateInstallBundle(
  body: Record<string, unknown>,
  userId: string,
) {
  const { default: JSZip } = await import("https://esm.sh/jszip@3.10.1");

  const agentType = requireString(body, "agent_type");
  if (!["bridge", "windows-render"].includes(agentType)) {
    return err("agent_type must be 'bridge' or 'windows-render'");
  }

  const agentName = optionalString(body, "agent_name") ||
    (agentType === "bridge" ? "bridge-agent" : "windows-render-agent");
  const enableWatchtower = body.enable_watchtower === true;
  const updateChannel = optionalString(body, "update_channel") || "stable";

  // Bridge-specific options
  const nasHostPath = optionalString(body, "nas_host_path") || "/volume1/nas-share";
  const containerMountRoot = optionalString(body, "container_mount_root") || "/mnt/nas/mac";
  const scanRoots = Array.isArray(body.scan_roots) ? (body.scan_roots as string[]).filter(Boolean) : [];

  // Windows-specific options
  const desiredDriveLetter = optionalString(body, "desired_drive_letter") || "";
  const nasHost = optionalString(body, "nas_host") || "";
  const nasShare = optionalString(body, "nas_share") || "";

  // Create pairing code
  const db = serviceClient();
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let raw = "";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 16; i++) {
    raw += chars[bytes[i] % chars.length];
  }
  const pairingCode = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

  const { error: pairErr } = await db.from("agent_pairings").insert({
    pairing_code: pairingCode,
    agent_type: agentType,
    agent_name: agentName,
    status: "pending",
    created_by: userId,
    expires_at: expiresAt.toISOString(),
  });
  if (pairErr) return err(pairErr.message, 500);

  const serverUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const zip = new JSZip();

  if (agentType === "bridge") {
    // ── .env ──
    const envContent = [
      "# PopDAM Bridge Agent — generated " + now.toISOString(),
      "# This pairing code expires in 15 minutes. Deploy promptly.",
      "",
      "POPDAM_SERVER_URL=" + serverUrl,
      "POPDAM_PAIRING_CODE=" + pairingCode,
      "AGENT_NAME=" + agentName,
      "",
      "# Enables instant command delivery (scan triggers, dir browse, path test) via Realtime.",
      "# Without this, commands wait up to 30s for the next heartbeat poll.",
      "SUPABASE_ANON_KEY=" + anonKey,
      "",
      "# Volume mapping (set in docker-compose.yml)",
      "NAS_CONTAINER_MOUNT_ROOT=" + containerMountRoot,
      ...(scanRoots.length > 0 ? ["SCAN_ROOTS=" + scanRoots.map((r) => `${containerMountRoot}/${r}`).join(",")] : ["# SCAN_ROOTS=" + containerMountRoot]),
    ].join("\n") + "\n";

    // ── docker-compose.yml ──
    let compose = [
      "# PopDAM Bridge Agent — Synology Container Manager",
      "# Import: Container Manager → Project → Create → select this folder",
      'version: "3.8"',
      "services:",
      "  bridge-agent:",
      "    image: ghcr.io/u2giants/popdam-bridge:" + updateChannel,
      "    container_name: popdam-bridge",
      "    restart: unless-stopped",
      "    env_file: .env",
      "    cpu_shares: 1024",
      "    mem_limit: 2g",
      "    volumes:",
      `      - ${nasHostPath}:${containerMountRoot}:ro`,
      "      - popdam-data:/data",
      "      - /var/run/docker.sock:/var/run/docker.sock",
    ].join("\n");

    if (enableWatchtower) {
      compose += "\n" + [
        "",
        "  watchtower:",
        "    image: containrrr/watchtower",
        "    container_name: popdam-watchtower",
        "    restart: unless-stopped",
        "    volumes:",
        "      - /var/run/docker.sock:/var/run/docker.sock",
        "    environment:",
        "      - WATCHTOWER_POLL_INTERVAL=3600",
        "      - WATCHTOWER_CLEANUP=true",
        "      - WATCHTOWER_SCOPE=popdam",
        "    labels:",
        '      - "com.centurylinklabs.watchtower.scope=popdam"',
      ].join("\n");
      compose = compose.replace(
        "      - /var/run/docker.sock:/var/run/docker.sock\n",
        "      - /var/run/docker.sock:/var/run/docker.sock\n    labels:\n" +
          '      - "com.centurylinklabs.watchtower.scope=popdam"\n',
      );
    }

    compose += "\n\nvolumes:\n  popdam-data:\n";

    // ── README.txt ──
    const readme = [
      "╔══════════════════════════════════════════════════╗",
      "║        PopDAM Bridge Agent — Quick Start         ║",
      "╚══════════════════════════════════════════════════╝",
      "",
      "IMPORTANT: This pairing code expires in 15 minutes!",
      "Deploy this bundle promptly after downloading.",
      "",
      "── STEP 1: Copy to Synology ───────────────────────",
      "Copy this entire folder to your NAS, e.g.:",
      "  /volume1/docker/popdam/",
      "",
      "── STEP 2: Deploy ────────────────────────────────",
      "Open Synology Container Manager → Project → Create",
      "  • Project name: popdam",
      "  • Path: /volume1/docker/popdam",
      "  • Click 'Build & Run'",
      "",
      "Or via SSH:",
      "  cd /volume1/docker/popdam",
      "  docker compose up -d",
      "",
      "── STEP 3: Verify ────────────────────────────────",
      "Check logs:",
      "  docker compose logs -f bridge-agent",
      "",
      "You should see 'Pairing successful' within 30 seconds.",
      "After pairing, the agent will begin scanning automatically.",
      "",
      "── Updating ──────────────────────────────────────",
      enableWatchtower ? "Watchtower is enabled and will auto-update every hour." : "To update manually:\n  docker compose pull\n  docker compose up -d",
      "",
      "── Troubleshooting ───────────────────────────────",
      "• Check agent status in PopDAM Settings → Agents",
      "• Logs: docker compose logs --tail 50 bridge-agent",
      "• If pairing code expired, download a new bundle",
      "",
      "Agent name: " + agentName,
      "Server: " + serverUrl,
      "Generated: " + now.toISOString(),
    ].join("\n");

    zip.file(".env", envContent);
    zip.file("docker-compose.yml", compose);
    zip.file("README.txt", readme);
  } else {
    // ── Windows Render Agent ──

    // ── install.ps1 ──
    const installPs1 = [
      "#Requires -RunAsAdministrator",
      "<#",
      ".SYNOPSIS",
      "  PopDAM Windows Render Agent — Automated Installer",
      "  Generated: " + now.toISOString(),
      "#>",
      "",
      '$ErrorActionPreference = "Stop"',
      "",
      "# ── Configuration ──",
      '$ServerUrl = "' + serverUrl + '"',
      '$PairingCode = "' + pairingCode + '"',
      '$AgentName = "' + agentName + '"',
      ...(nasHost ? ['$NasHost = "' + nasHost + '"'] : ['$NasHost = ""']),
      ...(nasShare ? ['$NasShare = "' + nasShare + '"'] : ['$NasShare = ""']),
      ...(desiredDriveLetter ? ['$DriveLetter = "' + desiredDriveLetter + '"'] : ['$DriveLetter = ""']),
      "",
      "# ── Create config directory ──",
      '$ConfigDir = Join-Path $env:ProgramData "PopDAM"',
      "if (-not (Test-Path $ConfigDir)) {",
      "    New-Item -Path $ConfigDir -ItemType Directory -Force | Out-Null",
      '    Write-Host "Created config directory: $ConfigDir" -ForegroundColor Green',
      "}",
      "",
      "# ── Write .env for agent ──",
      '$InstallDir = "C:\\Program Files\\PopDAM\\WindowsAgent"',
      "if (-not (Test-Path $InstallDir)) {",
      "    New-Item -Path $InstallDir -ItemType Directory -Force | Out-Null",
      "}",
      "",
      '$EnvContent = @"',
      "SUPABASE_URL=" + serverUrl,
      "POPDAM_SERVER_URL=" + serverUrl,
      "POPDAM_PAIRING_CODE=" + pairingCode,
      "AGENT_NAME=" + agentName,
      '"@',
      "",
      '$EnvPath = Join-Path $InstallDir ".env"',
      "Set-Content -Path $EnvPath -Value $EnvContent -Encoding UTF8 -Force",
      'Write-Host "Wrote config to $EnvPath" -ForegroundColor Green',
      "",
      "# ── Map network drive (optional) ──",
      "if ($DriveLetter -and $NasHost -and $NasShare) {",
      '    $UncPath = "\\\\$NasHost\\$NasShare"',
      '    $DriveWithColon = "${DriveLetter}:"',
      "    $existing = Get-PSDrive -Name $DriveLetter -ErrorAction SilentlyContinue",
      "    if (-not $existing) {",
      '        Write-Host "Mapping $DriveWithColon to $UncPath..." -ForegroundColor Yellow',
      "        net use $DriveWithColon $UncPath /persistent:yes",
      '        Write-Host "Drive mapped successfully." -ForegroundColor Green',
      "    } else {",
      '        Write-Host "Drive $DriveWithColon already mapped." -ForegroundColor Cyan',
      "    }",
      "}",
      "",
      "# ── Generate uninstall script ──",
      '$UninstallScript = @"',
      "#Requires -RunAsAdministrator",
      'Write-Host "Uninstalling PopDAM Windows Render Agent..." -ForegroundColor Yellow',
      '\\$TaskName = "PopDAM Windows Render Agent"',
      "\\$task = Get-ScheduledTask -TaskName \\$TaskName -ErrorAction SilentlyContinue",
      "if (\\$task) {",
      "    Stop-ScheduledTask -TaskName \\$TaskName -ErrorAction SilentlyContinue",
      "    Unregister-ScheduledTask -TaskName \\$TaskName -Confirm:\\$false",
      '    Write-Host "Scheduled task removed." -ForegroundColor Green',
      "}",
      'Write-Host "Uninstall complete. Config files in %ProgramData%\\PopDAM remain." -ForegroundColor Green',
      '"@',
      "",
      '$UninstallPath = Join-Path $InstallDir "uninstall.ps1"',
      "Set-Content -Path $UninstallPath -Value $UninstallScript -Encoding UTF8 -Force",
      'Write-Host "Wrote uninstall script to $UninstallPath" -ForegroundColor Green',
      "",
      "# ── Summary ──",
      'Write-Host ""',
      'Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan',
      'Write-Host "║  PopDAM Windows Agent — Configuration Written    ║" -ForegroundColor Cyan',
      'Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan',
      'Write-Host ""',
      'Write-Host "Next steps:" -ForegroundColor Yellow',
      'Write-Host "  1. Download the agent from GitHub Releases"',
      'Write-Host "  2. Extract to $InstallDir"',
      'Write-Host "  3. Run install-scheduled-task.ps1 to register startup"',
      'Write-Host "  4. Start the agent or log off / log on"',
      'Write-Host ""',
      'Write-Host "The agent will pair automatically on first start." -ForegroundColor Green',
      'Write-Host "Pairing code expires in 15 minutes!" -ForegroundColor Red',
    ].join("\n");

    const readme = [
      "╔══════════════════════════════════════════════════╗",
      "║     PopDAM Windows Render Agent — Quick Start    ║",
      "╚══════════════════════════════════════════════════╝",
      "",
      "IMPORTANT: This pairing code expires in 15 minutes!",
      "",
      "── STEP 1: Run the installer ──────────────────────",
      "Right-click install.ps1 → 'Run with PowerShell'",
      "(or: powershell -ExecutionPolicy Bypass -File install.ps1)",
      "",
      "This will:",
      "  • Create C:\\Program Files\\PopDAM\\WindowsAgent\\",
      "  • Write .env with server URL and pairing code",
      ...(desiredDriveLetter ? ["  • Map " + desiredDriveLetter + ": to \\\\" + nasHost + "\\" + nasShare] : []),
      "  • Generate an uninstall script",
      "",
      "── STEP 2: Download & extract agent ────────────────",
      "Download the latest agent zip from GitHub Releases:",
      "  https://github.com/u2giants/popdam3/releases",
      "Extract into C:\\Program Files\\PopDAM\\WindowsAgent\\",
      "",
      "── STEP 3: Start the agent ─────────────────────────",
      "Run install-scheduled-task.ps1 (in the agent folder)",
      "Then: Start-ScheduledTask -TaskName 'PopDAM Windows Render Agent'",
      "",
      "The agent will pair automatically on first start.",
      "",
      "── Troubleshooting ───────────────────────────────",
      "• Check agent status in PopDAM Settings → Windows Agent",
      "• If pairing code expired, download a new bundle",
      "• Adobe Illustrator must be installed and activated",
      "",
      "Agent name: " + agentName,
      "Server: " + serverUrl,
      "Generated: " + now.toISOString(),
    ].join("\n");

    zip.file("install.ps1", installPs1);
    zip.file("README.txt", readme);
  }

  const zipBlob = await zip.generateAsync({ type: "uint8array" });
  const filename = agentType === "bridge" ? "popdam-bridge-bundle.zip" : "popdam-windows-agent-bundle.zip";

  return new Response(zipBlob as unknown as BodyInit, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
