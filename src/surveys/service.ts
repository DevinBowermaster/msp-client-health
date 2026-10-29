import { addDays, todayIn } from "../domain/schedule.js";
import type { SurveyAnswers } from "../domain/scoring.js";
import type { Mailer } from "../mail.js";
import type { Store } from "../store.js";
import { hashToken, isWellFormedToken, issueToken } from "./tokens.js";

export interface SurveyDeps {
  store: Store;
  mailer: Mailer;
  /** Base URL clients open, e.g. https://health.example.com */
  publicUrl: string;
  ttlDays: number;
  timezone: string;
  now: () => Date;
}

export type SendResult = { ok: true; sentTo: string } | { ok: false; reason: string };

/** Emails a one-time survey link to the client's survey contact and schedules the next one. */
export async function sendSurvey(deps: SurveyDeps, clientId: number, actor: string): Promise<SendResult> {
  const { store } = deps;
  const client = store.getClient(clientId);
  if (!client) return { ok: false, reason: "Client not found" };
  const contact = store.surveyContact(clientId);
  if (!contact?.email) return { ok: false, reason: `${client.name} has no contact with an email address` };

  const now = deps.now();
  const today = todayIn(deps.timezone, now);
  const expiresOn = addDays(today, deps.ttlDays);
  const { token, hash } = issueToken();

  const surveyId = store.createSurvey({
    clientId,
    contactId: contact.id,
    tokenHash: hash,
    sentAt: now.toISOString(),
    expiresAt: `${expiresOn}T23:59:59.999Z`,
  });

  try {
    await deps.mailer.sendSurvey({
      to: { name: contact.name, email: contact.email },
      clientName: client.name,
      link: `${deps.publicUrl.replace(/\/$/, "")}/survey/${token}`,
      expiresOn,
    });
  } catch (err) {
    // No email went out, so no one can use this survey. Remove it rather than count it as unanswered.
    store.deleteSurvey(surveyId);
    throw err;
  }

  store.setNextSurvey(clientId, addDays(today, client.surveyFrequencyDays));
  store.audit(actor, "survey.sent", `${client.name} -> ${contact.email}`, now.toISOString());
  return { ok: true, sentTo: contact.email };
}

/** Sends every survey that is due today. One client's failure does not stop the rest. */
export async function sendDueSurveys(deps: SurveyDeps): Promise<{ sent: number; failed: { client: string; reason: string }[] }> {
  const today = todayIn(deps.timezone, deps.now());
  let sent = 0;
  const failed: { client: string; reason: string }[] = [];

  for (const client of deps.store.dueClients(today)) {
    try {
      const result = await sendSurvey(deps, client.id, "scheduler");
      if (result.ok) sent++;
      else failed.push({ client: client.name, reason: result.reason });
    } catch (err) {
      failed.push({ client: client.name, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { sent, failed };
}

export type OpenResult =
  | { status: "open"; clientName: string; contactName: string }
  | { status: "not_found" | "expired" | "completed" };

export function openSurvey(deps: Pick<SurveyDeps, "store" | "now">, token: string): OpenResult {
  if (!isWellFormedToken(token)) return { status: "not_found" };
  const survey = deps.store.findSurvey(hashToken(token));
  if (!survey) return { status: "not_found" };
  if (survey.completedAt) return { status: "completed" };
  if (survey.expiresAt <= deps.now().toISOString()) return { status: "expired" };
  return { status: "open", clientName: survey.clientName, contactName: survey.contactName };
}

export type SubmitResult = { status: "saved" } | { status: "not_found" | "expired" | "completed" };

export function submitSurvey(deps: Pick<SurveyDeps, "store" | "now">, token: string, answers: SurveyAnswers): SubmitResult {
  const state = openSurvey(deps, token);
  if (state.status !== "open") return state;
  const saved = deps.store.completeSurvey(hashToken(token), answers, deps.now().toISOString());
  // Lost a race with another submission or the expiry: report it the same way a fresh check would.
  return saved ? { status: "saved" } : { status: "completed" };
}
