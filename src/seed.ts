import { addDays, monthOf } from "./domain/schedule.js";
import type { SurveyAnswers } from "./domain/scoring.js";
import type { PsaAdapter } from "./psa/types.js";
import type { Store } from "./store.js";
import { issueToken } from "./surveys/tokens.js";
import { syncFromPsa } from "./sync.js";

type Seeded = SurveyAnswers & { daysAgo: number };

/** Made-up responses so the demo dashboard has something to show. */
const RESPONSES: Record<string, Seeded[]> = {
  "Acme Dental": [
    { daysAgo: 12, overall: 4, responsiveness: 3, expertise: 5, communication: 4, recommend: 8, commentImprove: "Tickets after 4pm sometimes wait until the next morning." },
    { daysAgo: 104, overall: 5, responsiveness: 4, expertise: 5, communication: 5, recommend: 9 },
  ],
  "Beta Builders": [
    { daysAgo: 20, overall: 3, responsiveness: 2, expertise: 4, communication: 3, recommend: 6, commentImprove: "The jobsite tablets took three visits to sort out. We need faster turnaround in the field." },
    { daysAgo: 115, overall: 4, responsiveness: 4, expertise: 4, communication: 3, recommend: 7 },
  ],
  "Cedar Law Group": [
    { daysAgo: 6, overall: 5, responsiveness: 5, expertise: 5, communication: 5, recommend: 10, commentWell: "The email migration happened over a weekend and nobody noticed. That is the highest compliment I have." },
    { daysAgo: 98, overall: 5, responsiveness: 4, expertise: 5, communication: 5, recommend: 9 },
  ],
  "Delta Logistics": [
    { daysAgo: 34, overall: 4, responsiveness: 5, expertise: 4, communication: 4, recommend: 9, commentWell: "Fast response when the warehouse scanners dropped off Wi-Fi." },
  ],
  "Evergreen Veterinary": [
    { daysAgo: 45, overall: 5, responsiveness: 5, expertise: 4, communication: 5, recommend: 10, commentWell: "Patient, clear explanations for our front desk staff." },
  ],
};

export async function seedDemo(store: Store, psa: PsaAdapter, today: string): Promise<void> {
  const current = monthOf(today);
  await syncFromPsa(psa, store, [current, monthOf(current, -1), monthOf(current, -2)]);

  for (const client of store.listClients()) {
    const contact = store.surveyContact(client.id);
    const seeded = RESPONSES[client.name] ?? [];
    if (!contact) continue;

    for (const { daysAgo, ...answers } of seeded) {
      const sent = addDays(today, -daysAgo - 2);
      const tokenHash = issueToken().hash;
      store.createSurvey({ clientId: client.id, contactId: contact.id, tokenHash, sentAt: `${sent}T16:00:00.000Z`, expiresAt: `${addDays(sent, 30)}T23:59:59.999Z` });
      store.completeSurvey(tokenHash, answers, `${addDays(today, -daysAgo)}T18:30:00.000Z`);
    }
    // One unanswered survey so the response rate is realistic.
    if (client.name === "Delta Logistics") {
      const sent = addDays(today, -8);
      store.createSurvey({ clientId: client.id, contactId: contact.id, tokenHash: issueToken().hash, sentAt: `${sent}T16:00:00.000Z`, expiresAt: `${addDays(sent, 30)}T23:59:59.999Z` });
    }
    const last = seeded[0]?.daysAgo;
    store.setNextSurvey(client.id, last === undefined ? today : addDays(today, client.surveyFrequencyDays - last));
  }
}
