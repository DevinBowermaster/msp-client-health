import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS } from "../src/domain/contractHealth.js";
import { createApp } from "../src/http/app.js";
import { RateLimiter } from "../src/http/rateLimit.js";
import { testIdp, type TestIdp } from "./idp.js";
import { answers, setup } from "./helpers.js";

let idp: TestIdp;
let adminToken: string;
let staffToken: string;

beforeAll(async () => {
  idp = await testIdp();
  adminToken = await idp.token({ groups: ["client-health-admins"] });
  staffToken = await idp.token({ groups: ["staff"] });
});

async function makeApp(limit = 100) {
  const ctx = await setup();
  const app = createApp({
    surveys: ctx.deps,
    psa: ctx.psa,
    authenticate: idp.authenticate,
    authConfig: { mode: "oidc", issuer: "https://idp.example.com", clientId: "spa", scope: "openid" },
    thresholds: DEFAULT_THRESHOLDS,
    surveyLimiter: new RateLimiter(limit, 60_000),
    clientKey: () => "203.0.113.7",
  });
  const call = (path: string, init: RequestInit & { token?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    if (init.body) headers.set("content-type", "application/json");
    return app.request(path, { ...init, headers });
  };
  return { ...ctx, app, call };
}

describe("authentication", () => {
  it.each(["/api/dashboard", "/api/me", "/api/audit", "/api/clients/1/responses"])("%s requires sign-in", async (path) => {
    const { call } = await makeApp();
    expect((await call(path)).status).toBe(401);
  });

  it("ignores identity headers and only trusts the verified token", async () => {
    const { call } = await makeApp();
    const res = await call("/api/audit", { headers: { "x-user-email": "admin@example.com", "x-user-role": "admin" } });
    expect(res.status).toBe(401);
  });

  it("keeps admin actions from staff", async () => {
    const { call, clientId } = await makeApp();
    expect((await call("/api/audit", { token: staffToken })).status).toBe(403);
    expect((await call(`/api/clients/${clientId("Acme Dental")}/surveys`, { method: "POST", token: staffToken })).status).toBe(403);
    expect((await call("/api/sync", { method: "POST", token: staffToken })).status).toBe(403);
  });

  it("lets staff read the dashboard", async () => {
    const { call } = await makeApp();
    expect((await call("/api/dashboard", { token: staffToken })).status).toBe(200);
  });

  it("returns 404 rather than 401 only for public routes", async () => {
    const { call } = await makeApp();
    expect((await call("/api/nope")).status).toBe(401);
    expect((await call("/api/nope", { token: staffToken })).status).toBe(404);
  });
});

describe("dashboard", () => {
  it("summarizes satisfaction and contract health per client", async () => {
    const { call } = await makeApp();
    const body = await (await call("/api/dashboard?month=2026-10", { token: staffToken })).json();

    const byName = Object.fromEntries(body.clients.map((c: { name: string }) => [c.name, c]));
    expect(byName["Acme Dental"].contract).toMatchObject({ status: "over", overageAmount: 412.5 });
    expect(byName["Beta Builders"].contract).toMatchObject({ status: "over", effectiveRate: 92.31 });
    expect(byName["Delta Logistics"].contract.status).toBe("watch");
    expect(byName["Cedar Law Group"].flags).toEqual([]);
    expect(body.kpis.atRisk).toBe(2);
  });

  it("validates the month", async () => {
    const { call } = await makeApp();
    expect((await call("/api/dashboard?month=2026-13", { token: staffToken })).status).toBe(400);
  });
});

describe("the survey round trip", () => {
  it("an admin sends, the client answers, and the dashboard updates", async () => {
    const { call, mailer, clientId } = await makeApp();
    const sent = await call(`/api/clients/${clientId("Acme Dental")}/surveys`, { method: "POST", token: adminToken });
    expect(await sent.json()).toEqual({ ok: true, sentTo: "priya@acme-dental.example" });

    const token = mailer.lastToken();
    expect(await (await call(`/api/surveys/${token}`)).json()).toMatchObject({ status: "open", clientName: "Acme Dental" });

    const submit = await call(`/api/surveys/${token}`, { method: "POST", body: JSON.stringify({ ...answers, recommend: 4 }) });
    expect(submit.status).toBe(200);

    const again = await call(`/api/surveys/${token}`, { method: "POST", body: JSON.stringify(answers) });
    expect(again.status).toBe(410);

    const dash = await (await call("/api/dashboard", { token: staffToken })).json();
    const acme = dash.clients.find((c: { name: string }) => c.name === "Acme Dental");
    expect(acme).toMatchObject({ csat: 4.5, nps: -100, responses: 1 });
    expect(acme.flags).toContain("Last response a detractor (4/10)");
  });

  it("rejects incomplete answers", async () => {
    const { call, deps, clientId, mailer } = await makeApp();
    await call(`/api/clients/${clientId("Acme Dental")}/surveys`, { method: "POST", token: adminToken });
    const res = await call(`/api/surveys/${mailer.lastToken()}`, { method: "POST", body: JSON.stringify({ overall: 5 }) });
    expect(res.status).toBe(400);
    expect(deps.store.responsesSince("2000-01-01")).toHaveLength(0);
  });

  it("rate-limits the public survey endpoints", async () => {
    const { call } = await makeApp(3);
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await call(`/api/surveys/${"A".repeat(43)}`)).status);
    expect(statuses).toEqual([404, 404, 404, 429, 429]);
  });

  it("sets security headers", async () => {
    const { call } = await makeApp();
    const res = await call("/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});

describe("sync", () => {
  it("is audited", async () => {
    const { call } = await makeApp();
    const res = await call("/api/sync", { method: "POST", token: adminToken });
    expect(await res.json()).toEqual({ synced: 6, errors: [] });
    const audit = await (await call("/api/audit", { token: adminToken })).json();
    expect(audit[0]).toMatchObject({ actor: "Jordan Tech", action: "psa.sync" });
  });
});
