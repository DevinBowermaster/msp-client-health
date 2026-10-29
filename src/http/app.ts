import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import { buildDashboard } from "../dashboard.js";
import type { HealthThresholds } from "../domain/contractHealth.js";
import { addDays, monthOf, todayIn } from "../domain/schedule.js";
import { SurveyAnswersSchema } from "../domain/scoring.js";
import type { PsaAdapter } from "../psa/types.js";
import { openSurvey, sendSurvey, submitSurvey, type SurveyDeps } from "../surveys/service.js";
import { syncFromPsa } from "../sync.js";
import type { Authenticator, User } from "./auth.js";
import type { RateLimiter } from "./rateLimit.js";

export interface AppDeps {
  surveys: SurveyDeps;
  psa: PsaAdapter;
  authenticate: Authenticator;
  /** What the browser needs to start a sign-in. Never includes secrets. */
  authConfig: { mode: "oidc"; issuer: string; clientId: string; scope: string } | { mode: "demo" };
  thresholds: HealthThresholds;
  surveyLimiter: RateLimiter;
  /** Identifies the caller for rate limiting: the socket address, not a header the caller can set. */
  clientKey: (c: Context) => string;
}

type AppEnv = { Variables: { user: User } };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function createApp(deps: AppDeps) {
  const { store } = deps.surveys;
  const now = () => deps.surveys.now();
  const today = () => todayIn(deps.surveys.timezone, now());

  const app = new Hono<AppEnv>();
  app.use("*", secureHeaders());
  app.use("/api/*", bodyLimit({ maxSize: 16 * 1024 }));

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Something went wrong" }, 500);
  });

  // Public ------------------------------------------------------------------

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/auth-config", (c) => c.json(deps.authConfig));

  const limitSurveys = createMiddleware(async (c, next) => {
    if (!deps.surveyLimiter.allow(deps.clientKey(c))) return c.json({ error: "Too many requests" }, 429);
    await next();
  });

  app.get("/api/surveys/:token", limitSurveys, (c) => {
    const result = openSurvey(deps.surveys, c.req.param("token"));
    if (result.status === "open") return c.json(result);
    return c.json(result, result.status === "not_found" ? 404 : 410);
  });

  app.post("/api/surveys/:token", limitSurveys, async (c) => {
    const parsed = SurveyAnswersSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Please answer every rating question." }, 400);
    const result = submitSurvey(deps.surveys, c.req.param("token"), parsed.data);
    if (result.status === "saved") return c.json(result);
    return c.json(result, result.status === "not_found" ? 404 : 410);
  });

  // Signed in ----------------------------------------------------------------

  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const user = await deps.authenticate(c.req.header("authorization"));
    if (!user) return c.json({ error: "Sign in required" }, 401);
    c.set("user", user);
    await next();
  });

  const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
    if (!c.get("user").isAdmin) return c.json({ error: "Admin role required" }, 403);
    await next();
  });

  app.use("/api/*", requireUser);

  app.get("/api/me", (c) => c.json(c.get("user")));

  app.get("/api/dashboard", (c) => {
    const month = c.req.query("month") ?? monthOf(today());
    if (!MONTH.test(month)) return c.json({ error: "month must be YYYY-MM" }, 400);
    return c.json(buildDashboard(store, month, addDays(today(), -365), deps.thresholds));
  });

  app.get("/api/clients/:id/responses", (c) => {
    const id = Number(c.req.param("id"));
    if (!store.getClient(id)) return c.json({ error: "Client not found" }, 404);
    return c.json(store.responsesSince(addDays(today(), -365), id));
  });

  app.post("/api/clients/:id/surveys", requireAdmin, async (c) => {
    const result = await sendSurvey(deps.surveys, Number(c.req.param("id")), c.get("user").name);
    return result.ok ? c.json(result) : c.json(result, 422);
  });

  app.post("/api/sync", requireAdmin, async (c) => {
    const current = monthOf(today());
    const result = await syncFromPsa(deps.psa, store, [current, monthOf(current, -1), monthOf(current, -2)]);
    store.audit(c.get("user").name, "psa.sync", `${result.synced} synced, ${result.errors.length} errors`, now().toISOString());
    return c.json(result);
  });

  app.get("/api/audit", requireAdmin, (c) => c.json(store.listAudit()));

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  return app;
}
