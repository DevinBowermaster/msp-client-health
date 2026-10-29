import { describe, expect, it } from "vitest";
import { addDays, isDue, monthOf, shouldRunDaily, todayIn } from "../src/domain/schedule.js";

describe("dates", () => {
  it("uses the team's time zone, not UTC", () => {
    const lateEvening = new Date("2026-10-29T03:00:00Z"); // 9pm Oct 28 in Boise
    expect(todayIn("America/Boise", lateEvening)).toBe("2026-10-28");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-20", 90)).toBe("2027-03-20");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("shifts months across a year end", () => {
    expect(monthOf("2026-01-15", -2)).toBe("2025-11");
  });

  it("treats a never-surveyed client as due", () => {
    expect(isDue(null, "2026-10-28")).toBe(true);
    expect(isDue("2026-10-28", "2026-10-28")).toBe(true);
    expect(isDue("2026-10-29", "2026-10-28")).toBe(false);
  });
});

describe("shouldRunDaily", () => {
  const tz = "America/Boise";
  const at = (iso: string) => new Date(iso);

  it("waits until the send hour", () => {
    expect(shouldRunDaily(at("2026-10-28T14:00:00Z"), tz, 9, null)).toBe(false); // 8am local
    expect(shouldRunDaily(at("2026-10-28T15:00:00Z"), tz, 9, null)).toBe(true); // 9am local
  });

  it("runs once per local day", () => {
    expect(shouldRunDaily(at("2026-10-28T20:00:00Z"), tz, 9, "2026-10-28")).toBe(false);
    expect(shouldRunDaily(at("2026-10-29T16:00:00Z"), tz, 9, "2026-10-28")).toBe(true);
  });
});
