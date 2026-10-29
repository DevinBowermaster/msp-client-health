import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { oidcAuthenticator, type Authenticator } from "../src/http/auth.js";

export const ISSUER = "https://idp.example.com/oauth2/default";
export const AUDIENCE = "api://client-health";

export interface TestIdp {
  authenticate: Authenticator;
  token: (claims?: JWTPayload, opts?: { issuer?: string; audience?: string; expiresIn?: string; foreignKey?: boolean }) => Promise<string>;
}

/** A throwaway identity provider: real RS256 keys, real signatures, no network. */
export async function testIdp(): Promise<TestIdp> {
  const trusted = await generateKeyPair("RS256");
  const foreign = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(trusted.publicKey)), kid: "k1", alg: "RS256" };

  const authenticate = oidcAuthenticator({
    issuer: ISSUER,
    audience: AUDIENCE,
    getKey: createLocalJWKSet({ keys: [jwk] }),
    rolesClaim: "groups",
    adminRole: "client-health-admins",
  });

  const token: TestIdp["token"] = (claims = {}, opts = {}) =>
    new SignJWT({ name: "Jordan Tech", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setSubject("user-1")
      .setIssuer(opts.issuer ?? ISSUER)
      .setAudience(opts.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? "5m")
      .sign(opts.foreignKey ? foreign.privateKey : trusted.privateKey);

  return { authenticate, token };
}
