export const ERP_MG_CUTOFF = "2025-05-14";

export function isLegacyErpItem(erpUpdatedAt: string | null | undefined): boolean {
  return typeof erpUpdatedAt === "string" && erpUpdatedAt < ERP_MG_CUTOFF;
}
