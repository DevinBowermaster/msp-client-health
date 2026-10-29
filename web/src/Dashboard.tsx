import { useCallback, useEffect, useState } from "react";
import { api, type ClientSummary, type ContractHealth, type Dashboard as Data, type Me } from "./api";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const monthName = (m: string) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([api<Data>("/api/dashboard"), api<Me>("/api/me")]);
      setData(d);
      setMe(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(key: string, path: string, done: (body: Record<string, unknown>) => string) {
    setBusy(key);
    setNotice(null);
    try {
      const body = await api<Record<string, unknown>>(path, { method: "POST" });
      setNotice(done(body));
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <main className="page"><p className="error">Could not load the dashboard: {error}</p></main>;
  if (!data || !me) return <main className="page"><p className="muted">Loading…</p></main>;

  const { kpis } = data;
  return (
    <main className="page">
      <header className="topbar">
        <div>
          <h1>Client Health</h1>
          <p className="muted">Satisfaction over the last 12 months · contract usage for {monthName(data.month)}</p>
        </div>
        <div className="topbar-actions">
          <span className="muted">{me.name}</span>
          {me.isAdmin && (
            <button
              className="button secondary"
              disabled={busy !== null}
              onClick={() => act("sync", "/api/sync", (b) => `Synced ${b.synced} clients from the PSA.`)}
            >
              {busy === "sync" ? "Syncing…" : "Sync from PSA"}
            </button>
          )}
        </div>
      </header>

      {notice && <p className="notice" role="status">{notice}</p>}

      <section className="kpis" aria-label="Summary">
        <Kpi label="CSAT" value={kpis.csat === null ? "—" : kpis.csat.toFixed(1)} unit="/ 5" hint={`${kpis.responses} responses`} />
        <Kpi label="Net Promoter Score" value={kpis.nps === null ? "—" : signed(kpis.nps)} hint="promoters minus detractors" />
        <Kpi label="Response rate" value={kpis.responseRate === null ? "—" : `${kpis.responseRate}%`} hint="surveys answered" />
        <Kpi label="Needs attention" value={String(kpis.atRisk)} hint={`of ${data.clients.length} clients`} tone={kpis.atRisk > 0 ? "over" : undefined} />
      </section>

      <div className="layout">
        <section className="card">
          <h2>Clients</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th className="num">CSAT</th>
                  <th className="num">NPS</th>
                  <th>Contract this month</th>
                  <th>Next survey</th>
                  {me.isAdmin && <th aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {data.clients.map((c) => (
                  <ClientRow
                    key={c.id}
                    client={c}
                    isAdmin={me.isAdmin}
                    busy={busy === `survey-${c.id}`}
                    disabled={busy !== null}
                    onSend={() => act(`survey-${c.id}`, `/api/clients/${c.id}/surveys`, (b) => `Survey sent to ${b.sentTo}.`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h2>Recent feedback</h2>
          {data.recentFeedback.length === 0 && <p className="muted">No comments yet.</p>}
          <ul className="feedback">
            {data.recentFeedback.map((f) => (
              <li key={f.completedAt + f.clientName}>
                <div className="feedback-head">
                  <strong>{f.clientName}</strong>
                  <span className={`score ${f.recommend >= 9 ? "healthy" : f.recommend >= 7 ? "watch" : "over"}`}>{f.recommend}/10</span>
                </div>
                {f.commentWell && <p>“{f.commentWell}”</p>}
                {f.commentImprove && <p className="improve">“{f.commentImprove}”</p>}
                <p className="muted small">{f.contactName} · {shortDate(f.completedAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function Kpi({ label, value, unit, hint, tone }: { label: string; value: string; unit?: string; hint: string; tone?: "over" }) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">
        {value}
        {unit && <span className="kpi-unit"> {unit}</span>}
      </span>
      <span className="muted small">{hint}</span>
    </div>
  );
}

function ClientRow(props: { client: ClientSummary; isAdmin: boolean; busy: boolean; disabled: boolean; onSend: () => void }) {
  const { client: c } = props;
  return (
    <tr>
      <td>
        <div className="client-name">{c.name}</div>
        {c.flags.map((f) => (
          <div key={f} className="flag">{f}</div>
        ))}
      </td>
      <td className="num">{c.csat === null ? <span className="muted">—</span> : c.csat.toFixed(1)}</td>
      <td className="num">{c.nps === null ? <span className="muted">—</span> : signed(c.nps)}</td>
      <td>{c.contract ? <ContractCell h={c.contract} /> : <span className="muted">No contract</span>}</td>
      <td className="muted">{c.nextSurveyOn ? shortDate(c.nextSurveyOn) : "Due now"}</td>
      {props.isAdmin && (
        <td className="num">
          <button className="button small" disabled={props.disabled} onClick={props.onSend}>
            {props.busy ? "Sending…" : "Send survey"}
          </button>
        </td>
      )}
    </tr>
  );
}

function ContractCell({ h }: { h: ContractHealth }) {
  if (h.kind === "block") {
    const pct = Math.min(h.percentUsed ?? 0, 100);
    return (
      <div className="contract">
        <div className="contract-line">
          <span>{h.hoursUsed} of {h.includedHours} h</span>
          <Pill status={h.status} />
        </div>
        <div className="bar" role="img" aria-label={`${h.percentUsed}% of block used`}>
          <div className={`bar-fill ${h.status}`} style={{ width: `${pct}%` }} />
        </div>
        {h.overageAmount > 0 && <span className="small over-text">{usd(h.overageAmount)} overage</span>}
      </div>
    );
  }
  return (
    <div className="contract">
      <div className="contract-line">
        <span>Unlimited · {h.effectiveRate === null ? "no hours" : `${usd(h.effectiveRate)}/h effective`}</span>
        <Pill status={h.status} />
      </div>
      <span className="muted small">{h.hoursUsed} h worked</span>
    </div>
  );
}

function Pill({ status }: { status: ContractHealth["status"] }) {
  const label = { healthy: "Healthy", watch: "Watch", over: "Over" }[status];
  return <span className={`pill ${status}`}>{label}</span>;
}

function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}
