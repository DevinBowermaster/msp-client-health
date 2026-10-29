import { vi } from "vitest";
import type { SurveyEmail } from "../src/mail.js";
import { MockPsa } from "../src/psa/mockPsa.js";
import { Store } from "../src/store.js";
import type { SurveyDeps } from "../src/surveys/service.js";
import { syncFromPsa } from "../src/sync.js";

/** 2026-10-28 at noon in Boise. */
export const NOW = new Date("2026-10-28T18:00:00Z");
export const MONTH = "2026-10";

export const answers = {
  overall: 5,
  responsiveness: 4,
  expertise: 5,
  communication: 4,
  recommend: 9,
};

export class CapturingMailer {
  sent: SurveyEmail[] = [];
  sendSurvey = vi.fn(async (e: SurveyEmail) => {
    this.sent.push(e);
  });

  /** The token from the most recent link. */
  lastToken(): string {
    const link = this.sent.at(-1)?.link;
    if (!link) throw new Error("no survey sent");
    return link.split("/survey/")[1]!;
  }
}

export async function setup(opts: { now?: () => Date } = {}) {
  const store = new Store();
  const psa = new MockPsa(MONTH);
  await syncFromPsa(psa, store, [MONTH, "2026-09", "2026-08"]);
  const mailer = new CapturingMailer();
  let clock = NOW;
  const deps: SurveyDeps = {
    store,
    mailer,
    publicUrl: "https://health.example.com/",
    ttlDays: 30,
    timezone: "America/Boise",
    now: opts.now ?? (() => clock),
  };
  const clientId = (name: string) => store.listClients().find((c) => c.name === name)!.id;
  const setClock = (d: Date) => {
    clock = d;
  };
  return { store, psa, mailer, deps, clientId, setClock };
}
