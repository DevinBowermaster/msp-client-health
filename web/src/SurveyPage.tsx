import { useEffect, useState, type FormEvent } from "react";
import { publicApi } from "./api";

type Ratings = { overall: number; responsiveness: number; expertise: number; communication: number };

const QUESTIONS: { key: keyof Ratings; text: string }[] = [
  { key: "overall", text: "Overall, how satisfied are you with our service?" },
  { key: "responsiveness", text: "How quickly do we respond to your requests?" },
  { key: "expertise", text: "How would you rate our technical knowledge?" },
  { key: "communication", text: "How well do we keep you informed?" },
];

const CLOSED: Record<string, string> = {
  not_found: "This survey link isn't valid. Please use the link from your email.",
  expired: "This survey link has expired. Thank you for thinking of us.",
  completed: "This survey has already been answered. Thank you!",
};

export function SurveyPage({ token }: { token: string }) {
  const [state, setState] = useState<"loading" | "open" | "sending" | "thanks" | string>("loading");
  const [client, setClient] = useState({ clientName: "", contactName: "" });
  const [ratings, setRatings] = useState<Partial<Ratings>>({});
  const [recommend, setRecommend] = useState<number | null>(null);
  const [commentWell, setCommentWell] = useState("");
  const [commentImprove, setCommentImprove] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void publicApi(`/api/surveys/${token}`).then(({ body }) => {
      if (body.status === "open") {
        setClient({ clientName: String(body.clientName), contactName: String(body.contactName) });
        setState("open");
      } else {
        setState(String(body.status ?? "not_found"));
      }
    });
  }, [token]);

  const complete = QUESTIONS.every((q) => ratings[q.key] !== undefined) && recommend !== null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!complete) {
      setError("Please answer each rating question.");
      return;
    }
    setError(null);
    setState("sending");
    const { status, body } = await publicApi(`/api/surveys/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...ratings, recommend, commentWell, commentImprove }),
    });
    if (status === 200) setState("thanks");
    else if (typeof body.status === "string") setState(body.status);
    else {
      setError(String(body.error ?? "Something went wrong. Please try again."));
      setState("open");
    }
  }

  if (state === "loading") return <main className="survey"><p className="muted">Loading…</p></main>;
  if (state === "thanks")
    return (
      <main className="survey">
        <div className="card center">
          <h1>Thank you</h1>
          <p>We read every response, and yours helps us do better for {client.clientName}.</p>
        </div>
      </main>
    );
  if (state in CLOSED) return <main className="survey"><div className="card center"><p>{CLOSED[state]}</p></div></main>;

  const firstName = client.contactName.split(" ")[0];
  return (
    <main className="survey">
      <form className="card" onSubmit={submit} noValidate>
        <h1>How are we doing?</h1>
        <p className="muted">
          Hi {firstName}, this takes about two minutes. Your answers about {client.clientName} go straight to our team.
        </p>

        {QUESTIONS.map((q) => (
          <fieldset key={q.key} className="question">
            <legend>{q.text}</legend>
            <Scale
              name={q.key}
              from={1}
              to={5}
              value={ratings[q.key] ?? null}
              onChange={(v) => setRatings({ ...ratings, [q.key]: v })}
              low="Poor"
              high="Excellent"
            />
          </fieldset>
        ))}

        <fieldset className="question">
          <legend>How likely are you to recommend us to a colleague?</legend>
          <Scale name="recommend" from={0} to={10} value={recommend} onChange={setRecommend} low="Not likely" high="Very likely" />
        </fieldset>

        <label className="question">
          <span className="legend">What do we do well? <span className="muted">(optional)</span></span>
          <textarea value={commentWell} onChange={(e) => setCommentWell(e.target.value)} maxLength={2000} rows={3} />
        </label>
        <label className="question">
          <span className="legend">What could we do better? <span className="muted">(optional)</span></span>
          <textarea value={commentImprove} onChange={(e) => setCommentImprove(e.target.value)} maxLength={2000} rows={3} />
        </label>

        {error && <p className="error" role="alert">{error}</p>}
        <button className="button" type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Send feedback"}
        </button>
      </form>
    </main>
  );
}

function Scale(props: { name: string; from: number; to: number; value: number | null; onChange: (v: number) => void; low: string; high: string }) {
  const values = Array.from({ length: props.to - props.from + 1 }, (_, i) => props.from + i);
  return (
    <div>
      <div className="scale" role="radiogroup">
        {values.map((v) => (
          <label key={v} className={`scale-option ${props.value === v ? "selected" : ""}`}>
            <input type="radio" name={props.name} value={v} checked={props.value === v} onChange={() => props.onChange(v)} />
            {v}
          </label>
        ))}
      </div>
      <div className="scale-ends muted small">
        <span>{props.low}</span>
        <span>{props.high}</span>
      </div>
    </div>
  );
}
