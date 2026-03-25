## Add PDF Ingestion for Specific Document Types (Full-Page Images, First 2 Pages)

### Summary

Ingest `.pdf` files whose filenames match specific keywords (tech pack, licensing sheet, comp view). Render the first 2 pages as high-res images (1500px) to be clear enough for OCR (not used as the default thumbnail/preview image) and a 800px thumbnail size image to be used in the ui, and upload them to DigitalOcean Spaces. The page images become the asset's thumbnail (page 1) and a secondary stored image (page 2).

### What Changes

**1. Database migration — add `pdf` to `file_type` enum**

```sql
ALTER TYPE public.file_type ADD VALUE IF NOT EXISTS 'pdf';
```

**2. Bridge Agent scanner (`apps/bridge-agent/src/scanner.ts`)**

- Add `.pdf` to `SUPPORTED_EXTENSIONS`
- Add keyword filter: only accept PDFs whose filename (case-insensitive) contains one of the specified keywords
- Non-matching PDFs increment `rejected_wrong_type` and are skipped
- Update `FileCandidate.fileType` union to include `"pdf"`

```typescript
const PDF_KEYWORDS = [
  "tech pack", "tech_pack", "techpack", "tech-pack",
  "licensing sheet", "licensing-sheet", "licensing_sheet",
  "_comp view", "_compview",
];

function isPdfCandidate(filename: string): boolean {
  const lower = filename.toLowerCase();
  return PDF_KEYWORDS.some(kw => lower.includes(kw));
}
```

**3. Bridge Agent thumbnailer (`apps/bridge-agent/src/thumbnailer.ts`)**

- Add `thumbnailPdf()` function that renders pages 1-2 at 1500px max dimension using Ghostscript (`-r200` for higher DPI)
- Return a `ThumbnailResult` with page 1 as the primary buffer
- New extended result type to carry page 2 buffer separately

```typescript
export interface PdfThumbnailResult extends ThumbnailResult {
  page2Buffer?: Buffer;
  page2Width?: number;
  page2Height?: number;
}
```

- Add `"pdf"` case to `generateThumbnail()` entry point

and this functionality integrated into the Windows Render Agent

**4. Bridge Agent uploader (`apps/bridge-agent/src/uploader.ts`)**

- Add `uploadPdfPage()` function that stores under `pdf-pages/{assetId}_p{pageNum}.jpg`
- Returns the CDN URL for each page

and this functionality integrated into the Windows Render Agent

**5. Bridge Agent main (`apps/bridge-agent/src/index.ts`)**

- Update `processThumbnail()` to handle the PDF case: upload page 1 as the normal thumbnail, upload page 2 as a secondary image
- Store page 2 URL in the ingest payload (new optional field `pdf_page2_url`)

**6. Agent API validation (`supabase/functions/agent-api/index.ts`)**

- Add `"pdf"` to the accepted `file_type` values in the ingest endpoint
- Accept optional `pdf_page2_url` field and store it on the asset

**7. Database — store page 2 URL**

- Add `pdf_page2_url text` column to `assets` table (nullable, only populated for PDFs)

**8. Sibling scan handler (`supabase/functions/_shared/admin-handlers/sibling-scan-handlers.ts`)**

- Add `pdf: "pdf"` to the extension map
- &nbsp;

### What Does NOT Change

- AI tagging pipeline — works on thumbnails, PDFs with page images will be taggable
- Style grouping — SKU parsing works on folder paths, unaffected
- UI — `pdf` will appear in file type filters automatically
- ERP enrichment — works on SKU, unaffected

### Deployment

1. Database migration deploys automatically
2. Bridge Agent requires Docker rebuild + redeploy on Synology
3. What Bridge Agent Functions should also be added to the Windows Render Agent?
4. Edge functions deploy via GitHub Actions

### Technical Details

- Ghostscript renders at 200 DPI for readable text at 1500px
- JPEG quality 90 (higher than normal thumbnails) for text legibility
- Max dimension 1500px (vs 800px for normal thumbnails) so text in tech packs is readable by AI
- Only first 2 pages captured per user preference
- The `pdf_page2_url` column allows future UI to show a "page 2" preview or feed both pages to AI tagging