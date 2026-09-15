import { APP_MODEL } from "./domain";

export type CostCategory = "model" | "infrastructure" | "testing" | "contingency";
export interface CostReservation {
  id: string; category: CostCategory; caseId?: string; attemptId: string; maxUsd: number;
  status: "reserved" | "unknown" | "settled" | "released"; actualUsd?: number;
  createdAt: number; model?: typeof APP_MODEL;
  releaseEvidenceRef?: string;
}
export interface BudgetLedger {
  ceilingUsd: number; discretionaryCeilingUsd: number;
  allocations: Record<CostCategory, number>; reservations: CostReservation[];
}
export function createBudgetLedger(): BudgetLedger {
  return { ceilingUsd: 100, discretionaryCeilingUsd: 90, allocations: { model: 40, infrastructure: 35, testing: 15, contingency: 10 }, reservations: [] };
}
// Sum integer microdollars so rounding never admits a charge above a bound.
function micros(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) throw new Error("unknown_or_invalid_cost");
  return Math.ceil(usd * 1_000_000 - 1e-8);
}
function committed(reservation: CostReservation): number {
  return reservation.status === "released" ? 0 : micros(reservation.status === "settled" ? reservation.actualUsd ?? reservation.maxUsd : reservation.maxUsd);
}
export function budgetTotals(ledger: BudgetLedger): { spentUsd: number; reservedUsd: number; committedUsd: number; warnings: number[] } {
  const spent = ledger.reservations.filter((r) => r.status === "settled").reduce((sum, r) => sum + committed(r), 0);
  const reserved = ledger.reservations.filter((r) => r.status === "reserved" || r.status === "unknown").reduce((sum, r) => sum + committed(r), 0);
  return { spentUsd: spent / 1_000_000, reservedUsd: reserved / 1_000_000, committedUsd: (spent + reserved) / 1_000_000, warnings: [50, 75].filter((threshold) => spent + reserved >= threshold * 1_000_000) };
}
export interface CostRequest {
  id: string; attemptId: string; category: CostCategory; maxUsd: number | null;
  discretionary: boolean; now: number; pricingVerified: boolean;
  caseId?: string; caseKind?: "engineering" | "engagement"; model?: string;
}
export function reserveCost(ledger: BudgetLedger, request: CostRequest): { allowed: boolean; reason?: string; ledger: BudgetLedger; reservation?: CostReservation; duplicate: boolean } {
  const reject = (reason: string) => ({ allowed: false, reason, ledger, duplicate: false });
  const previous = ledger.reservations.find((item) => item.id === request.id);
  if (previous) {
    if (previous.attemptId !== request.attemptId || previous.category !== request.category || previous.caseId !== request.caseId || previous.maxUsd !== request.maxUsd || previous.model !== request.model) return reject("reservation_id_conflict");
    return { allowed: previous.status === "reserved", ledger, reservation: previous, duplicate: true };
  }
  if (request.maxUsd === null || !request.pricingVerified || !Number.isFinite(request.maxUsd) || request.maxUsd < 0) return reject("unknown_price_or_usage_bound");
  if (request.category === "model" && request.model !== APP_MODEL) return reject("model_not_approved");
  if (ledger.ceilingUsd > 100 || ledger.discretionaryCeilingUsd > 90 || Object.values(ledger.allocations).reduce((a,b) => a+b,0) > 100) return reject("invalid_budget_configuration");
  const amount = micros(request.maxUsd), total = ledger.reservations.reduce((sum, r) => sum + committed(r), 0);
  if (total + amount > micros(ledger.ceilingUsd)) return reject("project_budget_exhausted");
  if (request.discretionary && (total >= micros(ledger.discretionaryCeilingUsd) || total + amount > micros(ledger.discretionaryCeilingUsd))) return reject("contingency_preserved");
  const category = ledger.reservations.filter((r) => r.category === request.category).reduce((sum, r) => sum + committed(r), 0);
  if (category + amount > micros(ledger.allocations[request.category])) return reject("category_budget_exhausted");
  if (request.category === "model") {
    if (!request.caseId || !request.caseKind) return reject("model_case_budget_required");
    const caseTotal = ledger.reservations.filter((r) => r.category === "model" && r.caseId === request.caseId).reduce((sum, r) => sum + committed(r), 0);
    if (caseTotal + amount > micros(request.caseKind === "engagement" ? 0.05 : 1)) return reject("case_budget_exhausted");
  }
  const reservation: CostReservation = { id: request.id, attemptId: request.attemptId, category: request.category, maxUsd: amount / 1_000_000, status: "reserved", createdAt: request.now,
    ...(request.caseId ? { caseId: request.caseId } : {}), ...(request.model ? { model: request.model as typeof APP_MODEL } : {}) };
  return { allowed: true, ledger: { ...ledger, reservations: [...ledger.reservations, reservation] }, reservation, duplicate: false };
}
export function settleCost(ledger: BudgetLedger, id: string, outcome: { status: "unknown" } | { status: "settled"; actualUsd: number } | { status: "definitely_not_incurred"; evidenceRef: string }): BudgetLedger {
  const reservation = ledger.reservations.find((r) => r.id === id);
  if (!reservation) throw new Error("missing_cost_reservation");
  if (reservation.status === "settled" || reservation.status === "released") {
    if (outcome.status === "settled" && reservation.status === "settled" && micros(outcome.actualUsd) === micros(reservation.actualUsd ?? reservation.maxUsd)) return ledger;
    if (outcome.status === "definitely_not_incurred" && reservation.status === "released") return ledger;
    throw new Error("cost_already_reconciled");
  }
  if (outcome.status === "definitely_not_incurred" && !outcome.evidenceRef.trim()) throw new Error("cost_release_evidence_required");
  if (outcome.status === "settled" && micros(outcome.actualUsd) > micros(reservation.maxUsd)) throw new Error("actual_cost_exceeded_reserved_bound_pause_and_reconcile");
  const updated: CostReservation = outcome.status === "unknown" ? { ...reservation, status: "unknown" }
    : outcome.status === "settled" ? { ...reservation, status: "settled", actualUsd: micros(outcome.actualUsd) / 1_000_000 }
    : { ...reservation, status: "released", actualUsd: 0, releaseEvidenceRef: outcome.evidenceRef };
  return { ...ledger, reservations: ledger.reservations.map((r) => r.id === id ? updated : r) };
}
export function maximumModelCharge(input: { inputTokenBound: number; outputTokenCeiling: number; inputUsdPerMillion: number; outputUsdPerMillion: number; pricingVerifiedAt: number; now: number }): number {
  if (!Number.isInteger(input.inputTokenBound) || !Number.isInteger(input.outputTokenCeiling) || input.inputTokenBound < 0 || input.outputTokenCeiling < 1 || input.pricingVerifiedAt > input.now || input.now - input.pricingVerifiedAt > 86_400_000) throw new Error("verified_price_and_token_bounds_required");
  micros(input.inputUsdPerMillion); micros(input.outputUsdPerMillion);
  return micros((input.inputTokenBound * input.inputUsdPerMillion + input.outputTokenCeiling * input.outputUsdPerMillion) / 1_000_000) / 1_000_000;
}
export function retryDelayMs(input: { attempt: number; errorClass: "transient" | "invalid_output" | "permanent" | "effect_unknown"; retryAfterMs?: number; random: number }): number | null {
  if (input.errorClass === "permanent" || input.errorClass === "effect_unknown") return null;
  if (input.attempt >= (input.errorClass === "invalid_output" ? 2 : 3)) return null;
  return Math.max(input.retryAfterMs ?? 0, Math.round(1000 * 2 ** Math.max(0, input.attempt - 1) * (0.75 + Math.min(1, Math.max(0, input.random)) * 0.5)));
}
