import { describe, expect, it } from "vitest";
import { csat, netPromoterScore, npsCategory, SurveyAnswersSchema } from "../src/domain/scoring.js";

describe("netPromoterScore", () => {
  it("is percent promoters minus percent detractors", () => {
    // 2 promoters, 1 passive, 1 detractor -> 50% - 25% = 25
    expect(netPromoterScore([10, 9, 8, 3])).toBe(25);
  });

  it("can be negative", () => {
    expect(netPromoterScore([6, 5, 9])).toBe(-33);
  });

  it("is not the average score", () => {
    // Averages to 8 out of 10, but nobody is a promoter.
    expect(netPromoterScore([8, 8, 8])).toBe(0);
  });

  it("is null with no responses", () => {
    expect(netPromoterScore([])).toBeNull();
  });
});

describe("npsCategory", () => {
  it.each([
    [10, "promoter"],
    [9, "promoter"],
    [8, "passive"],
    [7, "passive"],
    [6, "detractor"],
    [0, "detractor"],
  ] as const)("%i is a %s", (score, category) => {
    expect(npsCategory(score)).toBe(category);
  });
});

describe("csat", () => {
  it("averages the four ratings", () => {
    expect(csat({ overall: 5, responsiveness: 4, expertise: 5, communication: 2 })).toBe(4);
  });
});

describe("SurveyAnswersSchema", () => {
  const valid = { overall: 5, responsiveness: 4, expertise: 5, communication: 4, recommend: 9 };

  it("accepts a complete response and trims comments", () => {
    const parsed = SurveyAnswersSchema.parse({ ...valid, commentWell: "  quick fixes  " });
    expect(parsed.commentWell).toBe("quick fixes");
  });

  it.each([
    ["a rating of 0", { ...valid, overall: 0 }],
    ["a rating of 6", { ...valid, expertise: 6 }],
    ["a fractional rating", { ...valid, communication: 4.5 }],
    ["a recommend score of 11", { ...valid, recommend: 11 }],
    ["a missing rating", { overall: 5, responsiveness: 4, expertise: 5, recommend: 9 }],
    ["a 5,000 character comment", { ...valid, commentImprove: "x".repeat(5000) }],
  ])("rejects %s", (_, input) => {
    expect(SurveyAnswersSchema.safeParse(input).success).toBe(false);
  });
});
