import { z } from "zod";

const Rating = z.number().int().min(1).max(5);
const Comment = z.string().trim().max(2000).optional();

/** What a client submits: four 1-5 ratings plus the standard 0-10 "would you recommend us" question. */
export const SurveyAnswersSchema = z.object({
  overall: Rating,
  responsiveness: Rating,
  expertise: Rating,
  communication: Rating,
  recommend: z.number().int().min(0).max(10),
  commentWell: Comment,
  commentImprove: Comment,
});

export type SurveyAnswers = z.infer<typeof SurveyAnswersSchema>;

export type NpsCategory = "promoter" | "passive" | "detractor";

export function round(value: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Customer satisfaction for one response: the mean of the four 1-5 ratings. */
export function csat(a: Pick<SurveyAnswers, "overall" | "responsiveness" | "expertise" | "communication">): number {
  return (a.overall + a.responsiveness + a.expertise + a.communication) / 4;
}

export function npsCategory(score: number): NpsCategory {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

/**
 * Net Promoter Score: percent promoters (9-10) minus percent detractors (0-6),
 * from -100 to 100. Averaging the raw answers is not an NPS.
 */
export function netPromoterScore(scores: number[]): number | null {
  if (scores.length === 0) return null;
  let promoters = 0;
  let detractors = 0;
  for (const s of scores) {
    const c = npsCategory(s);
    if (c === "promoter") promoters++;
    else if (c === "detractor") detractors++;
  }
  return Math.round(((promoters - detractors) / scores.length) * 100);
}
