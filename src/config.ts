import { z } from "zod";

const EnvSchema = z
  .object({
    NODE_ENV: z.string().default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_FILE: z.string().default("data/client-health.db"),
    PUBLIC_URL: z.url().default("http://localhost:3000"),
    COMPANY_NAME: z.string().default("Your IT Team"),
    TIMEZONE: z.string().default("America/Boise"),

    SURVEY_SEND_HOUR: z.coerce.number().int().min(0).max(23).default(9),
    SURVEY_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    TARGET_HOURLY_RATE: z.coerce.number().positive().default(125),
    WATCH_PERCENT: z.coerce.number().min(1).max(100).default(85),

    AUTH_MODE: z.enum(["oidc", "demo"]).default("oidc"),
    OIDC_ISSUER: z.url().optional(),
    OIDC_AUDIENCE: z.string().optional(),
    OIDC_CLIENT_ID: z.string().optional(),
    OIDC_SCOPE: z.string().default("openid profile email"),
    ROLES_CLAIM: z.string().default("groups"),
    ADMIN_ROLE: z.string().default("client-health-admins"),

    MAIL_MODE: z.enum(["smtp", "console"]).default("smtp"),
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().optional(),

    DEMO_DATA: z.stringbool().default(false),
  })
  .superRefine((env, ctx) => {
    const require = (key: keyof typeof env, why: string) => {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `required ${why}` });
    };
    if (env.AUTH_MODE === "oidc") {
      require("OIDC_ISSUER", "when AUTH_MODE=oidc");
      require("OIDC_AUDIENCE", "when AUTH_MODE=oidc");
      require("OIDC_CLIENT_ID", "when AUTH_MODE=oidc");
    }
    if (env.MAIL_MODE === "smtp") {
      require("SMTP_URL", "when MAIL_MODE=smtp");
      require("MAIL_FROM", "when MAIL_MODE=smtp");
    }
    if (env.NODE_ENV === "production") {
      for (const [key, value] of [["AUTH_MODE", "demo"], ["MAIL_MODE", "console"]] as const) {
        if (env[key] === value) {
          ctx.addIssue({ code: "custom", path: [key], message: `${key}=${value} is for local demos and is refused in production` });
        }
      }
      if (env.DEMO_DATA) ctx.addIssue({ code: "custom", path: ["DEMO_DATA"], message: "demo data is refused in production" });
    }
  });

export type Config = z.infer<typeof EnvSchema>;

/** Fails fast at startup with a readable message instead of failing on the first request. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${issues.join("\n")}`);
  }
  return parsed.data;
}
