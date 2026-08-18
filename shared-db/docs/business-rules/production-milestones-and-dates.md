# Production milestones and needed dates

**Status:** Proposed

## Schedule anchors

Production Tracking builds needed-by dates backward from the applicable committed date:

- **Ship Date** anchors production milestones such as sample, pre-production sample, mass production, packing, quality inspection, and shipping.
- **Due Date** anchors licensing milestones such as submission, resubmission, and pre-production-sample approval.

The label shown to users must identify which anchor is being used. A field must not be called Delivery Date when it actually stores Ship Date or Due Date.

## Item-level and order-level dates

Licensing history is Item/SKU-specific. Current factory-production dates are Purchase-Order-level and may be displayed under each SKU for context, but they remain inherited order dates. The display must not imply that every SKU has independently recorded factory dates.

True per-SKU production dates require their own business events and data. They must not be manufactured by copying a Purchase Order date into separate-looking SKU records.

## History

Needed dates are plans. Completed-at dates and actual production events are separate facts. Recalculation of a planned schedule must not rewrite completed history.

## Implementation and evidence

DesignFlow's [Production Tracking reference](https://github.com/popcre/designflow-frontend/blob/develop/src/app/pages/prod_tracking/README.md) explains the current screen and inherited-row implementation. It must link here and must not redefine the milestone model.
