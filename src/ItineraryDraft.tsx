import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { message } from "./errorMessage";
import "./itineraryDraft.css";

function dateLabel(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export default function ItineraryDraft({ enquiryId, expectedUpdatedAt }: {
  enquiryId: Id<"enquiries">;
  expectedUpdatedAt: number;
}) {
  const runs = useQuery(api.itineraries.listMine, { enquiryId });
  const start = useMutation(api.itineraries.start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ enquiryId: string; revision: number; id: string } | null>(null);
  const latest = runs?.[0];
  const outdated = latest && latest.briefUpdatedAt !== expectedUpdatedAt;
  const status = outdated ? "stale" : latest?.status;
  const active = latest?.status === "queued" || latest?.status === "running";

  async function draft() {
    setBusy(true);
    setError("");
    if (!request.current || request.current.enquiryId !== enquiryId || request.current.revision !== expectedUpdatedAt) {
      request.current = { enquiryId, revision: expectedUpdatedAt, id: crypto.randomUUID() };
    }
    try {
      await start({ enquiryId, expectedUpdatedAt, requestId: request.current.id });
      request.current = null;
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return <section className="itinerary-draft" aria-labelledby="itinerary-draft-heading">
    <div className="itinerary-draft-heading">
      <div><h2 id="itinerary-draft-heading">Itinerary draft</h2><p>A suggested day-by-day plan from the saved trip brief.</p></div>
      <button type="button" className="primary" disabled={busy || active || runs === undefined} onClick={() => { void draft(); }}>
        {busy ? "Starting draft…" : "Draft itinerary"}
      </button>
    </div>
    <div className="notice"><strong>AI itinerary draft · prices and availability not checked · not approved for clients</strong>Suggestions need checking before they become part of a reviewed quote.</div>
    <div role="status" aria-live="polite">
      {runs === undefined ? <p>Loading itinerary drafts…</p> : !latest ? <p>No draft yet. Choose Draft itinerary to request a plan. AI drafting must be enabled by the team.</p> : status === "queued" ? <p>Your draft is queued. It will appear here when it is ready.</p> : status === "running" ? <p>Generating the itinerary draft… You can leave this page and return later.</p> : status === "stale" ? <p>The trip brief changed. This draft request belongs to earlier details; request a new draft for the current brief.</p> : status === "failed" ? <p>The draft could not be completed. Choose Draft itinerary to make another request.</p> : <p>Draft saved. Check each suggestion and the unresolved facts below.</p>}
    </div>
    {error && <div role="alert" className="error"><strong>Draft could not start.</strong><br />{error}</div>}
    {latest?.error && (status === "failed" || status === "stale") && <p role="alert" className="error">{latest.error}</p>}
    {latest?.draft && <div className="itinerary-draft-plan">
      {status === "stale" && <h3>Earlier draft — does not reflect the current brief</h3>}
      <p className="itinerary-duration">{latest.draft.days.length} days · {Math.max(0, latest.draft.days.length - 1)} nights</p>
      <ol className="itinerary-days">
        {latest.draft.days.map((day, index) => <li key={`${day.date}-${index}`}>
          <p className="itinerary-day-date">Day {index + 1} · <time dateTime={day.date}>{dateLabel(day.date)}</time></p>
          <h3>{day.title}</h3>
          <ul>{day.activities.map((activity, activityIndex) => <li key={activityIndex}>{activity}</li>)}</ul>
        </li>)}
      </ol>
      <section className="itinerary-facts"><h3>Assumptions to check</h3>{latest.draft.assumptions.length ? <ul>{latest.draft.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul> : <p>No assumptions were listed. This does not verify the suggestions.</p>}</section>
      <section className="itinerary-facts"><h3>Missing or unverified facts</h3>{latest.draft.unresolvedFacts.length ? <ul>{latest.draft.unresolvedFacts.map((fact, index) => <li key={index}>{fact}</li>)}</ul> : <p>No additional facts were listed. Supplier prices and availability still need checking.</p>}</section>
    </div>}
  </section>;
}
