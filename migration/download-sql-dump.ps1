# PopDAM SQL Dump Download Script (PowerShell)
# Downloads a complete SQL dump from the export-sql-dump edge function.
#
# HOW TO GET YOUR AUTH TOKEN:
#   1. Log into PopDAM in your browser
#   2. Open DevTools (F12) → Console
#   3. Run:  copy((await (await import('/src/integrations/supabase/client.ts')).supabase.auth.getSession()).data.session.access_token)
#   4. Your JWT is now on your clipboard — paste it below
#
# USAGE:
#   1. Open PowerShell
#   2. Paste your JWT into the $AuthToken variable below
#   3. Run: .\download-sql-dump.ps1

# ── CONFIGURATION ────────────────────────────────────────────────────────────
$SupabaseUrl = "https://vklanxwmaeqjbwtmnygj.supabase.co"
$AuthToken = "PASTE_YOUR_JWT_HERE"
$OutputFile = ".\popdam-dump.sql"
# Set to "true" to include TRUNCATE statements (wipes target tables first)
$IncludeTruncate = "true"

# ── SCRIPT ───────────────────────────────────────────────────────────────────

$Headers = @{
    "Authorization" = "Bearer $ServiceRoleKey"
    "Content-Type"  = "application/json"
}

$url = "$SupabaseUrl/functions/v1/export-sql-dump?truncate=$IncludeTruncate"

Write-Host "Downloading SQL dump from Lovable Cloud..." -ForegroundColor Cyan
Write-Host "This may take several minutes for large databases." -ForegroundColor DarkGray
Write-Host ""

try {
    # Use longer timeout for large exports
    $response = Invoke-WebRequest -Uri $url -Headers $Headers -Method GET -TimeoutSec 600 -ErrorAction Stop
    
    $contentType = $response.Headers["Content-Type"]
    
    if ($contentType -like "*application/json*") {
        $jsonBody = $response.Content | ConvertFrom-Json
        if ($jsonBody.error) {
            Write-Host "ERROR: $($jsonBody.error)" -ForegroundColor Red
            exit 1
        }
    }
    
    # Save the SQL file
    $response.Content | Out-File -FilePath $OutputFile -Encoding UTF8 -NoNewline
    
    $totalRows = $response.Headers["X-Total-Rows"]
    $fileSizeMB = [math]::Round((Get-Item $OutputFile).Length / 1MB, 2)
    
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host "✅ SQL dump saved: $OutputFile" -ForegroundColor Green
    Write-Host "   Total rows: $totalRows" -ForegroundColor Green
    Write-Host "   File size: ${fileSizeMB} MB" -ForegroundColor Green
    Write-Host ""
    Write-Host "NEXT STEPS:" -ForegroundColor Yellow
    Write-Host "  Option A (small dumps < 10MB):"
    Write-Host "    1. Open your external Supabase project dashboard"
    Write-Host "    2. Go to SQL Editor"
    Write-Host "    3. Paste the contents of $OutputFile and click Run"
    Write-Host ""
    Write-Host "  Option B (large dumps):"
    Write-Host "    1. Use psql to connect to your external project:"
    Write-Host '    2. psql "postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"'
    Write-Host "    3. Run: \i $OutputFile"
    Write-Host ""
} catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Common issues:" -ForegroundColor Yellow
    Write-Host "  - Function timed out: The dump may be too large for a single request."
    Write-Host "    Try exporting specific tables: ?tables=assets,style_groups"
    Write-Host "  - 401 Unauthorized: Check your service role key."
    exit 1
}
