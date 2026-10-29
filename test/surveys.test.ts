import { describe, expect, it } from "vitest";
import { openSurvey, sendDueSurveys, sendSurvey, submitSurvey } from "../src/surveys/service.js";
import { hashToken } from "../src/surveys/tokens.js";
import { answers, setup } from "./helpers.js";

describe("sendSurvey", () => {
  it("emails a one-time link to the primary contact and schedules the next survey", async () => {
    const { deps, mailer, store, clientId } = await setup();
    const id = clientId("Beta Builders");

    const result = await sendSurvey(deps, id, "Pat");

    expect(result).toEqual({ ok: true, sentTo: "dana@betabuilders.example" });
    expect(mailer.sent[0]).toMatchObject({ clientName: "Beta Builders", expiresOn: "2026-11-27" });
    expect(mailer.sent[0]!.link).toMatch(/^https:\/\/health\.example\.com\/survey\/[A-Za-z0-9_-]{43}$/);
    expect(store.getClient(id)!.nextSurveyOn).toBe("2027-01-26");
    expect(store.listAudit()[0]).toMatchObject({ actor: "Pat", action: "survey.sent" });
  });

  it("stores only a hash of the token", async () => {
    const { deps, mailer, store, clientId } = await setup();
    await sendSurvey(deps, clientId("Acme Dental"), "Pat");
    const token = mailer.lastToken();

    expect(store.findSurvey(token)).toBeUndefined();
    expect(store.findSurvey(hashToken(token))).toBeDefined();
  });

  it("explains why a client without an email cannot be surveyed", async () => {
    const { deps, mailer, clientId } = await setup();
    const result = await sendSurvey(deps, clientId("Falcon Machining"), "Pat");
    expect(result).toEqual({ ok: false, reason: "Falcon Machining has no contact with an email address" });
    expect(mailer.sent).toHaveLength(0);
  });

  it("removes the survey if the email fails, so it is not counted as unanswered", async () => {
    const { deps, mailer, store, clientId } = await setup();
    mailer.sendSurvey.mockRejectedValueOnce(new Error("SMTP down"));

    await expect(sendSurvey(deps, clientId("Acme Dental"), "Pat")).rejects.toThrow("SMTP down");
    expect(store.surveyCountsSince("2000-01-01").sent).toBe(0);
    expect(store.getClient(clientId("Acme Dental"))!.nextSurveyOn).toBeNull();
  });
});

describe("sendDueSurveys", () => {
  it("sends every due survey and reports the ones it skipped", async () => {
    const { deps, store, clientId } = await setup();
    store.setNextSurvey(clientId("Cedar Law Group"), "2026-12-01");

    const result = await sendDueSurveys(deps);

    expect(result.sent).toBe(4);
    expect(result.failed).toEqual([{ client: "Falcon Machining", reason: "Falcon Machining has no contact with an email address" }]);
    expect((await sendDueSurveys(deps)).sent).toBe(0);
  });
});

describe("responding", () => {
  it("accepts one response per link", async () => {
    const { deps, mailer, clientId } = await setup();
    await sendSurvey(deps, clientId("Acme Dental"), "Pat");
    const token = mailer.lastToken();

    expect(openSurvey(deps, token)).toEqual({ status: "open", clientName: "Acme Dental", contactName: "Priya Shah" });
    expect(submitSurvey(deps, token, answers)).toEqual({ status: "saved" });
    expect(submitSurvey(deps, token, answers)).toEqual({ status: "completed" });
    expect(openSurvey(deps, token)).toEqual({ status: "completed" });
  });

  it("rejects an expired link", async () => {
    const { deps, mailer, clientId, setClock } = await setup();
    await sendSurvey(deps, clientId("Acme Dental"), "Pat");
    setClock(new Date("2026-11-28T08:00:00Z"));

    expect(submitSurvey(deps, mailer.lastToken(), answers)).toEqual({ status: "expired" });
  });

  it("treats unknown and malformed tokens the same way", async () => {
    const { deps } = await setup();
    expect(openSurvey(deps, "A".repeat(43))).toEqual({ status: "not_found" });
    expect(openSurvey(deps, "../../etc/passwd")).toEqual({ status: "not_found" });
  });
});
