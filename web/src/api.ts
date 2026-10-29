import { UserManager } from "oidc-client-ts";

// Mirrors the API's response shapes (src/dashboard.ts). Kept separate so the
// browser bundle never pulls in server code.
export type HealthStatus = "healthy" | "watch" | "over";

export interface ContractHealth {
  kind: "block" | "unlimited";
  status: HealthStatus;
  hoursUsed: number;
  includedHours: number | null;
  percentUsed: number | null;
  overageAmount: number;
  effectiveRate: number | null;
  reason: string;
}

export interface ClientSummary {
  id: number;
  name: string;
  csat: number | null;
  nps: number | null;
  responses: number;
  nextSurveyOn: string | null;
  contract: ContractHealth | null;
  flags: string[];
}

export interface Dashboard {
  month: string;
  kpis: { csat: number | null; nps: number | null; responseRate: number | null; responses: number; atRisk: number };
  clients: ClientSummary[];
  recentFeedback: {
    clientName: string;
    contactName: string;
    completedAt: string;
    csat: number;
    recommend: number;
    commentWell?: string;
    commentImprove?: string;
  }[];
}

export interface Me {
  id: string;
  name: string;
  isAdmin: boolean;
}

type AuthConfig = { mode: "demo" } | { mode: "oidc"; issuer: string; clientId: string; scope: string };

let tokenPromise: Promise<string | null> | null = null;

/**
 * Signs the user in with the organization's identity provider (authorization
 * code flow with PKCE) and returns an access token. Demo mode needs none.
 */
function accessToken(): Promise<string | null> {
  tokenPromise ??= (async () => {
    const config = (await (await fetch("/api/auth-config")).json()) as AuthConfig;
    if (config.mode === "demo") return null;

    const manager = new UserManager({
      authority: config.issuer,
      client_id: config.clientId,
      redirect_uri: `${location.origin}/`,
      scope: config.scope,
    });
    if (new URLSearchParams(location.search).has("code")) {
      await manager.signinRedirectCallback();
      history.replaceState(null, "", "/");
    }
    const user = await manager.getUser();
    if (user && !user.expired) return user.access_token;

    await manager.signinRedirect();
    return new Promise<never>(() => {}); // The page is navigating to the sign-in screen.
  })();
  return tokenPromise;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string; reason?: string }).reason ?? (body as { error?: string }).error ?? res.statusText);
  return body as T;
}

/** The public survey endpoints take no sign-in. */
export async function publicApi(path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(path, init);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
