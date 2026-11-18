# PopDAM Chunked SQL Dump Download Script
# Downloads all tables as individual SQL chunk files, then runs them via psql.
#
# HOW TO GET YOUR AUTH TOKEN:
#   1. Log into PopDAM in your browser
#   2. Open DevTools (F12) → Console
#   3. Run:  copy((await (await import('/src/integrations/supabase/client.ts')).supabase.auth.getSession()).data.session.access_token)
#   4. Your JWT is now on your clipboard — paste it below
#
# USAGE:
#   1. Paste your admin JWT into the $AuthToken variable below
#   2. Run: .\download-sql-dump.ps1
#   3. A fresh folder .\dump\<timestamp>\ is created per run. Only when every
#      chunk downloads and validates is restore-order.txt written; restore ONLY
#      the files it lists (see output). A failed run is renamed *-INCOMPLETE.
#
# NOTE: JWTs expire after ~1 hour. Get a fresh one before running.

# ── CONFIGURATION ────────────────────────────────────────────────────
$SupabaseUrl  = "https://qsllyeztdwjgirsysgai.supabase.co"
$AuthToken    = "PASTE_YOUR_JWT_HERE"
$OutputDir    = ".\dump"
$ChunkSize    = 5000
# Set to "true" to include TRUNCATE on first chunk of each table
$IncludeTruncate = "true"

# ── SCRIPT ───────────────────────────────────────────────────────────

$Headers = @{
    "Authorization" = "Bearer $AuthToken"
    "Content-Type"  = "application/json"
}

# Fresh per-run directory so files from earlier exports can never mix in (#1083)
$RunStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$RunDir   = Join-Path $OutputDir $RunStamp
if (Test-Path $RunDir) { Write-Host "ERROR: $RunDir already exists" -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Path $RunDir -Force | Out-Null

function Fail-Run([string]$Reason) {
    Write-Host ""
    Write-Host "EXPORT INCOMPLETE: $Reason" -ForegroundColor Red
    Write-Host "No restore bundle was published. Do NOT import any file from $RunDir." -ForegroundColor Red
    Rename-Item -Path $RunDir -NewName "$RunStamp-INCOMPLETE" -ErrorAction SilentlyContinue
    exit 1
}

# Step 1: Get manifest
Write-Host "Fetching manifest..." -ForegroundColor Cyan
$manifestUrl = "$SupabaseUrl/functions/v1/export-sql-dump?action=manifest&chunk_size=$ChunkSize"
try {
    $manifestResp = Invoke-WebRequest -Uri $manifestUrl -Headers $Headers -Method GET -TimeoutSec 60 -ErrorAction Stop
} catch {
    Write-Host "Check your JWT token is valid and you have admin role." -ForegroundColor Yellow
    Fail-Run "manifest request failed: $_"
}
$manifest = $manifestResp.Content | ConvertFrom-Json
# A manifest without complete=true may have dropped a table whose count failed (#1082)
if ($manifest.complete -ne $true) { Fail-Run "manifest is not marked complete" }
if ([int]$manifest.chunkSize -ne $ChunkSize) { Fail-Run "manifest chunk size $($manifest.chunkSize) != $ChunkSize" }

Write-Host ""
Write-Host "━━━ Export Manifest ━━━" -ForegroundColor Green
$totalChunks = 0
$totalRows = 0
foreach ($t in $manifest.tables) {
    if ($t.rows -gt 0) {
        Write-Host ("  {0,-30} {1,8} rows  ({2} chunks)" -f $t.table, $t.rows, $t.chunks) -ForegroundColor White
    } else {
        Write-Host ("  {0,-30} {1,8} rows  (empty)" -f $t.table, $t.rows) -ForegroundColor DarkGray
    }
    $totalChunks += $t.chunks
    $totalRows += $t.rows
}
Write-Host ""
Write-Host "Total: $totalRows rows across $totalChunks chunks" -ForegroundColor Cyan
Write-Host ""

# Step 2: Download each chunk; any failed, short or truncated chunk aborts the run (#1084)
$fileIndex = 0
$downloadedFiles = @()

foreach ($t in $manifest.tables) {
    if ($t.rows -eq 0) { continue }

    for ($chunk = 0; $chunk -lt $t.chunks; $chunk++) {
        $offset = $chunk * $ChunkSize
        $expectedRows = [Math]::Min($ChunkSize, $t.rows - $offset)
        $fileIndex++
        $paddedIndex = "{0:D3}" -f $fileIndex
        $fileName = "${paddedIndex}_$($t.table)_chunk${chunk}.sql"
        $filePath = Join-Path $RunDir $fileName

        $truncateParam = if ($chunk -eq 0 -and $IncludeTruncate -eq "true") { "&truncate=true" } else { "" }
        $chunkUrl = "$SupabaseUrl/functions/v1/export-sql-dump?table=$($t.table)&offset=$offset&chunk_size=$ChunkSize$truncateParam"

        Write-Host ("  [{0}/{1}] {2}..." -f $fileIndex, $totalChunks, $fileName) -ForegroundColor Gray -NoNewline

        try {
            $resp = Invoke-WebRequest -Uri $chunkUrl -Headers $Headers -Method GET -TimeoutSec 120 -ErrorAction Stop
        } catch {
            Write-Host " FAILED" -ForegroundColor Red
            Fail-Run "$fileName download failed: $_"
        }
        $rowsInChunk = [int]("$($resp.Headers['X-Rows-In-Chunk'])")
        if ($rowsInChunk -ne $expectedRows) { Fail-Run "$fileName has $rowsInChunk rows, expected $expectedRows" }
        if (-not $resp.Content.TrimEnd().EndsWith("COMMIT;")) { Fail-Run "$fileName is truncated (no COMMIT)" }
        $resp.Content | Out-File -FilePath $filePath -Encoding UTF8 -NoNewline
        Write-Host " $rowsInChunk rows" -ForegroundColor Green
        $downloadedFiles += $fileName
    }
}

if ($downloadedFiles.Count -ne $totalChunks) { Fail-Run "downloaded $($downloadedFiles.Count) of $totalChunks chunks" }

# Step 3: Publish the restore bundle — only validated files, in order (#1085)
$RestoreList = Join-Path $RunDir "restore-order.txt"
$downloadedFiles | Set-Content -Path $RestoreList -Encoding UTF8

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "✅ Validated $($downloadedFiles.Count) SQL files in $RunDir" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT STEPS — restore ONLY the files listed in restore-order.txt, stopping on first error:" -ForegroundColor Yellow
Write-Host ""
Write-Host '  $PGCONN = "postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"' -ForegroundColor White
Write-Host ""
Write-Host "  `$RunDir = `"$RunDir`"" -ForegroundColor White
Write-Host '  Get-Content (Join-Path $RunDir "restore-order.txt") | ForEach-Object {' -ForegroundColor White
Write-Host '    Write-Host "Running $_..."' -ForegroundColor White
Write-Host '    psql $PGCONN -v ON_ERROR_STOP=1 -f (Join-Path $RunDir $_)' -ForegroundColor White
Write-Host '    if ($LASTEXITCODE -ne 0) { throw "Restore stopped at $_" }' -ForegroundColor White
Write-Host '  }' -ForegroundColor White
Write-Host ""
