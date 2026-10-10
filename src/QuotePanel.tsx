import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import QueryErrorBoundary from "./QueryErrorBoundary";
import "./quotes.css";
import { money, checkedTime, optionLabel } from "../lib/quotePresentation.mjs";

type QuoteSource={enquiryId:Id<"enquiries">;intakeId?:never}|{intakeId:Id<"intakes">;enquiryId?:never};
export default function QuotePanel(source: QuoteSource) {
  return <section className="quote-panel" aria-labelledby="quotes-title">
    <h2 id="quotes-title">Reviewed quotes</h2>
    <p>Final client prices appear after complete supplier checks and team review.</p>
    <QueryErrorBoundary failureText="Quotes could not be loaded. Your saved trip is unchanged." retryLabel="Retry quotes">
      <QuoteList key={source.enquiryId??source.intakeId} {...source} />
    </QueryErrorBoundary>
  </section>;
}
function QuoteList(source:QuoteSource) {
  const enquiries=useQuery(api.quotes.listMine,source.enquiryId?{enquiryId:source.enquiryId}:"skip");
  const intakes=useQuery(api.quotes.listForIntake,source.intakeId?{intakeId:source.intakeId}:"skip");
  const versions=source.intakeId?intakes:enquiries;
  const [selected, setSelected] = useState<Id<"quoteVersions"> | null>(null);
  if (versions === undefined) return <p role="status">Loading quote versions…</p>;
  if (!versions.length) return <div className="notice"><strong>No reviewed quote yet.</strong>
    Your trip brief is saved. Supplier pricing and complete quote preparation are not connected yet. An AI itinerary draft is not a quote.</div>;
  const current = selected ?? versions[0].quoteVersionId;
  return <>
    <label className="field"><span>Quote version</span>
      <select value={current} onChange={event => setSelected(event.target.value as Id<"quoteVersions">)}>
        {versions.map(version => <option key={version.quoteVersionId} value={version.quoteVersionId}>
          {optionLabel(version.option)} · {"comparisonLabel" in version && typeof version.comparisonLabel==="string"?version.comparisonLabel:""} · brief {version.briefRevision} · {checkedTime(version.createdAt)} · {version.decision}
        </option>)}
      </select>
    </label>
    <QuoteDetails key={current} quoteVersionId={current} />
  </>;
}
function QuoteDetails({ quoteVersionId }: { quoteVersionId: Id<"quoteVersions"> }) {
  const result = useQuery(api.quotes.getMine, { quoteVersionId });
  const logoUrl = useQuery(api.quotes.getMineLogoUrl, { quoteVersionId });
  const download = useAction(api.quotePdf.download);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [expired, setExpired] = useState(false);
  const deadline = result?.quote?.prices.validUntil;
  useEffect(() => {
    if (deadline === undefined) { setExpired(false); return; }
    setExpired(deadline <= Date.now());
    const timer = window.setTimeout(() => setExpired(true), Math.min(Math.max(0, deadline - Date.now()), 2147483647));
    return () => window.clearTimeout(timer);
  }, [deadline]);
  if (result === undefined) return <p role="status">Loading this quote…</p>;
  if (!result) return <p role="status">This quote could not be found.</p>;
  const isExpired = expired || (deadline !== undefined && deadline <= Date.now());
  if (!result.ready || !result.quote || isExpired) return <div className="notice" role="status">
    <strong>This quote is not ready for clients.</strong>
    <ul>{(isExpired ? ["The price-check period ended. Fresh supplier checks and review are required."] : result.reasons).map(reason => <li key={reason}>{reason}</li>)}</ul>
  </div>;
  const quote = result.quote;
  async function savePdf() {
    setDownloading(true); setDownloadError("");
    try {
      let convertedWebpLogo: ArrayBuffer | undefined;
      if (quote.branding.logoStorageId) {
        if (!logoUrl) throw new Error("Your saved logo could not be loaded. Retry before downloading.");
        const response = await fetch(logoUrl);
        if (!response.ok) throw new Error("Your saved logo could not be loaded.");
        const blob = await response.blob();
        if (blob.type === "image/webp") {
          const bitmap = await createImageBitmap(blob);
          try {
            if (bitmap.width > 10000 || bitmap.height > 10000) throw new Error("Choose a smaller agency logo.");
            const canvas = document.createElement("canvas");
            const scale = Math.min(1, 800 / bitmap.width, 800 / bitmap.height);
            canvas.width = Math.max(1,Math.round(bitmap.width * scale)); canvas.height = Math.max(1,Math.round(bitmap.height * scale));
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Your logo could not be prepared.");
            context.drawImage(bitmap,0,0,canvas.width,canvas.height);
            const png = await new Promise<Blob>((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Your logo could not be prepared.")),"image/png"));
            convertedWebpLogo = await png.arrayBuffer();
          } finally { bitmap.close(); }
        }
      }
      const bytes = await download({ quoteVersionId, ...(convertedWebpLogo ? { convertedWebpLogo } : {}) });
      if (quote.prices.validUntil <= Date.now()) throw new Error("The price-check period ended. Recheck this quote before downloading.");
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a"); link.href = url; link.download = "TripRelay-"+quoteVersionId+".pdf";
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url),10000);
    } catch (error) { setDownloadError(error instanceof Error ? error.message : "The PDF could not be downloaded. Please retry."); }
    finally { setDownloading(false); }
  }
  return <article className="quote-sheet" aria-label="Approved quote">
    <header><h3>{quote.branding.businessName}</h3><p>{optionLabel(result.option)} · reviewed</p></header>
    {quote.comparisonChoice && <p>{quote.comparisonChoice.startDate} to {quote.comparisonChoice.endDate} · {quote.comparisonChoice.hotelTier} · {quote.comparisonChoice.transport} transport<br/>{quote.comparisonChoice.adults} adults · {quote.comparisonChoice.rooms.length} rooms · {quote.comparisonChoice.meals.join(", ")}</p>}
    <p className="quote-total">{money(quote.prices.finalClientPriceMinor)}<span>Final client total · GST included</span></p>
    <dl className="quote-timestamps"><div><dt>Prices checked</dt><dd>{checkedTime(quote.prices.pricesCheckedAt)}</dd></div>
      <div><dt>Recheck required after</dt><dd>{checkedTime(quote.prices.validUntil)}</dd></div></dl>
    <table className="quote-prices"><caption>Included trip prices</caption><thead><tr><th scope="col">Component</th><th scope="col">Final price</th></tr></thead>
      <tbody>{quote.prices.items.map((item, index) => <tr key={index}><th scope="row">{item.description}</th><td>{money(item.finalClientPriceMinor)}</td></tr>)}</tbody>
    </table>
    <h3>Day-by-day plan</h3><ol className="quote-days">{quote.days.map(day => <li key={day.date}>
      <time dateTime={day.date}>{day.date}</time><h4>{day.title}</h4><ul>{day.activities.map((activity, index) => <li key={index}>{activity}</li>)}</ul>
    </li>)}</ol>
    <div className="quote-terms"><section><h3>Inclusions</h3><ul>{quote.inclusions.map((text, index) => <li key={index}>{text}</li>)}</ul></section>
      <section><h3>Exclusions</h3><ul>{quote.exclusions.map((text, index) => <li key={index}>{text}</li>)}</ul></section></div>
    <h3>Cancellation terms</h3><ul>{quote.cancellationTerms.map((text, index) => <li key={index}>{text}</li>)}</ul>
    <p>{quote.branding.contactName} · {quote.branding.contactPhone} · {quote.branding.contactEmail}</p>
    <button type="button" className="primary" disabled={downloading} onClick={() => { void savePdf(); }}>{downloading ? "Preparing PDF…" : "Download branded PDF"}</button>
    {downloadError && <p role="alert">{downloadError}</p>}
    <p className="quote-limitations">Prices and availability require rechecking after the stated time; no booking has been made.</p>
  </article>;
}
