import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Doc, Id } from "../convex/_generated/dataModel";
import QueryErrorBoundary from "./QueryErrorBoundary";
import QuotePanel from "./QuotePanel";
import { message } from "./errorMessage";
import "./englishIntake.css";

type Facts = Doc<"intakes">["facts"];
const statusLabel = { needs_confirmation: "Needs confirmation", needs_details: "Needs details", complete_brief: "Brief confirmed" };
function Label({ text, children }: { text: string; children: ReactNode }) { return <label className="field"><span>{text}</span>{children}</label>; }

export default function EnglishIntake({ back }: { back: () => void }) {
  const create = useMutation(api.intakes.create);
  const [selected, setSelected] = useState<Id<"intakes"> | null>(null);
  const [original, setOriginal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ text: string; id: string } | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    if (!request.current || request.current.text !== original) request.current = { text: original, id: crypto.randomUUID() };
    try { const result = await create({ originalMessage: original, requestId: request.current.id }); request.current = null; setSelected(result.intakeId); setOriginal(""); }
    catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }
  return <section className="english-intake">
    <button type="button" className="text-button back" onClick={back}>Back to enquiries</button>
    <h1>English client enquiry</h1>
    <div className="notice"><strong>Private saved intake, not a priced quote.</strong> Simple text rules suggest facts for you to confirm. AI extraction, supplier pricing and client delivery are not connected here.</div>
    {selected ? <>
      <button type="button" className="text-button" onClick={() => setSelected(null)}>Paste another enquiry or open a saved intake</button>
      <QueryErrorBoundary key={selected} failureText="This intake could not be loaded. Your saved original is unchanged." retryLabel="Retry intake"><IntakeDetail id={selected} /></QueryErrorBoundary>
    </> : <>
      <form className="editor" onSubmit={save}>
        <Label text="Original forwarded English enquiry"><textarea rows={7} required maxLength={8000} value={original} onChange={e => setOriginal(e.target.value)} /></Label>
        <p className="intake-hint">Paste the original message. It stays in your signed-in agency workspace; no message is sent to WhatsApp or another service.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions"><button className="primary" disabled={busy}>{busy ? "Saving original…" : "Save original and check facts"}</button></div>
      </form>
      <h2>Saved English intakes</h2>
      <QueryErrorBoundary failureText="Saved intakes could not be loaded. Your originals are unchanged." retryLabel="Retry saved intakes"><IntakeList open={setSelected} /></QueryErrorBoundary>
    </>}
  </section>;
}

function IntakeList({ open }: { open: (id: Id<"intakes">) => void }) {
  const rows = useQuery(api.intakes.listMine, {});
  if (rows === undefined) return <p role="status">Loading saved intakes…</p>;
  if (!rows.length) return <p>No saved English intakes yet.</p>;
  return <div className="enquiry-list">{rows.map(row => <button className="enquiry-row" type="button" key={row._id} onClick={() => open(row._id)}><span className="enquiry-client"><strong>{statusLabel[row.status]}</strong><span>Saved {new Date(row.createdAt).toLocaleString()} · version {row.revisionNumber}</span></span><span className="row-open">View intake</span></button>)}</div>;
}

function IntakeDetail({ id }: { id: Id<"intakes"> }) {
  const data = useQuery(api.intakes.getMine, { intakeId: id });
  if (data === undefined) return <p role="status">Loading English intake…</p>;
  if (!data) return <p>This intake is not available.</p>;
  return <>
    <section className="detail-sheet intake-original"><h2>Original forwarded message</h2><p>{data.originalMessage}</p></section>
    {!data.factsConfirmed && <section className="intake-source"><h2>Details found in your message - confirm or correct</h2><p>These simple matches may be incomplete or wrong. Check each suggested value against the original before confirming it.</p>{data.sourceHints.length ? <ul>{data.sourceHints.map((hint, i) => <li key={i}><strong>{hint.field}</strong>: <q>{hint.snippet}</q></li>)}</ul> : <p>No text hints were found. Enter only the facts you know.</p>}</section>}
    {data.status === "complete_brief" && <p className="notice" role="status"><strong>Structured brief confirmed.</strong> No supplier prices or availability have been checked. Human quote review and a branded PDF are still pending.</p>}
    {data.status === "complete_brief" ? <>
      <SupplierDetails key={id} data={data} />
      <details><summary>Confirmed trip facts (edit)</summary><FactsEditor key={id} data={data} /></details>
    </> : <FactsEditor key={id} data={data} />}
    {data.status === "complete_brief" && <ComparisonPlan id={id} />}
    <QuotePanel intakeId={id} />
    <IntakeHistory id={id} />
  </>;
}
function ComparisonPlan({id}:{id:Id<"intakes">}) {
  const plan=useQuery(api.intakes.comparisonPlan,{intakeId:id});
  if(plan===undefined)return <p role="status">Preparing comparison choices…</p>;
  if(!plan)return <p role="status">Confirm the complete brief before preparing comparisons.</p>;
  return <section className="detail-sheet" aria-labelledby="comparison-title">
    <h2 id="comparison-title">Choices to price</h2>
    <p>{plan.options.length} combinations from confirmed brief version {plan.revisionNumber}. No prices or availability have been checked; no lowest-price choice has been selected.</p>
    <ol className="comparison-options">{plan.options.map(option=><li key={option.optionId}>
      <strong>{option.startDate} to {option.endDate} · {option.hotelTier} · {option.transport} transport</strong>
      <p>{option.stops.map(stop=>`${stop.city}: ${stop.nights} nights (${stop.arrivalDate} to ${stop.departureDate})`).join("; ")}</p>
      <p>{option.adults} adults · {option.rooms.length} rooms · {option.meals.join(", ")}</p>
    </li>)}</ol>
    <h3>Still needed before a quote</h3><ul>{plan.requiredChecks.map(check=><li key={check}>{check}</li>)}</ul>
  </section>;
}

type IntakeData = NonNullable<FunctionReturnType<typeof api.intakes.getMine>>;
function SupplierDetails({data}:{data:IntakeData}) {
  const save=useMutation(api.intakes.saveSupplierFacts);
  const [facts,setFacts]=useState(data.supplierFacts);
  const revision=useRef(data.revisionNumber);
  const [editing,setEditing]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const field=editing ?? data.nextSupplierQuestion?.field;
  const stale=revision.current!==data.revisionNumber;
  function reload(){setFacts(data.supplierFacts);revision.current=data.revisionNumber;setError("");setEditing(null);}
  async function submit(event:FormEvent){
    event.preventDefault();setBusy(true);setError("");
    try{const submitted={...facts};if(submitted.flights!=="include")delete submitted.flightRequest;const result=await save({intakeId:data._id,expectedRevisionNumber:revision.current,supplierFacts:submitted});revision.current=result.revisionNumber;setFacts(submitted);setEditing(null);}
    catch(caught){setError(message(caught));}finally{setBusy(false);}
  }
  return <section className="detail-sheet">
    <h2>Details for supplier searches</h2>
    <p>These answers stay with your agency. No search, booking or client message is sent when you save.</p>
    {stale && <p className="notice">Trip details changed. Your unsaved answer remains here; copy it before loading the latest saved details.</p>}
    {stale && <button type="button" className="quiet" onClick={reload}>Load latest supplier details</button>}
    {field ? <form onSubmit={submit}>
      <p>{editing ? "Correct this saved answer." : data.nextSupplierQuestion?.prompt}</p>
      {field==="leadNationality" && <Label text="Lead traveller nationality"><input required maxLength={100} value={facts.leadNationality??""} placeholder="Country of nationality" onChange={event=>setFacts(old=>({...old,leadNationality:event.target.value}))}/></Label>}
      {field==="flights" && <Label text="Flights in this quote"><select required value={facts.flights??""} onChange={event=>setFacts(old=>{const updated={...old,flights:event.target.value as "include"|"exclude"};if(updated.flights!==old.flights)delete updated.flightRequest;return updated;})}><option value="">Choose after checking with the client</option><option value="include">Include flights</option><option value="exclude">No flights</option></select></Label>}
      {field==="flightRequest" && <Label text="Required flight legs and timing"><textarea required maxLength={2000} rows={4} value={facts.flightRequest??""} onChange={event=>setFacts(old=>({...old,flightRequest:event.target.value}))}/></Label>}
      {field==="childAgesAtTravelConfirmed" && <label><input type="checkbox" required checked={facts.childAgesAtTravelConfirmed===true} onChange={event=>setFacts(old=>({...old,childAgesAtTravelConfirmed:event.target.checked}))}/> The room details contain each child's age on the travel dates.</label>}
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" className="primary" disabled={busy||stale}>{busy?"Saving answer…":"Save supplier-search answer"}</button>
    </form> : <>
      <p className="notice"><strong>Customer search details saved.</strong> Supplier access, exact supplier mappings, complete costs and human review are still required. No prices or availability have been checked.</p>
      <p>Lead nationality: {data.supplierFacts.leadNationality} · {data.supplierFacts.flights==="exclude"?"No flights":"Include flights"}</p>
      {data.supplierFacts.flightRequest && <p>{data.supplierFacts.flightRequest}</p>}
      <button type="button" className="text-button" onClick={()=>setEditing("leadNationality")}>Correct nationality</button>{" "}
      <button type="button" className="text-button" onClick={()=>setEditing("flights")}>Correct flight inclusion</button>{" "}
      {data.supplierFacts.flights==="include" && <button type="button" className="text-button" onClick={()=>setEditing("flightRequest")}>Correct flight legs</button>}
    </>}
  </section>;
}
function IntakeHistory({id}:{id:Id<"intakes">}){
  const rows=useQuery(api.intakes.history,{intakeId:id});
  if(rows===undefined)return <p role="status">Loading intake history…</p>;
  if(!rows.length)return null;
  return <details className="detail-sheet"><summary>Earlier intake versions</summary>
    <p>Latest 20 saved snapshots. The original forwarded message stays unchanged.</p>
    {rows.map(row=><section key={row.revisionNumber}><h3>Version {row.revisionNumber}</h3>
      <p>{row.facts.startDates.join(", ")||"Dates not yet confirmed"} · {row.facts.hotelTiers.join(", ")} · {row.facts.transportOptions.join(", ")}</p>
      <p>Lead nationality: {row.supplierFacts.leadNationality??"Not yet confirmed"} · Flights: {row.supplierFacts.flights??"Not yet confirmed"}</p>
      {row.supplierFacts.flightRequest && <p>{row.supplierFacts.flightRequest}</p>}
    </section>)}
  </details>;
}

function FactsEditor({ data }: { data: IntakeData }) {
  const confirm = useMutation(api.intakes.confirmFacts);
  const seed = data.factsConfirmed ? data.facts : data.candidates;
  const [facts, setFacts] = useState<Facts>(() => structuredClone(seed));
  const [roomAgeText, setRoomAgeText] = useState(seed.rooms.map(room => room.childAges.join(", ")));
  const [dates, setDates] = useState(seed.startDates.join(", "));
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(data.revisionNumber);
  const factKey=(value:Facts)=>JSON.stringify([value.destination,value.adults,value.nights,value.departureCity,value.startDates,value.hotelTiers,value.transportOptions,value.meals,value.routeStops,value.rooms]);
  const currentKey=factKey({...facts,startDates:dates.split(/[,\n]/).map(date=>date.trim()).filter(Boolean)}),savedKey=factKey(data.facts);
  useEffect(()=>{if(currentKey===savedKey)revision.current=data.revisionNumber;},[currentKey,savedKey,data.revisionNumber]);
  const field = data.factsConfirmed && data.nextQuestion ? data.nextQuestion.field : null;
  const visible = (name: string) => !field || field === name;
  function change<K extends keyof Facts>(key: K, value: Facts[K]) { setFacts(old => ({ ...old, [key]: value })); }
  function toggle<K extends "hotelTiers" | "transportOptions" | "meals">(key: K, value: Facts[K][number], checked: boolean) {
    setFacts(old => ({ ...old, [key]: checked ? [...old[key], value] : old[key].filter(item => item !== value) }));
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    const submitted = { ...facts, startDates: dates.split(/[,\n]/).map(date => date.trim()).filter(Boolean) };
    try { const result = await confirm({ intakeId: data._id, expectedRevisionNumber: revision.current, facts: submitted }); revision.current = result.revisionNumber; setFacts(submitted); setReviewed(false); }
    catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }
  return <form className="editor intake-facts" onSubmit={save}>
    <h2>{data.status === "complete_brief" ? "Confirmed trip facts" : data.factsConfirmed ? "Confirm the missing detail" : "Check and confirm the suggested facts"}</h2>
    {data.nextQuestion && data.factsConfirmed && <p className="notice" role="status">{data.nextQuestion.prompt}</p>}
    {!data.factsConfirmed && <p>Suggested values are editable and not confirmed yet. Leave unknown facts blank; confirmation will ask for one missing detail next.</p>}
    <div className="form-grid">
      {visible("destination") && <Label text="Destination"><select value={facts.destination ?? ""} onChange={e => change("destination", e.target.value ? "Vietnam" : undefined)}><option value="">Not confirmed</option><option>Vietnam</option></select></Label>}
      {visible("adults") && <Label text="Total adults"><input type="number" min={1} max={30} value={facts.adults ?? ""} onChange={e => change("adults", e.target.value ? Number(e.target.value) : undefined)} /></Label>}
      {visible("nights") && <Label text="Total nights"><input type="number" min={1} max={90} value={facts.nights ?? ""} onChange={e => change("nights", e.target.value ? Number(e.target.value) : undefined)} /></Label>}
      {visible("departureCity") && <Label text="Departure city"><input maxLength={100} value={facts.departureCity ?? ""} onChange={e => change("departureCity", e.target.value || undefined)} /></Label>}
    </div>
    {visible("startDates") && <Label text="All start-date alternatives (YYYY-MM-DD, separated by commas)"><textarea rows={2} value={dates} onChange={e => setDates(e.target.value)} /><small>Keep every date to compare. Do not choose the cheapest until equivalent supplier facts are checked.</small></Label>}
    {visible("hotelTiers") && <fieldset><legend>Hotel tiers to compare</legend>{(["3-star", "4-star", "5-star"] as const).map(tier => <label key={tier}><input type="checkbox" checked={facts.hotelTiers.includes(tier)} onChange={e => toggle("hotelTiers", tier, e.target.checked)} /> {tier}</label>)}</fieldset>}
    {visible("transportOptions") && <fieldset><legend>Travel arrangements to compare</legend>{(["private", "shared"] as const).map(value => <label key={value}><input type="checkbox" checked={facts.transportOptions.includes(value)} onChange={e => toggle("transportOptions", value, e.target.checked)} /> {value}</label>)}</fieldset>}
    {visible("meals") && <fieldset><legend>Required meals</legend>{(["breakfast", "lunch", "dinner"] as const).map(value => <label key={value}><input type="checkbox" checked={facts.meals.includes(value)} onChange={e => toggle("meals", value, e.target.checked)} /> {value}</label>)}</fieldset>}
    {visible("routeStops") && <section><h3>Route and nights at each stop</h3>{facts.routeStops.map((stop, i) => <div className="intake-row" key={i}><Label text={`Stop ${i + 1} city`}><input maxLength={100} value={stop.city} onChange={e => change("routeStops", facts.routeStops.map((item, n) => n === i ? { ...item, city: e.target.value } : item))} /></Label><Label text={`Stop ${i + 1} nights`}><input type="number" min={0} max={90} value={stop.nights ?? ""} onChange={e => change("routeStops", facts.routeStops.map((item, n) => n === i ? { ...item, nights: e.target.value ? Number(e.target.value) : undefined } : item))} /></Label><button className="text-button" type="button" onClick={() => change("routeStops", facts.routeStops.filter((_, n) => n !== i))}>Remove stop {i + 1}</button></div>)}<button className="quiet" type="button" onClick={() => change("routeStops", [...facts.routeStops, { city: "" }])}>Add route stop</button></section>}
    {visible("rooms") && <section><h3>Rooms and occupancy</h3><p className="intake-hint">Confirm adults and every child's age for each room. An empty child-age field means no children in that room.</p>{facts.rooms.map((room, i) => <div className="intake-row" key={i}><Label text={`Room ${i + 1} adults`}><input type="number" min={1} max={6} value={room.adults || ""} onChange={e => change("rooms", facts.rooms.map((item, n) => n === i ? { ...item, adults: Number(e.target.value) } : item))} /></Label><Label text={`Room ${i + 1} child ages (comma-separated; blank for none)`}><input value={roomAgeText[i] ?? ""} onChange={e => { setRoomAgeText(old => old.map((value, n) => n === i ? e.target.value : value)); change("rooms", facts.rooms.map((item, n) => n === i ? { ...item, childAges: e.target.value.split(",").map(age => age.trim()).filter(Boolean).map(Number) } : item)); }} /></Label><button className="text-button" type="button" onClick={() => { setRoomAgeText(old => old.filter((_, n) => n !== i)); change("rooms", facts.rooms.filter((_, n) => n !== i)); }}>Remove room {i + 1}</button></div>)}<button className="quiet" type="button" onClick={() => { setRoomAgeText(old => [...old, ""]); change("rooms", [...facts.rooms, { adults: 0, childAges: [] }]); }}>Add room</button></section>}
    {!data.factsConfirmed && <label className="intake-confirm"><input type="checkbox" required checked={reviewed} onChange={e => setReviewed(e.target.checked)} /> I checked the suggested facts and alternatives against the original. Unknown details remain blank.</label>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="form-actions"><button className="primary" disabled={busy}>{busy ? "Saving confirmed facts…" : data.status === "complete_brief" ? "Save corrections" : data.factsConfirmed ? "Save answer" : "Confirm checked facts"}</button></div>
  </form>;
}
