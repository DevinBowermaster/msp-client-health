import { describe, expect, it } from "vitest";
import { evaluateContract } from "../src/domain/contractHealth.js";

const t = { watchPercent: 85, targetRate: 125, watchMargin: 0.15 };
const block = { kind: "block" as const, monthlyFee: 1800, includedHours: 12, overageRate: 165 };
const unlimited = { kind: "unlimited" as const, monthlyFee: 2400 };

describe("block hours contracts", () => {
  it("prices the overage when the block is exceeded", () => {
    const h = evaluateContract(block, 14.5, t);
    expect(h).toMatchObject({ status: "over", overageHours: 2.5, overageAmount: 412.5, percentUsed: 120.8 });
    expect(h.reason).toBe("2.5 h over the 12 h block ($413 overage)");
  });

  it("includes the overage in the effective rate", () => {
    // (1800 + 412.50) / 14.5 h
    expect(evaluateContract(block, 14.5, t).effectiveRate).toBe(152.59);
  });

  it("watches a block that is nearly used up", () => {
    expect(evaluateContract(block, 10.5, t)).toMatchObject({ status: "watch", overageAmount: 0 });
  });

  it("is healthy under the threshold", () => {
    expect(evaluateContract(block, 6, t)).toMatchObject({ status: "healthy", percentUsed: 50, effectiveRate: 300 });
  });

  it("treats exactly the block as fully used but not over", () => {
    expect(evaluateContract(block, 12, t)).toMatchObject({ status: "watch", overageHours: 0 });
  });
});

describe("unlimited contracts", () => {
  it("flags a client whose flat fee works out below the target rate", () => {
    const h = evaluateContract(unlimited, 26, t);
    expect(h).toMatchObject({ status: "over", effectiveRate: 92.31 });
    expect(h.reason).toBe("Earning $92/h against a $125/h target");
  });

  it("watches a rate just above the target", () => {
    // 2400 / 18 = 133.33, within 15% of 125
    expect(evaluateContract(unlimited, 18, t).status).toBe("watch");
  });

  it("is healthy well above the target", () => {
    expect(evaluateContract(unlimited, 10, t)).toMatchObject({ status: "healthy", effectiveRate: 240 });
  });

  it("has no rate when no hours were logged", () => {
    expect(evaluateContract(unlimited, 0, t)).toMatchObject({ status: "healthy", effectiveRate: null });
  });
});
