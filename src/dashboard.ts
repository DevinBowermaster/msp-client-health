import { evaluateContract, type ContractHealth, type HealthThresholds } from "./domain/contractHealth.js";
import { average, csat, netPromoterScore, npsCategory, round, type NpsCategory } from "./domain/scoring.js";
import type { ResponseRow, Store } from "./store.js";

/** A client scoring below this CSAT (out of 5) is flagged. */
export const LOW_CSAT = 3.5;

export interface ClientSummary {
  id: number;
  name: string;
  csat: number | null;
  nps: number | null;
  responses: number;
  lastResponse: { completedAt: string; recommend: number; category: NpsCategory } | null;
  nextSurveyOn: string | null;
  contract: ContractHealth | null;
  flags: string[];
}

export interface Dashboard {
  month: string;
  since: string;
  kpis: {
    csat: number | null;
    nps: number | null;
    responseRate: number | null;
    responses: number;
    atRisk: number;
  };
  clients: ClientSummary[];
  recentFeedback: { clientName: string; contactName: string; completedAt: string; csat: number; recommend: number; commentWell?: string; commentImprove?: string }[];
}

/**
 * Satisfaction comes from responses since `since` (normally the last 12 months);
 * contract health comes from `month`.
 */
export function buildDashboard(store: Store, month: string, since: string, thresholds: HealthThresholds): Dashboard {
  const responses = store.responsesSince(since);
  const byClient = new Map<number, ResponseRow[]>();
  for (const r of responses) byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), r]);

  const clients = store.listClients().map((client): ClientSummary => {
    const mine = byClient.get(client.id) ?? [];
    const contract = store.getContract(client.id);
    const health = contract ? evaluateContract(contract, store.hoursUsed(client.id, month), thresholds) : null;
    const latest = mine[0];
    const clientCsat = average(mine.map(csat));

    const flags: string[] = [];
    if (health?.status === "over") flags.push(health.reason);
    if (clientCsat !== null && clientCsat < LOW_CSAT) flags.push(`CSAT ${round(clientCsat)} of 5`);
    if (latest && npsCategory(latest.recommend) === "detractor") flags.push(`Last response a detractor (${latest.recommend}/10)`);

    return {
      id: client.id,
      name: client.name,
      csat: clientCsat === null ? null : round(clientCsat),
      nps: netPromoterScore(mine.map((r) => r.recommend)),
      responses: mine.length,
      lastResponse: latest
        ? { completedAt: latest.completedAt, recommend: latest.recommend, category: npsCategory(latest.recommend) }
        : null,
      nextSurveyOn: client.nextSurveyOn,
      contract: health,
      flags,
    };
  });

  const counts = store.surveyCountsSince(since);
  const overallCsat = average(responses.map(csat));

  return {
    month,
    since,
    kpis: {
      csat: overallCsat === null ? null : round(overallCsat),
      nps: netPromoterScore(responses.map((r) => r.recommend)),
      responseRate: counts.sent === 0 ? null : Math.round((counts.completed / counts.sent) * 100),
      responses: responses.length,
      atRisk: clients.filter((c) => c.flags.length > 0).length,
    },
    clients,
    recentFeedback: responses
      .filter((r) => r.commentWell || r.commentImprove)
      .slice(0, 6)
      .map((r) => ({
        clientName: r.clientName,
        contactName: r.contactName,
        completedAt: r.completedAt,
        csat: round(csat(r)),
        recommend: r.recommend,
        commentWell: r.commentWell,
        commentImprove: r.commentImprove,
      })),
  };
}
