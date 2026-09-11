// A "scope" is one request identity: endpoint plus, for production history, the stage.
//
// /prodHistory MUST be fetched once per stage. A stage-less request returns only ISS
// rows while INTRAN and REC rows exist, with no error and a plausible total, so an
// unscoped pull is a DIFFERENT and incomplete window, not a cheaper one.
// /orderHistory has no stage dimension at all; a stage recorded there is invented and
// the database refuses it.

export const COMPANY_CODE = "EDGEHOME";
export const PROD_STAGES = Object.freeze(["ISS", "INTRAN", "REC"]);
export const EXCLUDED_DIVISION = "EP001";
export const PAGE_SIZE = 200;

export const ORDER_HISTORY = Object.freeze({ endpoint: "/orderHistory", stage: null });

export function prodHistoryScope(stage) {
  if (!PROD_STAGES.includes(stage)) {
    throw new Error(`unknown production stage ${stage}`);
  }
  return Object.freeze({ endpoint: "/prodHistory", stage });
}

/** Every scope one window must be fetched at, in a stable order. */
export function allScopes() {
  return [ORDER_HISTORY, ...PROD_STAGES.map(prodHistoryScope)];
}

export function scopeLabel(scope) {
  return scope.stage ? `${scope.endpoint} ${scope.stage}` : scope.endpoint;
}
