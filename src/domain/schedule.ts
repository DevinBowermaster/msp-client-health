/** Date helpers. Dates are YYYY-MM-DD strings so they compare and store cleanly. */

export function todayIn(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

export function hourIn(timezone: string, now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(now));
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM for the month containing a YYYY-MM-DD date, shifted by `offset` months. */
export function monthOf(date: string, offset = 0): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
}

/** A client with no scheduled date has never been surveyed, so it is due. */
export function isDue(nextSurveyOn: string | null, today: string): boolean {
  return nextSurveyOn === null || nextSurveyOn <= today;
}

/** The daily send runs once per local day, at or after the configured hour. */
export function shouldRunDaily(now: Date, timezone: string, hour: number, lastRunDate: string | null): boolean {
  return hourIn(timezone, now) >= hour && lastRunDate !== todayIn(timezone, now);
}
