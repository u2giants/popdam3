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

## Stage lists and who maintains them

**Status:** Settled for ownership and list rules (Albert Hazan, 2026-10-15). Stage order, durations, and dependencies below are Unknown or Proposed as marked.

The order-timeline stages fall into five business lists: Design, Licensing, Sampling, Production, and Shipping. Stage names, order, and durations are business data that the people running each process maintain. They are not fixed program rules.

- Only an admin may create or remove a whole list. Other authorized users work only with the stages inside the five lists.
- Everyone can see every list.
- Named list maintainers (Albert Hazan, 2026-10-15; supersedes the earlier role-based list):

  | List | Maintainer |
  |---|---|
  | Licensing | Ilona |
  | Production | Yuchen |
  | Design | Marcel |
  | Sampling | Yuchen and Ilona |
  | Shipping | Unknown (no maintainer named yet) |

- Admins may maintain every list.

**Stage order (Unknown).** The current Production order (Material Arrival first) is wrong. Material Arrival is about the fourth production step. The correct order will be set by the list maintainers on the stage-list screen. Until then, no order is Settled.

**Source of initial durations (Historical).** The first durations came from the "Order Timeline Calculator" spreadsheet, Version 1.0, updated 10/9/2024. That spreadsheet added Design, Licensing, Sampling, and Mass Production one after another. That serial model is not the business rule (see the next section).

### Licensor coverage (Settled, Albert Hazan, 2026-10-15)

- Care Bears and ZAG (Miraculous Ladybug) are no longer licensed. They carry no licensing stage times.
- Ford is kept with empty licensing stage times until its licensor portal is set up and someone enters them.
- Lenticular Art is a single product type, not two.

## Stages run concurrently, with hard and soft dependencies

**Status:** Settled that the lists are not serial (Albert Hazan, 2026-10-15). The dependency map itself is Unknown.

The five lists do not run one after another. Parts of each list run at the same time as parts of others. Some links between stages are hard dependencies: the later stage cannot start until the earlier one is done. Others are soft dependencies: the later stage normally waits, but the team can start it early to save time when it judges the risk acceptable. Adding stage durations end to end therefore overstates lead time and must not be presented as the business schedule.

Unknown, to collect stage by stage from the list maintainers:

- For each stage, which earlier stages it depends on.
- Whether each dependency is hard or soft.
- For soft dependencies, how much early start is normal and who may decide it.
- Which stages can overlap fully.

## Conditional stages

**Status:** Settled for re-sampling and re-design (Albert Hazan, 2026-10-15). Linesheet is Unknown.

- **Re-sampling and re-design** happen only when the licensor returns a Resubmit at the concept stage or the pre-production-sample stage. They are not planned on every order and do not count toward a normal lead time.
- **Linesheet submission and linesheet resubmission** (Settled, Ilona via Albert Hazan, 2026-10-15) are sometimes needed, only on retail projects, for these licensors: Disney, NBC Universal, Warner Brothers, Steal a Brain Rot, Aardman Animations, Coca-Cola, Star Wars (Lucasfilm), Marvel. The system tracks linesheets so the licensing team can follow them, but linesheet time is **never included in timeline estimates**.

### No waits between stages (Settled, Yuchen via Albert Hazan, 2026-10-15)

There is no planned waiting time between one stage and the next. Each stage's needed date follows directly from the next stage's needed date and the stage's own duration. The fixed waits currently built into DesignFlow (for example 3 days before QC, 7 days for assembly, 1 day between licensing steps) were a mistake and are Historical.

## History

Needed dates are plans. Completed-at dates and actual production events are separate facts. Recalculation of a planned schedule must not rewrite completed history.

## Implementation and evidence

DesignFlow's [Production Tracking reference](https://github.com/popcre/designflow-frontend/blob/develop/src/app/pages/prod_tracking/README.md) explains the current screen and inherited-row implementation. It must link here and must not redefine the milestone model.
