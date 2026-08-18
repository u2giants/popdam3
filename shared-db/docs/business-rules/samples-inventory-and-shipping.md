# Samples, inventory, shipping, and custody

**Status:** Settled

**Controlling owner decision:** Albert Hazan, 2026-08-13. The linked DesignFlow specification retains detailed acceptance criteria and implementation evidence.

## Core identities

- A **Sample** is one physical piece. It keeps the same identity while moving through locations, boxes, shipments, and factories.
- A **Group of Samples** is a set assembled for one business action. It is not automatically a shipping box.
- A **Box** is a physical shipping container and may contain samples from more than one factory when the flow permits it.
- **Inventory** means physical custody at a specific location. A request, offer, planned route, or database listing is not proof of custody.
- A **Flow** explains why the sample is moving and what the parties are expected to do.
- A **Path** is the planned ordered route. It never replaces actual custody events.
- A **Shipment** records the actual sender, recipient, carrier, tracking number, time, and contents.
- **Check-in** confirms physical receipt and automatically adds received samples to that location's inventory.

## Locations

The five location types are New York Office, Ningbo Office, a specific Factory, China Warehouse, and a specific Customer. The specific Factory or Customer must be retained, not only the broad location type.

## Four business flows

1. **NYO-owned sample sent to factories.** NYO begins with physical custody, sends through Ningbo when applicable, and maintains a sequential factory-visit plan. One physical sample cannot be at several factories at once.
2. **Factory offers an unrequested sample.** Only a Vendor user may initiate this flow and only for that Vendor's own Factory. The offering Factory remains attached even if Ningbo later consolidates several factories' samples.
3. **NYO asks a Factory to make a sample.** The request creates no inventory. Photo approval and optional QC approval are separate facts. When QC is required, both approvals must be complete before the physical sample moves forward.
4. **NYO requests samples shown in remote China inventory.** Displayed inventory is not proof of availability. Ningbo or QC must physically confirm the piece before reservation or shipment.

## Custody and quantity

Several identical physical pieces require separate piece identities or an explicit quantity model that can account for each location and movement. Never clone one physical piece merely to represent planned destinations, and never leave one undifferentiated quantity claiming to be in several places.

A sample in transit must not appear as normally available inventory at both sender and receiver. Never silently remove a sample from an active box. Corrections and route changes preserve earlier events.

## Paths and route changes

Current planned paths include Factory→Ningbo→NYO, Factory→Ningbo→Customer, Factory→NYO, NYO→Ningbo, Ningbo→NYO, NYO→Factory, Ningbo→Factory, Factory→Ningbo, and China Warehouse→Ningbo. Only paths valid for the selected Flow and role may be offered.

Actual stops, returns, reroutes, and added destinations are recorded as new events. Never rewrite history to make it resemble the revised plan.

## Shipping

The sender records the carrier and tracking number against the Shipment. One tracking number may cover every sample in one Box and must not create duplicate Shipment records. Carrier-reported delivery is different from employee check-in. Customers are destinations, not normal Sample Tracking users, so customer receipt must not be inferred from a nonexistent customer check-in.

## Remote-inventory confirmation

The system must keep these states distinct: shown in inventory, requested, awaiting physical confirmation, confirmed, unavailable/not found, reserved, boxed, shipped, and received. Every change retains actor, time, and notes.

## Roles

- NYO users initiate NYO flows, review samples, and make business decisions assigned to New York.
- Ningbo users confirm physical inventory, adjust factory visit plans, box, ship, receive, and record returns.
- Vendor users see and act only on samples assigned to their Factory and may initiate only their own Flow 2 offers.
- QC users confirm warehouse pulls and supply required physical-sample approval.
- Customers are destinations, not ordinary users in these flows.

## Validation and failure

The workflow must not guess a Flow, Path, location, Box, Factory, Customer, or physical-availability state. Batch import validates every row before committing unless the user knowingly chooses a supported partial operation. A failed multi-record action must state exactly what was and was not created.

## History and evidence

History must answer who requested, approved, shipped, received, rerouted, confirmed, rejected, or corrected each action and when. Photos remain with the Sample across Boxes and Shipments.

## Implementation and evidence

The former [DesignFlow application specification](https://github.com/popcre/designflow-frontend/blob/develop/docs/sample-tracking-restructure-spec.md) is retained as implementation evidence. It must link here and must not serve as a separate business authority.
