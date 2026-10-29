import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export interface User {
  id: string;
  name: string;
  isAdmin: boolean;
}

/** Turns an Authorization header into a user, or null if it does not prove one. */
export type Authenticator = (authorization: string | undefined) => Promise<User | null>;

export interface OidcOptions {
  issuer: string;
  audience: string;
  /** Key lookup for signature checks. In production this is the IdP's JWKS endpoint. */
  getKey: JWTVerifyGetKey;
  /** Claim holding the user's groups or roles, e.g. "groups" for Okta or "roles" for Entra ID. */
  rolesClaim: string;
  adminRole: string;
}

/**
 * Accepts only access tokens signed by the configured identity provider, for this
 * API's audience, and not expired. Identity and roles come from the verified token,
 * never from headers or request bodies the browser controls.
 */
export function oidcAuthenticator(opts: OidcOptions): Authenticator {
  return async (authorization) => {
    const token = /^Bearer (\S+)$/i.exec(authorization ?? "")?.[1];
    if (!token) return null;

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, opts.getKey, {
        issuer: opts.issuer,
        audience: opts.audience,
        clockTolerance: 30,
      }));
    } catch {
      return null;
    }
    if (!payload.sub) return null;

    const roles = payload[opts.rolesClaim];
    const roleList = Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [];
    const name = [payload.name, payload.email, payload.sub].find((v): v is string => typeof v === "string")!;

    return { id: payload.sub, name, isAdmin: roleList.includes(opts.adminRole) };
  };
}

/** Local demo only. Config refuses to start with this when NODE_ENV is production. */
export function demoAuthenticator(): Authenticator {
  return async () => ({ id: "demo", name: "Demo Admin", isAdmin: true });
}

/** Finds the IdP's signing keys through standard OIDC discovery. */
export async function discoverKeys(issuer: string): Promise<JWTVerifyGetKey> {
  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} from ${url}`);
  const doc = (await res.json()) as { jwks_uri?: unknown };
  if (typeof doc.jwks_uri !== "string") throw new Error(`OIDC discovery document at ${url} has no jwks_uri`);
  return createRemoteJWKSet(new URL(doc.jwks_uri));
}
