// Advance payments on the Pay screen (Dr. Yadav, 23 Oct 2026): a patient who
// paid in advance owes only what is left of the fee. Only money flagged as
// an advance is deducted — never the registration fee.

export function remainingAfterAdvance(fee: number, advancePaid: number): number {
  return Math.max(0, Math.round((Number(fee) || 0) - (Number(advancePaid) || 0)));
}

/** Advance beyond the fee, to be returned or kept as credit. */
export function advanceExcess(fee: number, advancePaid: number): number {
  return Math.max(0, Math.round((Number(advancePaid) || 0) - (Number(fee) || 0)));
}
