import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { message } from "./errorMessage";
import QueryErrorBoundary from "./QueryErrorBoundary";
import SupplierChecks, { QuoteSourceEnquiry } from "./SupplierChecks";
import { checkedTime, money, optionLabel } from "../lib/quotePresentation.mjs";
import "./quotes.css";

export default function QuoteReview() {
  return <section aria-labelledby="review-heading"><div className="page-title"><div>
    <h1 id="review-heading">Quote review</h1><p>Approve the exact quote version after checking all supplier facts.</p>
  </div></div><SupplierChecks /><QueryErrorBoundary failureText="The review queue could not be loaded. No approval was changed." retryLabel="Retry review queue">
    <ReviewQueue />
  </QueryErrorBoundary></section>;
}
function ReviewQueue() {
  const queue = useQuery(api.quotes.reviewQueue);
  const [selected, setSelected] = useState<Id<"quoteVersions"> | null>(null);
  if (queue === undefined) return <p role="status">Loading quote reviews…</p>;
  if (!queue.length) return <div className="notice"><strong>No quote versions to review.</strong>
    Complete supplier-backed quote preparation must run before a version appears here.</div>;
  const current = selected ?? queue[0].quoteVersionId;
  return <>
    <label className="field"><span>Latest quote versions (up to 20)</span><select value={current} onChange={event => setSelected(event.target.value as Id<"quoteVersions">)}>
      {queue.map(version => <option key={version.quoteVersionId} value={version.quoteVersionId}>
        {version.agencyName} · {optionLabel(version.option)} · brief {version.briefRevision} · {version.decision}
      </option>)}
    </select></label>
    <ReviewVersion key={current} quoteVersionId={current} />
  </>;
}
function ReviewVersion({ quoteVersionId }: { quoteVersionId: Id<"quoteVersions"> }) {
  const details = useQuery(api.quotes.reviewDetails, { quoteVersionId });
  const sourceBrief = useQuery(api.supplierRuns.brief, details?.version.intakeId ? { intakeId: details.version.intakeId } : "skip");
  const decide = useMutation(api.quotes.decide);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState("");
  async function save(decision: "approved" | "rejected") {
    setBusy(true); setError(""); setSaved("");
    try { await decide({ quoteVersionId, decision, note }); setSaved(decision === "approved" ? "This quote version is approved." : "This version needs corrections. Earlier approval cannot release it."); }
    catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }
  if (details === undefined) return <p role="status">Loading private review facts…</p>;
  if (!details) return <p>This quote version could not be found.</p>;
  const version = details.version;
  const sourceBlocked = Boolean(version.intakeId && (!sourceBrief || sourceBrief.revisionNumber !== version.briefRevision || !sourceBrief.factsConfirmed));
  return <article className="quote-sheet">
    <h2>{version.branding.businessName} · {optionLabel(version.option)}</h2>
    <p>Brief revision {version.briefRevision} · current decision: {details.decision}</p>
    {version.intakeId && <QuoteSourceEnquiry brief={sourceBrief} versionRevision={version.briefRevision} />}
    {version.comparisonScope && <p>English intake choice: {version.comparisonScope.choice.startDate} to {version.comparisonScope.choice.endDate} · {version.comparisonScope.choice.hotelTier} · {version.comparisonScope.choice.transport} transport<br/>Lead nationality: {version.comparisonScope.leadNationality} · {version.comparisonScope.flights} flights</p>}
    {version.comparisonScope?.flightRequest && <p>Private customer flight request: {version.comparisonScope.flightRequest}</p>}
    {details.comparison && <section aria-label="Reviewed price comparison">
      <h3>Compared alternatives ({details.comparison.choices.length})</h3>
      <p>{details.comparison.current ? "Every compared choice remains fresh and reviewed." : "This comparison needs fresh complete facts and review."}<br/>Recheck required after {checkedTime(details.comparison.validUntil)}</p>
      <ul>{details.comparison.choices.map(row=><li key={row.choice.optionId}>
        {row.choice.startDate} to {row.choice.endDate} · {row.choice.hotelTier} · {row.choice.transport} transport · {row.finalClientPriceMinor===null ? "Price needs rechecking" : money(row.finalClientPriceMinor)}
      </li>)}</ul>
    </section>}
    <div className="notice"><strong>Private reviewer facts</strong>Supplier references and NET costs below are restricted to the designated reviewer.</div>
    {details.reasons.length > 0 && <div role="status" className="notice"><strong>Approval is blocked.</strong><ul>{details.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
    {details.prices && <p className="quote-total">{money(details.prices.finalClientPriceMinor)}<span>Calculated final client total · GST-inclusive treatment confirmed</span></p>}
    {version.components.map(component => <section className="review-component" key={component.id}>
      <h3>{component.description || "Component description missing"}</h3>
      <dl className="quote-timestamps"><div><dt>NET supplier amount</dt><dd>{money(component.supplierCostMinor, component.currency)}</dd></div>
        <div><dt>Cost basis</dt><dd>{component.costBasis === "verified_net" ? "Verified NET" : "Unverified"}</dd></div>
        {component.minimumClientPriceMinor !== undefined && <div><dt>Permitted minimum client price</dt><dd>{money(component.minimumClientPriceMinor,component.currency)}</dd></div>}
        <div><dt>Availability</dt><dd>{component.mode === "live" && component.available ? "Verified live" : "Not verified live"}</dd></div>
        <div><dt>Prices checked</dt><dd>{checkedTime(component.checkedAt)}</dd></div>
        <div><dt>Recheck after</dt><dd>{checkedTime(component.validUntil)}</dd></div>
        <div><dt>Compulsory fees</dt><dd>{component.compulsoryFeesConfirmed ? "Confirmed" : "Missing verification"}</dd></div>
        <div><dt>GST treatment</dt><dd>{component.gstIncluded ? "Included" : "Missing verification"}</dd></div></dl>
      <p className="supplier-reference">Supplier reference: {component.supplierReference || "Missing"}</p>
      <p>{component.terms || "Terms missing"}</p>
    </section>)}
    <h3>Day-by-day itinerary</h3><ol className="quote-days">{version.days.map(day => <li key={day.date}><time dateTime={day.date}>{day.date}</time>
      <h4>{day.title}</h4><ul>{day.activities.map((activity, index) => <li key={index}>{activity}</li>)}</ul></li>)}</ol>
    <div className="quote-terms"><section><h3>Inclusions</h3><ul>{version.inclusions.map((text, index) => <li key={index}>{text}</li>)}</ul></section>
      <section><h3>Exclusions</h3><ul>{version.exclusions.map((text, index) => <li key={index}>{text}</li>)}</ul></section></div>
    <h3>Client-facing cancellation terms</h3><ul>{(version.cancellationTerms ?? []).map((text, index) => <li key={index}>{text}</li>)}</ul>
    {details.note && <p>Last reviewer note: {details.note}</p>}
    <label className="field"><span>Review note</span><textarea maxLength={3000} value={note} onChange={event => setNote(event.target.value)} rows={3} />
      <small>A correction reason is required when requesting changes.</small></label>
    {error && <p className="error" role="alert">{error}</p>}<p role="status" aria-live="polite">{saved}</p>
    <div className="review-actions"><button type="button" className="primary" disabled={busy || sourceBlocked || details.reasons.length > 0} onClick={() => { void save("approved"); }}>Approve this version</button>
      <button type="button" className="quiet" disabled={busy || !note.trim()} onClick={() => { void save("rejected"); }}>Request corrections</button></div>
  </article>;
}
