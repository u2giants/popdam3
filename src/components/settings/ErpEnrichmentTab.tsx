import { ProductionPoSyncSection } from "./erp-enrichment/ProductionPoSyncSection";
import { QualityDashboard } from "./erp-enrichment/QualityDashboard";
import { EnrichmentControls } from "./erp-enrichment/EnrichmentControls";
import { ReviewQueue } from "./erp-enrichment/ReviewQueue";
import { ErpItemsBrowser } from "./erp-enrichment/ErpItemsBrowser";

// ── Main Export ───────────────────────────────────────────────────────

export default function ErpEnrichmentTab() {
  return (
    <div className="space-y-4">
      <ProductionPoSyncSection />
      <QualityDashboard />
      <EnrichmentControls />
      <ReviewQueue />
      <ErpItemsBrowser />
    </div>
  );
}
