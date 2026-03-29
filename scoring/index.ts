import { PaymentEvent } from "../indexer";

export interface ScoringSignals {
  paymentReliability: number;
  counterpartyDiversity: number;
  accountAge: number;
  spendConsistency: number;
  slaAdherence: number;
  activityTrend: number;
}

const WEIGHTS = {
  paymentReliability: 0.25,
  counterpartyDiversity: 0.2,
  accountAge: 0.15,
  spendConsistency: 0.15,
  slaAdherence: 0.15,
  activityTrend: 0.1,
};

/** Ratio of successful payments (non-zero, non-reverted) */
export function paymentReliability(history: PaymentEvent[]): number {
  if (history.length === 0) return 0;
  const successful = history.filter((e) => e.amount > 0n);
  return successful.length / history.length;
}

/** Number of unique counterparties, normalized (10+ = 1.0) */
export function counterpartyDiversity(history: PaymentEvent[]): number {
  if (history.length === 0) return 0;
  const unique = new Set(history.map((e) => e.to.toLowerCase()));
  return Math.min(unique.size / 10, 1);
}

/** Account age in days since first tx, normalized (365+ days = 1.0) */
export function accountAge(history: PaymentEvent[]): number {
  if (history.length === 0) return 0;
  const timestamps = history.map((e) => e.timestamp).filter((t) => t > 0);
  if (timestamps.length === 0) return 0;
  const earliest = Math.min(...timestamps);
  const now = Math.floor(Date.now() / 1000);
  const ageDays = (now - earliest) / 86400;
  return Math.min(ageDays / 365, 1);
}

/** Coefficient of variation of monthly spend, inverted (low variance = high score) */
export function spendConsistency(history: PaymentEvent[]): number {
  if (history.length < 2) return 0;

  const monthlySpend = new Map<string, number>();
  for (const e of history) {
    const date = new Date(e.timestamp * 1000);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const current = monthlySpend.get(key) || 0;
    monthlySpend.set(key, current + Number(e.amount));
  }

  const values = Array.from(monthlySpend.values());
  if (values.length < 2) return 0.5;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;

  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean;

  return Math.max(0, 1 - cv);
}

/** Fraction of payments completed within reasonable time window */
export function slaAdherence(history: PaymentEvent[]): number {
  if (history.length === 0) return 0;
  // Proxy: payments with valid timestamps and non-zero amounts indicate SLA compliance
  const compliant = history.filter((e) => e.timestamp > 0 && e.amount > 0n);
  return compliant.length / history.length;
}

/** Recent activity trend — more recent activity = higher score */
export function activityTrend(history: PaymentEvent[]): number {
  if (history.length === 0) return 0;

  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - 30 * 86400;
  const ninetyDaysAgo = now - 90 * 86400;

  const recent = history.filter((e) => e.timestamp >= thirtyDaysAgo).length;
  const older = history.filter(
    (e) => e.timestamp >= ninetyDaysAgo && e.timestamp < thirtyDaysAgo
  ).length;

  if (recent === 0 && older === 0) return 0;
  if (older === 0) return Math.min(recent / 5, 1);

  const ratio = recent / older;
  return Math.min(ratio, 1);
}

export function computeSignals(history: PaymentEvent[]): ScoringSignals {
  return {
    paymentReliability: paymentReliability(history),
    counterpartyDiversity: counterpartyDiversity(history),
    accountAge: accountAge(history),
    spendConsistency: spendConsistency(history),
    slaAdherence: slaAdherence(history),
    activityTrend: activityTrend(history),
  };
}

export function computeScore(history: PaymentEvent[]): {
  score: number;
  signals: ScoringSignals;
} {
  const signals = computeSignals(history);

  const weighted =
    signals.paymentReliability * WEIGHTS.paymentReliability +
    signals.counterpartyDiversity * WEIGHTS.counterpartyDiversity +
    signals.accountAge * WEIGHTS.accountAge +
    signals.spendConsistency * WEIGHTS.spendConsistency +
    signals.slaAdherence * WEIGHTS.slaAdherence +
    signals.activityTrend * WEIGHTS.activityTrend;

  const score = Math.round(weighted * 100);

  return { score, signals };
}
