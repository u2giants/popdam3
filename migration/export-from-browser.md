# Export Data from Lovable Cloud — Browser Method

Since Lovable Cloud doesn't show you the Service Role Key, use this method instead.
You'll call the export function **from your browser** while logged in as admin.

---

## Prerequisites

- You must be logged into PopDAM as an admin user
- Open the app in Chrome/Edge: https://popdam.lovable.app

---

## Step-by-Step Instructions

### 1. Open the app and log in

Go to https://popdam.lovable.app and log in with your admin account.

### 2. Open the browser Developer Tools

- Press **F12** on your keyboard (or right-click anywhere → "Inspect")
- Click the **Console** tab at the top of the DevTools panel

### 3. Paste and run the export script

Copy the ENTIRE block below, paste it into the Console, and press Enter:

```javascript
// PopDAM Export Script — run in browser console while logged in as admin
(async () => {
  const PROJECT_ID = 'ryltkzzernhwnojzouyb';
  const BASE_URL = `https://${PROJECT_ID}.supabase.co/functions/v1/export-table`;
  const PAGE_SIZE = 50000;

  // Get your auth token from the current session
  const tokenKey = Object.keys(localStorage).find(k => k.includes('auth-token'));
  let token;
  if (tokenKey) {
    try {
      const parsed = JSON.parse(localStorage.getItem(tokenKey));
      token = parsed?.access_token || parsed;
    } catch { token = localStorage.getItem(tokenKey); }
  }
  if (!token) {
    // Try Supabase session storage
    for (const key of Object.keys(localStorage)) {
      if (key.includes('supabase') && key.includes('auth')) {
        try {
          const parsed = JSON.parse(localStorage.getItem(key));
          if (parsed?.access_token) { token = parsed.access_token; break; }
        } catch {}
      }
    }
  }
  if (!token) {
    console.error('❌ Could not find auth token. Are you logged in?');
    return;
  }
  console.log('✅ Found auth token');

  const TABLES = [
    'admin_config', 'licensors', 'properties', 'characters',
    'product_categories', 'product_types', 'product_subtypes',
    'erp_sync_runs', 'style_groups', 'assets', 'asset_tags',
    'asset_characters', 'asset_path_history', 'processing_queue',
    'render_queue', 'tiff_optimization_queue', 'hygiene_findings',
    'erp_items_current', 'erp_items_raw', 'erp_enrichment_log',
    'product_category_predictions', 'invitations',
    'agent_registrations', 'agent_pairings'
  ];

  for (const table of TABLES) {
    console.log(`\n━━━ Exporting: ${table} ━━━`);
    let page = 0;
    let allCsv = '';
    let totalRows = 0;

    while (true) {
      const url = `${BASE_URL}?table=${table}&page=${page}&page_size=${PAGE_SIZE}&format=csv`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const json = await res.json();
        if (json.error) { console.error(`  ❌ Error: ${json.error}`); break; }
        if (json.rowsInPage === 0) { console.log('  No more data'); break; }
        break;
      }

      const csv = await res.text();
      const lines = csv.split('\n').filter(l => l.trim() !== '');
      const dataLines = page === 0 ? lines.length - 1 : lines.length;
      totalRows += dataLines;

      const totalPages = res.headers.get('X-Total-Pages') || '?';
      const totalCount = res.headers.get('X-Total-Count') || '?';
      console.log(`  Page ${page}/${totalPages}: ${dataLines} rows (total: ${totalRows}/${totalCount})`);

      allCsv += csv;

      if (dataLines < PAGE_SIZE) break;
      page++;
      await new Promise(r => setTimeout(r, 500)); // small delay
    }

    if (totalRows > 0) {
      // Trigger download
      const blob = new Blob([allCsv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${table}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      console.log(`  ✅ Downloaded: ${table}.csv (${totalRows} rows)`);
    } else {
      console.log(`  ⏭️ Empty table, skipped`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Export complete! Check your Downloads folder.');
})();
```

### 4. Wait for downloads

The script will download each table as a separate CSV file to your Downloads folder.
Watch the Console output — it shows progress for each table.

**Expected timing:** ~5-10 minutes for all tables (the largest tables like `asset_tags` with 726k rows will take the longest).

### 5. Verify your downloads

You should have CSV files in your Downloads folder:
- `admin_config.csv`
- `licensors.csv`
- `properties.csv`
- `characters.csv`
- `assets.csv` (largest ~92k rows)
- `asset_tags.csv` (largest ~726k rows)
- `style_groups.csv`
- etc.

---

## Troubleshooting

**"Could not find auth token"**
→ Make sure you're logged into PopDAM first, then try again.

**"Unauthorized"**
→ Your session may have expired. Refresh the page, log in again, and re-run the script.

**Browser blocks multiple downloads**
→ Chrome/Edge may ask "This site is trying to download multiple files." Click **Allow**.
→ You may need to check your browser settings: Settings → Privacy → Automatic downloads → Allow.

**Script seems stuck**
→ Large tables (asset_tags, render_queue) take time. Check the Console — it logs progress per page.

---

## Next Step

After exporting, proceed to importing into your external Supabase project.
See the migration plan in `.lovable/plan.md` for import instructions.
