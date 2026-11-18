# PopDAM Data Export Script (PowerShell)
# Downloads all tables from the Lovable Cloud Supabase project as CSV files
# using the export-table edge function.
#
# PREREQUISITES:
#   1. The export-table edge function must be deployed
#   2. You need the SUPABASE_SERVICE_ROLE_KEY from Lovable Cloud
#
# USAGE:
#   1. Open PowerShell
#   2. cd to the folder where you want the CSV files saved
#   3. Edit the $ServiceRoleKey variable below
#   4. Run: .\export-all-tables.ps1
#
# The script will create a subfolder called "export" with all CSV files.
#
# FAILURE RULES (#1097):
#   - Any HTTP error, bad page, short page or row-count mismatch fails that table.
#   - Each table is written to <table>.csv.tmp and replaces <table>.csv only after
#     every page has validated. A failed table keeps its previous complete file.
#   - If any table fails, the script lists the failed tables and exits with code 1.
#     The import steps are printed only after a fully successful run.

# Make every error terminating so no failure goes unnoticed
$ErrorActionPreference = "Stop"

# ── CONFIGURATION ────────────────────────────────────────────────────────────
$SupabaseUrl = "https://qsllyeztdwjgirsysgai.supabase.co"
$ServiceRoleKey = "PASTE_YOUR_SERVICE_ROLE_KEY_HERE"
$PageSize = 50000
$OutputDir = ".\export"

# ── TABLE LIST (ordered by import dependency) ────────────────────────────────
# Every name must be in the export-table edge function's ALLOWED_TABLES
# (checked by src/test/export-all-tables-integrity.test.ts).
$Tables = @(
    "licensors",
    "properties",
    "characters",
    "product_categories",
    "product_types",
    "product_subtypes",
    "erp_sync_runs",
    "style_groups",
    "assets",
    "asset_tags",
    "asset_characters",
    "asset_path_history",
    "processing_queue",
    "render_queue",
    "tiff_optimization_queue",
    "hygiene_findings",
    "plm_item_list",
    "erp_enrichment_log",
    "product_category_predictions",
    "invitations",
    "agent_registrations",
    "agent_pairings"
)

# ── SCRIPT ───────────────────────────────────────────────────────────────────

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}
# Absolute path, so .NET file calls resolve the same folder as Join-Path below
$OutputDirFull = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)

$Headers = @{
    "Authorization" = "Bearer $ServiceRoleKey"
    "Content-Type"  = "application/json"
}

function Get-RequiredHeader($Response, [string]$Name) {
    $value = $Response.Headers[$Name]
    if ([string]::IsNullOrEmpty("$value")) { throw "response has no $Name header" }
    return "$value"
}

function Publish-File([string]$Source, [string]$Destination) {
    # File.Replace swaps the file in one filesystem operation, so the previous
    # export survives any failure before the swap. First exports use Move.
    if (Test-Path -LiteralPath $Destination) {
        [System.IO.File]::Replace($Source, $Destination, $null)
    } else {
        [System.IO.File]::Move($Source, $Destination)
    }
}

function Export-Table([string]$Table) {
    Write-Host "`n━━━ Exporting: $Table ━━━" -ForegroundColor Cyan

    $filePath = Join-Path $OutputDirFull "$Table.csv"
    $tmpPath = Join-Path $OutputDirFull "$Table.csv.tmp"
    if (Test-Path -LiteralPath $tmpPath) { Remove-Item -LiteralPath $tmpPath -Force }

    try {
        $content = New-Object System.Text.StringBuilder
        $page = 0
        $totalRows = 0
        $totalCount = 0

        while ($true) {
            $url = "$SupabaseUrl/functions/v1/export-table?table=$Table&page=$page&page_size=$PageSize&format=csv"

            # Any HTTP error (4xx/5xx), timeout or connection failure throws here
            $response = Invoke-WebRequest -Uri $url -Headers $Headers -Method GET -ErrorAction Stop
            $contentType = [string]$response.Headers["Content-Type"]

            if ($contentType -like "*application/json*") {
                # The server answers JSON only for "no more rows" or for an error
                $jsonBody = $response.Content | ConvertFrom-Json
                if ($jsonBody.error) { throw "page $page : $($jsonBody.error)" }
                if ([int]$jsonBody.rowsInPage -ne 0) { throw "page $page returned JSON data where CSV was expected" }
                if ($null -eq $jsonBody.totalCount) { throw "page $page has no totalCount" }
                $totalCount = [int64]$jsonBody.totalCount
                $pageRows = 0
            } else {
                $totalCount = [int64](Get-RequiredHeader $response "X-Total-Count")
                $pageRows = [int](Get-RequiredHeader $response "X-Rows-In-Page")
                # Every page but the last is full; a short page means rows were lost
                $expectedRows = [Math]::Max([int64]0, [Math]::Min([int64]$PageSize, $totalCount - ([int64]$page * $PageSize)))
                if ($pageRows -ne $expectedRows) {
                    throw "page $page returned $pageRows rows, expected $expectedRows"
                }
                # Page 0 carries the CSV header line; later pages do not
                if ($pageRows -gt 0) { [void]$content.Append($response.Content) }
            }

            $totalRows += $pageRows
            Write-Host "  Page $page : $pageRows rows (total so far: $totalRows / $totalCount)" -ForegroundColor Green

            if ($totalRows -ge $totalCount) { break }
            if ($pageRows -eq 0) { throw "no rows on page $page after $totalRows of $totalCount" }

            $page++
            # Small delay to avoid rate limiting
            Start-Sleep -Milliseconds 500
        }

        if ($totalRows -ne $totalCount) { throw "received $totalRows rows, server reports $totalCount" }

        if ($totalRows -eq 0) {
            # A verified empty table has no file; drop any older file so the folder matches this run
            if (Test-Path -LiteralPath $filePath) { Remove-Item -LiteralPath $filePath -Force }
            Write-Host "  Empty table, no file written" -ForegroundColor DarkGray
            return
        }

        $content.ToString() | Out-File -FilePath $tmpPath -Encoding UTF8 -NoNewline
        if ((Get-Item -LiteralPath $tmpPath).Length -eq 0) { throw "temporary file is empty" }
        Publish-File $tmpPath $filePath
        Write-Host "  ✅ Saved: $filePath ($totalRows rows)" -ForegroundColor Green
    }
    finally {
        # Only a failed run leaves a temp file behind; remove it either way
        if (Test-Path -LiteralPath $tmpPath) { Remove-Item -LiteralPath $tmpPath -Force }
    }
}

$FailedTables = @()
foreach ($table in $Tables) {
    try {
        Export-Table $table
    } catch {
        Write-Host "  EXPORT FAILED for $table : $_" -ForegroundColor Red
        Write-Host "  The previous $table.csv (if any) was left unchanged." -ForegroundColor Yellow
        $FailedTables += $table
    }
}

if ($FailedTables.Count -gt 0) {
    Write-Host ""
    Write-Host "EXPORT INCOMPLETE: $($FailedTables.Count) table(s) failed: $($FailedTables -join ', ')" -ForegroundColor Red
    Write-Host "Do NOT import the failed tables from this run. Re-run the export after fixing the error." -ForegroundColor Red
    exit 1
}

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Export complete! Files saved to: $OutputDirFull" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "  1. Open your external Supabase project dashboard"
Write-Host "  2. Go to SQL Editor"
Write-Host "  3. Run: SET session_replication_role = 'replica';"
Write-Host "  4. Import CSVs in this order (Table Editor → Import CSV):"
foreach ($table in $Tables) {
    Write-Host "     - $table"
}
Write-Host "  5. Run: SET session_replication_role = 'origin';"
Write-Host ""
