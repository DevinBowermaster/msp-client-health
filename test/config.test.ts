import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const demo = { AUTH_MODE: "demo", MAIL_MODE: "console" };
const prod = {
  NODE_ENV: "production",
  OIDC_ISSUER: "https://idp.example.com",
  OIDC_AUDIENCE: "api://client-health",
  OIDC_CLIENT_ID: "spa",
  SMTP_URL: "smtps://user:pass@smtp.example.com",
  MAIL_FROM: "IT <it@example.com>",
};

describe("loadConfig", () => {
  it("defaults to secure modes, so a bare config fails loudly", () => {
    expect(() => loadConfig({})).toThrow(/OIDC_ISSUER: required when AUTH_MODE=oidc/);
  });

  it("accepts a complete production config", () => {
    expect(loadConfig(prod)).toMatchObject({ AUTH_MODE: "oidc", MAIL_MODE: "smtp" });
  });

  it("allows demo modes locally", () => {
    expect(loadConfig({ ...demo, DEMO_DATA: "true" })).toMatchObject({ AUTH_MODE: "demo", DEMO_DATA: true });
  });

  it.each([
    ["demo sign-in", { AUTH_MODE: "demo" }, /AUTH_MODE=demo .* refused in production/],
    ["console mail", { MAIL_MODE: "console" }, /MAIL_MODE=console .* refused in production/],
    ["demo data", { DEMO_DATA: "true" }, /demo data is refused/],
  ])("refuses %s in production", (_, override, message) => {
    expect(() => loadConfig({ ...prod, ...override })).toThrow(message);
  });
});
