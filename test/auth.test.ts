import { beforeAll, describe, expect, it } from "vitest";
import { AUDIENCE, ISSUER, testIdp, type TestIdp } from "./idp.js";

describe("oidcAuthenticator", () => {
  let idp: TestIdp;
  beforeAll(async () => {
    idp = await testIdp();
  });

  it("accepts a valid token and reads the admin role from groups", async () => {
    const user = await idp.authenticate(`Bearer ${await idp.token({ groups: ["staff", "client-health-admins"] })}`);
    expect(user).toEqual({ id: "user-1", name: "Jordan Tech", isAdmin: true });
  });

  it("does not make someone an admin without the group", async () => {
    const user = await idp.authenticate(`Bearer ${await idp.token({ groups: ["staff"] })}`);
    expect(user?.isAdmin).toBe(false);
  });

  it.each([
    ["no header", async () => undefined],
    ["a non-bearer header", async () => "Basic dXNlcjpwYXNz"],
    ["a token signed by another key", async () => `Bearer ${await idp.token({}, { foreignKey: true })}`],
    ["a token from another issuer", async () => `Bearer ${await idp.token({}, { issuer: "https://evil.example.com" })}`],
    ["a token for another app", async () => `Bearer ${await idp.token({}, { audience: "api://something-else" })}`],
    ["an expired token", async () => `Bearer ${await idp.token({}, { expiresIn: "-5m" })}`],
    ["garbage", async () => "Bearer not.a.jwt"],
  ])("rejects %s", async (_, header) => {
    expect(await idp.authenticate(await header())).toBeNull();
  });

  it("rejects an unsigned token claiming to be an admin", async () => {
    const encode = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const forged = `${encode({ alg: "none" })}.${encode({ sub: "x", iss: ISSUER, aud: AUDIENCE, groups: ["client-health-admins"] })}.`;
    expect(await idp.authenticate(`Bearer ${forged}`)).toBeNull();
  });
});
