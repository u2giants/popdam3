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
#   3. Files appear in .\dump\  — run them with psql (see output)
#
# NOTE: JWTs expire after ~1 hour. Get a fresh one before running.

# ── CONFIGURATION ────────────────────────────────────────────────────
$SupabaseUrl  = "https://vklanxwmaeqjbwtmnygj.supabase.co"
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

# Create output directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# Step 1: Get manifest
Write-Host "Fetching manifest..." -ForegroundColor Cyan
$manifestUrl = "$SupabaseUrl/functions/v1/export-sql-dump?action=manifest&chunk_size=$ChunkSize"
try {
    $manifestResp = Invoke-WebRequest -Uri $manifestUrl -Headers $Headers -Method GET -TimeoutSec 60 -ErrorAction Stop
} catch {
    Write-Host "ERROR fetching manifest: $_" -ForegroundColor Red
    Write-Host "Check your JWT token is valid and you have admin role." -ForegroundColor Yellow
    exit 1
}
$manifest = $manifestResp.Content | ConvertFrom-Json

Write-Host ""
Write-Host "━━━ Export Manifest ━━━" -ForegroundColor Green
$totalChunks = 0
$totalRows = 0
foreach ($t in $manifest.tables) {
    if ($t.rows -gt 0) {
        Write-Host ("  {0,-30} {1,8} rows  ({2} chunks)" -f $t.table, $t.rows, $t.chunks) -ForegroundColor White
    } else {
        Write-Host ("  {0,-30} {1,8} rows  (skip)" -f $t.table, $t.rows) -ForegroundColor DarkGray
    }
    $totalChunks += $t.chunks
    $totalRows += $t.rows
}
Write-Host ""
Write-Host "Total: $totalRows rows across $totalChunks chunks" -ForegroundColor Cyan
Write-Host ""

# Step 2: Download each chunk
$fileIndex = 0
$downloadedFiles = @()

foreach ($t in $manifest.tables) {
    if ($t.rows -eq 0) { continue }

    for ($chunk = 0; $chunk -lt $t.chunks; $chunk++) {
        $offset = $chunk * $ChunkSize
        $fileIndex++
        $paddedIndex = "{0:D3}" -f $fileIndex
        $fileName = "${paddedIndex}_$($t.table)_chunk${chunk}.sql"
        $filePath = Join-Path $OutputDir $fileName

        $truncateParam = if ($chunk -eq 0 -and $IncludeTruncate -eq "true") { "&truncate=true" } else { "" }
        $chunkUrl = "$SupabaseUrl/functions/v1/export-sql-dump?table=$($t.table)&offset=$offset&chunk_size=$ChunkSize$truncateParam"

        Write-Host ("  [{0}/{1}] {2}..." -f $fileIndex, $totalChunks, $fileName) -ForegroundColor Gray -NoNewline

        try {
            $resp = Invoke-WebRequest -Uri $chunkUrl -Headers $Headers -Method GET -TimeoutSec 120 -ErrorAction Stop
            $resp.Content | Out-File -FilePath $filePath -Encoding UTF8 -NoNewline
            $rowsInChunk = $resp.Headers["X-Rows-In-Chunk"]
            Write-Host " $rowsInChunk rows" -ForegroundColor Green
            $downloadedFiles += $filePath
        } catch {
            Write-Host " FAILED: $_" -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "✅ Downloaded $($downloadedFiles.Count) SQL files to $OutputDir" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT STEPS — run all files in order with psql:" -ForegroundColor Yellow
Write-Host ""
Write-Host '  $PGCONN = "postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"' -ForegroundColor White
Write-Host ""
Write-Host "  # Run all chunks in order:" -ForegroundColor White
Write-Host '  Get-ChildItem .\dump\*.sql | Sort-Object Name | ForEach-Object {' -ForegroundColor White
Write-Host '    Write-Host "Running $($_.Name)..."' -ForegroundColor White
Write-Host '    psql $PGCONN -f $_.FullName' -ForegroundColor White
Write-Host '  }' -ForegroundColor White
Write-Host ""
