import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { loadConfig } from "./config.js";
import { monthOf, shouldRunDaily, todayIn } from "./domain/schedule.js";
import { createApp, type AppDeps } from "./http/app.js";
import { demoAuthenticator, discoverKeys, oidcAuthenticator } from "./http/auth.js";
import { RateLimiter } from "./http/rateLimit.js";
import { ConsoleMailer, SmtpMailer } from "./mail.js";
import { MockPsa } from "./psa/mockPsa.js";
import { seedDemo } from "./seed.js";
import { Store } from "./store.js";
import { sendDueSurveys, type SurveyDeps } from "./surveys/service.js";

const config = loadConfig();
const now = () => new Date();
const today = todayIn(config.TIMEZONE, now());

if (config.DATABASE_FILE !== ":memory:") mkdirSync(dirname(config.DATABASE_FILE), { recursive: true });
const store = new Store(config.DATABASE_FILE);

// Swap MockPsa for an adapter to your PSA (see src/psa/types.ts).
const psa = new MockPsa(monthOf(today));
if (config.DEMO_DATA && store.listClients().length === 0) await seedDemo(store, psa, today);

const surveys: SurveyDeps = {
  store,
  mailer:
    config.MAIL_MODE === "smtp"
      ? new SmtpMailer(config.SMTP_URL!, config.MAIL_FROM!, config.COMPANY_NAME)
      : new ConsoleMailer(),
  publicUrl: config.PUBLIC_URL,
  ttlDays: config.SURVEY_TTL_DAYS,
  timezone: config.TIMEZONE,
  now,
};

const oidc =
  config.AUTH_MODE === "oidc"
    ? { issuer: config.OIDC_ISSUER!, audience: config.OIDC_AUDIENCE!, clientId: config.OIDC_CLIENT_ID! }
    : null;

const deps: AppDeps = {
  surveys,
  psa,
  authenticate: oidc
    ? oidcAuthenticator({
        issuer: oidc.issuer,
        audience: oidc.audience,
        getKey: await discoverKeys(oidc.issuer),
        rolesClaim: config.ROLES_CLAIM,
        adminRole: config.ADMIN_ROLE,
      })
    : demoAuthenticator(),
  authConfig: oidc ? { mode: "oidc", issuer: oidc.issuer, clientId: oidc.clientId, scope: config.OIDC_SCOPE } : { mode: "demo" },
  thresholds: { watchPercent: config.WATCH_PERCENT, targetRate: config.TARGET_HOURLY_RATE, watchMargin: 0.15 },
  surveyLimiter: new RateLimiter(30, 60_000),
  clientKey: (c) => getConnInfo(c).remote.address ?? "unknown",
};

const app = createApp(deps);
// The dashboard and survey pages are one single-page app built into dist/web.
app.use("*", serveStatic({ root: "dist/web" }));
app.get("*", serveStatic({ root: "dist/web", path: "index.html" }));

serve({ fetch: app.fetch, port: config.PORT }, ({ port }) => {
  console.log(`Client health running on http://localhost:${port} (auth: ${config.AUTH_MODE}, mail: ${config.MAIL_MODE})`);
});

// Check hourly; send once a day at or after SURVEY_SEND_HOUR in TIMEZONE.
let lastRun: string | null = null;
async function tick() {
  if (!shouldRunDaily(now(), config.TIMEZONE, config.SURVEY_SEND_HOUR, lastRun)) return;
  lastRun = todayIn(config.TIMEZONE, now());
  const result = await sendDueSurveys(surveys);
  console.log(`Daily surveys: ${result.sent} sent, ${result.failed.length} skipped`, result.failed);
}
setInterval(() => void tick().catch(console.error), 60 * 60 * 1000).unref();
void tick().catch(console.error);
