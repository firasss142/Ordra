export type RepeatKind = "none" | "repeat" | "likely" | "risk";

export interface OutcomeBreakdown {
  delivered: number;
  returned: number;
  rejected: number;
}

export interface ClassifyInput {
  priorOrderCount: number;
  priorLeadCount: number;
  phoneMatched: boolean;
  outcomes: OutcomeBreakdown;
}

const RISK_MIN_ORDERS = 2;
const RISK_REJECTION_RATIO = 0.5;

export function normalizeIdentity(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function computeRiskRatio(o: OutcomeBreakdown): number {
  const terminal = o.delivered + o.returned + o.rejected;
  if (terminal === 0) return 0;
  return o.rejected / terminal;
}

export function classifyRepeatKind(input: ClassifyInput): RepeatKind {
  const { priorOrderCount, priorLeadCount, phoneMatched, outcomes } = input;

  if (priorOrderCount === 0 && priorLeadCount === 0) return "none";

  if (
    priorOrderCount >= RISK_MIN_ORDERS &&
    computeRiskRatio(outcomes) >= RISK_REJECTION_RATIO
  ) {
    return "risk";
  }

  if (priorOrderCount === 0) return "likely";

  return phoneMatched ? "repeat" : "likely";
}
