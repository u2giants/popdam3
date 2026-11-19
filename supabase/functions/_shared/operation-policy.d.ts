export const OP_LANES: Record<string, string>;
export const OP_CONFLICTS: Readonly<Record<string, readonly string[]>>;
export function getOperationLane(opKey: string): string;
export function conflictsFor(opKey: string): readonly string[];
