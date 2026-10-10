import { useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { api } from "../convex/_generated/api";
import { checkedTime } from "../lib/quotePresentation.mjs";
import QueryErrorBoundary from "./QueryErrorBoundary";
type Details = NonNullable<FunctionReturnType<typeof api.supplierRuns.details>>;
type Step = Details["hotels"][number]["search"];
const labels: Record<Step["state"], string> = { not_started: "Not started", running: "In progress", ready: "Evidence saved", failed: "Failed", stale: "Source changed" };

export default function SupplierChecks() {
  return <section className="supplier-checks" aria-labelledby="supplier-checks-heading"><h2 id="supplier-checks-heading">Supplier checks</h2>
    <p>Private review of the latest saved enquiries. Saved search or recheck evidence alone cannot approve a quote.</p>
    <QueryErrorBoundary failureText="Supplier checks could not be loaded. No quote or approval was changed." retryLabel="Retry supplier checks"><CheckQueue /></QueryErrorBoundary>
  </section>;
}
function CheckQueue() {
  const queue = useQuery(api.supplierRuns.queue);
  const [selected, setSelected] = useState<Id<"intakes"> | null>(null);
  if (queue === undefined) return <p role="status">Loading supplier checks…</p>;
  if (!queue.length) return <p>No saved English enquiries to check yet.</p>;
  const current = queue.some(row => row.intakeId === selected) ? selected! : queue[0].intakeId;
  return <><label className="field"><span>Saved enquiries (latest 20)</span><select value={current} onChange={event => setSelected(event.target.value as Id<"intakes">)}>
    {queue.map(row => <option key={row.intakeId} value={row.intakeId}>{row.agencyName} · revision {row.revisionNumber} · {row.status === "complete_brief" ? "Brief complete" : "Brief needs details"}</option>)}
  </select></label><CheckDetails key={current} intakeId={current} /></>;
}
export function IntakeBrief({ brief }: { brief: Pick<Details, "originalMessage" | "revisionNumber" | "factsConfirmed" | "facts" | "supplierFacts"> }) {
  const facts = brief.facts, customer = brief.supplierFacts;
  return <section aria-label="Original enquiry and current facts" className="review-source">
    <h3>Original client enquiry</h3><p className="original-enquiry">{brief.originalMessage}</p>
    <h3>Current saved facts · revision {brief.revisionNumber}</h3>
    <p>{brief.factsConfirmed ? "Confirmed by the agency." : "Agency confirmation is still needed."} Check the original for preferences or limits that are missing from these fields.</p>
    <dl className="quote-timestamps">
      <div><dt>Travellers and stay</dt><dd>{facts.adults ?? "Unknown"} adults · {facts.nights ?? "Unknown"} nights · {facts.destination ?? "Unknown destination"}</dd></div>
      <div><dt>Departure</dt><dd>{facts.departureCity || "Unknown"}</dd></div>
      <div><dt>Start dates</dt><dd>{facts.startDates.join(", ") || "Unknown"}</dd></div>
      <div><dt>Hotel tiers</dt><dd>{facts.hotelTiers.join(", ") || "Unknown"}</dd></div>
      <div><dt>Transport</dt><dd>{facts.transportOptions.join(", ") || "Unknown"}</dd></div>
      <div><dt>Meals</dt><dd>{facts.meals.join(", ") || "Unknown"}</dd></div>
      <div><dt>Nationality</dt><dd>{customer?.leadNationality || "Unknown"}</dd></div>
      <div><dt>Flights</dt><dd>{customer?.flights === "include" ? "Included" : customer?.flights === "exclude" ? "Excluded" : "Unknown"}</dd></div>
    </dl>
    <p>Stops: {facts.routeStops.map(stop => `${stop.city}: ${stop.nights ?? "unknown"} nights`).join("; ") || "Unknown"}</p>
    <p>Rooms: {facts.rooms.map((room, index) => `Room ${index + 1}: ${room.adults} adults${room.childAges.length ? `; child ages ${room.childAges.join(", ")}` : ""}`).join("; ") || "Unknown"}</p>
    {facts.rooms.some(room => room.childAges.length > 0) && <p>Child ages at travel: {customer?.childAgesAtTravelConfirmed ? "Confirmed" : "Need confirmation"}</p>}
    {customer?.flightRequest && <p className="original-enquiry">Customer flight request: {customer.flightRequest}</p>}
  </section>;
}
export function QuoteSourceEnquiry({ brief, versionRevision }: { brief: FunctionReturnType<typeof api.supplierRuns.brief> | undefined; versionRevision: number }) {
  if (brief === undefined) return <p role="status">Loading the original enquiry for this version…</p>;
  if (!brief) return <p role="alert">The source enquiry for this version could not be found.</p>;
  return <><p>This quote uses brief revision {versionRevision}. {brief.revisionNumber !== versionRevision && <strong>The current brief has changed; prepare a new version.</strong>}</p><IntakeBrief brief={brief} /></>;
}
function CheckDetails({ intakeId }: { intakeId: Id<"intakes"> }) {
  const [hotelOffset, setHotelOffset] = useState(0), [flightOffset, setFlightOffset] = useState(0);
  const details = useQuery(api.supplierRuns.details, { intakeId, hotelOffset, flightOffset });
  if (details === undefined) return <p role="status">Loading saved check steps…</p>;
  if (!details) return <p>The saved enquiry could not be found.</p>;
  return <><IntakeBrief brief={details} />
    <div className="notice"><strong>Not a verified quote.</strong>Complete costs, taxes, compulsory fees, timing, cancellation terms and fresh availability still need checking before a quote version is reviewed.</div>
    <h3>Hotel checks</h3>{!details.hotels.length && <p>Hotel searches have not been prepared.</p>}
    {details.hotels.map((row, index) => <CheckRow key={index} row={row} />)}
    {details.hotelCount > 0 && <PageControls label="Hotel checks" offset={details.hotelOffset} count={details.hotelCount} size={6} change={setHotelOffset} />}
    <h3>Flight checks</h3>{!details.flights.length && <p>Flight searches have not been prepared. Excluded flights do not need a search.</p>}
    {details.flights.map((row, index) => <CheckRow key={index} row={row} />)}
    {details.flightCount > 0 && <PageControls label="Flight checks" offset={details.flightOffset} count={details.flightCount} size={1} change={setFlightOffset} />}
  </>;
}
function PageControls({ label, offset, count, size, change }: { label: string; offset: number; count: number; size: number; change: (value: number) => void }) {
  return <nav className="review-actions" aria-label={`${label} pages`}><p>Showing {Math.min(offset + 1, count)}–{Math.min(offset + size, count)} of {count}</p>
    <button type="button" className="quiet" disabled={offset === 0} onClick={() => change(Math.max(0, offset - size))}>Previous {label.toLowerCase()}</button>
    <button type="button" className="quiet" disabled={offset + size >= count} onClick={() => change(offset + size)}>Next {label.toLowerCase()}</button>
  </nav>;
}
function CheckRow({ row }: { row: Details["flights"][number] }) {
  return <section className="review-component"><h4>{row.label}</h4>{!row.current && <p>This preparation uses an earlier or unconfirmed brief.</p>}
    <StepSummary label="Search" step={row.search} /><StepSummary label="Price and terms recheck" step={row.recheck} />
    {row.parts.length > 0 && <ul>{row.parts.map(part => <li key={`${part.slot}-${part.stage}`}><StepSummary label={`Fare group ${part.slot + 1} · ${part.stage === "fare" ? "Price" : "Terms"}`} step={part.check} /></li>)}</ul>}
  </section>;
}
function StepSummary({ label, step }: { label: string; step: Step }) {
  return <div className="supplier-step"><p><strong>{label}: {labels[step.state]}</strong>{step.attempt !== null && ` · attempt ${step.attempt}`}</p>
    {step.reason && <p>{step.reason}</p>}
    {step.startedAt !== null && <small>Started {checkedTime(step.startedAt)}{step.finishedAt !== null && ` · finished ${checkedTime(step.finishedAt)}`}</small>}
  </div>;
}
