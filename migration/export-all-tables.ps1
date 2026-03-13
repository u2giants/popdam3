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

# ── CONFIGURATION ────────────────────────────────────────────────────────────
$SupabaseUrl = "https://ryltkzzernhwnojzouyb.supabase.co"
$ServiceRoleKey = "PASTE_YOUR_SERVICE_ROLE_KEY_HERE"
$PageSize = 50000
$OutputDir = ".\export"

# ── TABLE LIST (ordered by import dependency) ────────────────────────────────
$Tables = @(
    "admin_config",
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
    "erp_items_current",
    "erp_items_raw",
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

$Headers = @{
    "Authorization" = "Bearer $ServiceRoleKey"
    "Content-Type"  = "application/json"
}

foreach ($table in $Tables) {
    Write-Host "`n━━━ Exporting: $table ━━━" -ForegroundColor Cyan
    
    $page = 0
    $allContent = ""
    $totalRows = 0
    
    while ($true) {
        $url = "$SupabaseUrl/functions/v1/export-table?table=$table&page=$page&page_size=$PageSize&format=csv"
        
        try {
            $response = Invoke-WebRequest -Uri $url -Headers $Headers -Method GET -ErrorAction Stop
            $contentType = $response.Headers["Content-Type"]
            
            # If we get JSON back, it means no more data or an error
            if ($contentType -like "*application/json*") {
                $jsonBody = $response.Content | ConvertFrom-Json
                if ($jsonBody.rowsInPage -eq 0) {
                    Write-Host "  Page $page : no more data" -ForegroundColor DarkGray
                    break
                }
                if ($jsonBody.error) {
                    Write-Host "  ERROR: $($jsonBody.error)" -ForegroundColor Red
                    break
                }
                break
            }
            
            # CSV data
            $csvContent = $response.Content
            $lineCount = ($csvContent -split "`n" | Where-Object { $_ -ne "" }).Count
            
            # On page 0, the first line is the header
            if ($page -eq 0) {
                $dataLines = $lineCount - 1
            } else {
                $dataLines = $lineCount
            }
            
            $totalRows += $dataLines
            $allContent += $csvContent
            
            $totalPages = if ($response.Headers["X-Total-Pages"]) { $response.Headers["X-Total-Pages"] } else { "?" }
            $totalCount = if ($response.Headers["X-Total-Count"]) { $response.Headers["X-Total-Count"] } else { "?" }
            
            Write-Host "  Page $page/$totalPages : $dataLines rows (total so far: $totalRows / $totalCount)" -ForegroundColor Green
            
            # Check if we're done
            if ($dataLines -lt $PageSize) {
                break
            }
            
            $page++
            
            # Small delay to avoid rate limiting
            Start-Sleep -Milliseconds 500
            
        } catch {
            Write-Host "  ERROR on page $page : $_" -ForegroundColor Red
            break
        }
    }
    
    if ($totalRows -gt 0) {
        $filePath = Join-Path $OutputDir "$table.csv"
        $allContent | Out-File -FilePath $filePath -Encoding UTF8 -NoNewline
        Write-Host "  ✅ Saved: $filePath ($totalRows rows)" -ForegroundColor Green
    } else {
        Write-Host "  ⏭️  Empty table, skipped" -ForegroundColor DarkGray
    }
}

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Export complete! Files saved to: $OutputDir" -ForegroundColor Green
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
