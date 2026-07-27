export const APPROVED_BATCH = {
  id: "batch-01-exact-existing",
  sha256: "f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e",
  rowCount: 51,
  activeFileCount: 44_331,
  approvedBy: "Albert Hazan",
  approvedOn: "2026-07-27",
} as const;

export const FROZEN_PROPOSAL_SHA256 =
  "cc036567653c69801b089fae1443f4323321ec9dc3f7d874e4ee80f8e11347d4";
export const AT_RISK_EVIDENCE_SHA256 =
  "f3274213ad55c983e12f174bffc9cc693772f11d578a2ae78e4f99b4a5bf03b6";
export const AT_RISK_RELATIONSHIP_COUNT = 6_961;
const SIGNED_BATCH_KEY_SET = new Set<string>(PSG2_SIGNED_BATCH_KEYS);

export type ReconciliationRole = "viewer" | "designer" | "administrator";
export type ReconciliationQueue =
  | "needs_review"
  | "intentionally_untagged"
  | "mapped"
  | "create_approval_required"
  | "licensor_unresolved";
export type ProposalDisposition =
  | "exact_existing"
  | "alias_existing"
  | "classics_cp"
  | "non_property"
  | "licensed_no_code"
  | "canonical_create_candidate"
  | "ambiguous"
  | "deferred"
  | "licensor_unresolved";

export interface RepresentativeExample {
  path: string;
  filename: string;
}

export interface ReconciliationRow {
  observationKey: string;
  batchId: string;
  licensorId: string | null;
  licensorName: string;
  observedValue: string;
  activeFileCount: number;
  disposition: ProposalDisposition;
  rationaleCode: string;
  targetPropertyId: string | null;
  targetPropertyCode: string | null;
  targetPropertyName: string | null;
  targetPropertyStatus: string | null;
  targetPropertyParentLicensorId: string | null;
  currentlyTaggedAtRisk: boolean;
  ambiguity: boolean;
  representativeExamples: readonly RepresentativeExample[];
}

export interface PendingProposal {
  observationKey: string;
  batchId: typeof APPROVED_BATCH.id;
  ownerBatchSha256: typeof APPROVED_BATCH.sha256;
  disposition: "exact_existing";
  licensorId: string;
  targetPropertyId: string;
  targetPropertyParentLicensorId: string;
  activeFileCount: number;
  note: string;
  state: "pending";
}

export function queueForDisposition(disposition: ProposalDisposition): ReconciliationQueue {
  if (["exact_existing", "alias_existing", "classics_cp"].includes(disposition)) return "mapped";
  if (["non_property", "licensed_no_code"].includes(disposition)) return "intentionally_untagged";
  if (disposition === "canonical_create_candidate") return "create_approval_required";
  if (disposition === "licensor_unresolved") return "licensor_unresolved";
  return "needs_review";
}

export function isEffectivelyAmbiguous(row: ReconciliationRow): boolean {
  return row.disposition === "ambiguous" || row.ambiguity;
}

export function canPreparePending(role: ReconciliationRole, row: ReconciliationRow): boolean {
  return (
    role === "administrator" &&
    row.batchId === APPROVED_BATCH.id &&
    SIGNED_BATCH_KEY_SET.has(row.observationKey) &&
    row.disposition === "exact_existing" &&
    !!row.licensorId &&
    !!row.targetPropertyId &&
    row.targetPropertyParentLicensorId === row.licensorId &&
    !row.currentlyTaggedAtRisk
  );
}

export function preparePendingProposal(
  role: ReconciliationRole,
  row: ReconciliationRow,
  note = "",
): PendingProposal {
  if (!canPreparePending(role, row)) {
    throw new Error("This role or row is not allowed to prepare a pending proposal.");
  }
  return {
    observationKey: row.observationKey,
    batchId: APPROVED_BATCH.id,
    ownerBatchSha256: APPROVED_BATCH.sha256,
    disposition: "exact_existing",
    licensorId: row.licensorId!,
    targetPropertyId: row.targetPropertyId!,
    targetPropertyParentLicensorId: row.targetPropertyParentLicensorId!,
    activeFileCount: row.activeFileCount,
    note: note.trim(),
    state: "pending",
  };
}

export function assertPendingSetCanAdd(
  current: readonly PendingProposal[],
  next: PendingProposal,
): void {
  const first = current[0];
  if (!first) return;
  if (first.licensorId !== next.licensorId) {
    throw new Error("Clear the pending set before preparing a different Licensor.");
  }
  if (first.disposition !== next.disposition) {
    throw new Error("Clear the pending set before preparing a different disposition.");
  }
}

export function assertValidPendingSet(proposals: readonly PendingProposal[]): void {
  for (const proposal of proposals) {
    if (
      proposal.batchId !== APPROVED_BATCH.id ||
      proposal.ownerBatchSha256 !== APPROVED_BATCH.sha256 ||
      !SIGNED_BATCH_KEY_SET.has(proposal.observationKey) ||
      proposal.state !== "pending" ||
      proposal.licensorId !== proposal.targetPropertyParentLicensorId
    ) {
      throw new Error("The pending set failed its signed same-parent contract.");
    }
    assertPendingSetCanAdd(proposals.slice(0, 1), proposal);
  }
}

export function stableDecisionExport(proposals: readonly PendingProposal[]): string {
  assertValidPendingSet(proposals);
  const sorted = [...proposals].sort((a, b) => a.observationKey.localeCompare(b.observationKey));
  return `${JSON.stringify(
    {
      phase: "PSG-3",
      contract: "safe-non-writing-fixture-v1",
      approvedBatch: APPROVED_BATCH,
      frozenProposalSha256: FROZEN_PROPOSAL_SHA256,
      activationAvailable: false,
      proposals: sorted,
    },
    null,
    2,
  )}\n`;
}

export async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
import { PSG2_SIGNED_BATCH_KEYS } from "./generated-psg2-fixture";
