import { round } from "./scoring.js";

export type Contract =
  | { kind: "block"; monthlyFee: number; includedHours: number; overageRate: number }
  | { kind: "unlimited"; monthlyFee: number };

export type HealthStatus = "healthy" | "watch" | "over";

export interface ContractHealth {
  kind: Contract["kind"];
  status: HealthStatus;
  hoursUsed: number;
  includedHours: number | null;
  percentUsed: number | null;
  overageHours: number;
  overageAmount: number;
  /** What the client actually pays per hour of work this month. Null when no hours were logged. */
  effectiveRate: number | null;
  reason: string;
}

export interface HealthThresholds {
  /** Block contracts at or above this share of their hours are flagged "watch". */
  watchPercent: number;
  /** Lowest acceptable effective hourly rate on unlimited contracts. */
  targetRate: number;
  /** Unlimited contracts within this margin above the target are flagged "watch" (0.15 = 15%). */
  watchMargin: number;
}

export const DEFAULT_THRESHOLDS: HealthThresholds = { watchPercent: 85, targetRate: 125, watchMargin: 0.15 };

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Block contracts go "over" when the client uses more hours than they bought,
 * which means overage invoices and usually a conversation about a bigger block.
 * Unlimited contracts go "over" when the flat fee, spread across the hours
 * actually worked, falls below the target rate: the client costs more than they pay.
 */
export function evaluateContract(
  contract: Contract,
  hoursUsed: number,
  t: HealthThresholds = DEFAULT_THRESHOLDS,
): ContractHealth {
  const hours = round(Math.max(0, hoursUsed), 2);

  if (contract.kind === "block") {
    const percentUsed = contract.includedHours > 0 ? round((hours / contract.includedHours) * 100) : 0;
    const overageHours = round(Math.max(0, hours - contract.includedHours), 2);
    const overageAmount = round(overageHours * contract.overageRate, 2);
    const effectiveRate = hours > 0 ? round((contract.monthlyFee + overageAmount) / hours, 2) : null;
    const base = {
      kind: contract.kind,
      hoursUsed: hours,
      includedHours: contract.includedHours,
      percentUsed,
      overageHours,
      overageAmount,
      effectiveRate,
    };

    if (overageHours > 0) {
      return {
        ...base,
        status: "over",
        reason: `${overageHours} h over the ${contract.includedHours} h block (${usd(overageAmount)} overage)`,
      };
    }
    const status = percentUsed >= t.watchPercent ? "watch" : "healthy";
    return { ...base, status, reason: `${percentUsed}% of the block used` };
  }

  const effectiveRate = hours > 0 ? round(contract.monthlyFee / hours, 2) : null;
  const base = {
    kind: contract.kind,
    hoursUsed: hours,
    includedHours: null,
    percentUsed: null,
    overageHours: 0,
    overageAmount: 0,
    effectiveRate,
  };

  if (effectiveRate === null) {
    return { ...base, status: "healthy", reason: "No hours logged this month" };
  }
  const reason = `Earning ${usd(effectiveRate)}/h against a ${usd(t.targetRate)}/h target`;
  if (effectiveRate < t.targetRate) return { ...base, status: "over", reason };
  if (effectiveRate < t.targetRate * (1 + t.watchMargin)) return { ...base, status: "watch", reason };
  return { ...base, status: "healthy", reason };
}
