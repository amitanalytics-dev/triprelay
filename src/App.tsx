import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { message } from "./errorMessage";
import EnglishIntake from "./EnglishIntake";
import QueryErrorBoundary from "./QueryErrorBoundary";
import ItineraryDraft from "./ItineraryDraft";
import QuotePanel from "./QuotePanel";
import QuoteReview from "./QuoteReview";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function ErrorText({ text }: { text: string }) {
  return text ? (
    <p role="alert" className="error">
      {text}
    </p>
  ) : null;
}
function Brand() {
  return (
    <span className="brand">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M5 23V9h11a7 7 0 0 1 0 14H5Zm7-9h4a2 2 0 0 1 0 4h-4m10-9 5 7-5 7" />
      </svg>
      TripRelay
    </span>
  );
}

export default function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading)
    return (
      <main className="setup">
        <Brand />
        <p role="status">Opening your travel desk…</p>
      </main>
    );
  return isAuthenticated ? <Workspace /> : <Welcome />;
}
function Welcome() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    data.set("flow", mode);
    try {
      await signIn("password", data);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="welcome">
      <header>
        <Brand />
        <span className="subtle">Your agency’s travel desk</span>
      </header>
      <main className="welcome-grid">
        <section className="intro">
          <h1>Every great trip starts with a clear brief.</h1>
          <p>
            Keep your client’s enquiry, travel preferences and booking outcome
            in one place.
          </p>
          <div className="route">
            <span>Client enquiry</span>
            <span>Trip details</span>
            <span>Supplier quote</span>
          </div>
          <p className="pilot-note">
            This pilot saves enquiries. Supplier pricing and reviewed, branded
            quotes are not connected yet.
          </p>
        </section>
        <section className="auth-panel">
          <h2>
            {mode === "signIn" ? "Welcome back" : "Open your travel desk"}
          </h2>
          <p>
            {mode === "signIn"
              ? "Sign in to your agency workspace."
              : "Create an account, then add your agency details."}
          </p>
          <form onSubmit={submit}>
            <Field label="Email">
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </Field>
            <Field
              label="Password"
              hint={
                mode === "signUp" ? "Use at least 8 characters." : undefined
              }
            >
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "signIn" ? "current-password" : "new-password"
                }
                minLength={8}
                required
              />
            </Field>
            <ErrorText text={error} />
            <button disabled={busy} className="primary">
              {busy
                ? "Please wait…"
                : mode === "signIn"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => {
              setMode(mode === "signIn" ? "signUp" : "signIn");
              setError("");
            }}
          >
            {mode === "signIn"
              ? "New to TripRelay? Create an account"
              : "Already have an account? Sign in"}
          </button>
        </section>
      </main>
      <footer>Vietnam</footer>
    </div>
  );
}
function Workspace() {
  const { signOut } = useAuthActions();
  const profile = useQuery(api.agents.getMine);
  const [screen, setScreen] = useState<"list" | "profile" | "new" | "intake" | "review">("list");
  const reviewerAccess = useQuery(api.quotes.reviewerAccess);
  const [selected, setSelected] = useState<Id<"enquiries"> | null>(null);
  const [error, setError] = useState("");
  return (
    <div className="workspace">
      <header className="app-header">
        <Brand />
        <div className="account">
          <span>{profile?.businessName ?? "Your agency"}</span>
          <button
            className="quiet"
            onClick={() => {
              void signOut().catch((e) => setError(message(e)));
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="app-layout">
        <nav aria-label="Workspace">
          <button
            className={screen !== "profile" && screen !== "review" ? "nav-active" : ""}
            onClick={() => {
              setScreen("list");
              setSelected(null);
            }}
          >
            Enquiries
          </button>
          <button
            className={screen === "profile" ? "nav-active" : ""}
            onClick={() => {
              setScreen("profile");
              setSelected(null);
            }}
          >
            Agency details
          </button>
          {reviewerAccess && <button className={screen === "review" ? "nav-active" : ""} onClick={() => { setScreen("review"); setSelected(null); }}>Quote review</button>}
          <p>
            One brief.
            <br />
            All the trip details.
          </p>
        </nav>
        <main className="main-content">
          <ErrorText text={error} />
          {profile === undefined ? (
            <p role="status">Loading your agency…</p>
          ) : !profile || screen === "profile" ? (
            <Profile
              key={profile?._id ?? "new"}
              profile={profile}
              onSaved={() => setScreen("list")}
            />
          ) : screen === "review" && reviewerAccess ? (
            <QuoteReview />
          ) : screen === "intake" ? (
            <EnglishIntake back={() => setScreen("list")} />
          ) : selected ? (
            <EnquiryDetail id={selected} back={() => setSelected(null)} />
          ) : screen === "new" ? (
            <NewEnquiry
              cancel={() => setScreen("list")}
              saved={(id) => {
                setSelected(id);
                setScreen("list");
              }}
            />
          ) : (
            <>
              <div className="page-title">
                <div>
                  <h1>Your enquiries</h1>
                  <p>Pick up where the conversation left off.</p>
                </div>
                <div className="intake-start-actions">
                  <button className="primary" onClick={() => setScreen("intake")}>Paste English enquiry</button>
                  <button className="text-button" onClick={() => setScreen("new")}>Add trip details manually</button>
                </div>
              </div>
              <div className="notice">
                <strong>Supplier quotes are not connected yet.</strong> You can
                save trip details and track booking outcomes here. No prices or
                availability have been checked.
              </div>
              <QueryErrorBoundary failureText="Saved enquiries could not be loaded. Your saved trips are unchanged." retryLabel="Retry enquiries">
                <EnquiryList createNew={() => setScreen("new")} open={setSelected} />
              </QueryErrorBoundary>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function EnquiryList({ createNew, open }: { createNew: () => void; open: (id: Id<"enquiries">) => void }) {
  const enquiries = useQuery(api.enquiries.listMine);
  return (
    <>
      {enquiries === undefined ? (
        <p role="status">Loading enquiries…</p>
      ) : enquiries.length === 0 ? (
        <div className="empty">
          <h2>Ready for your first client?</h2>
          <p>
            Add their travel details. Their enquiry will stay here when
            you come back.
          </p>
          <button className="primary" onClick={() => createNew()}>
            Add your first enquiry
          </button>
        </div>
      ) : (
        <div className="enquiry-list">
          {enquiries.map((e) => (
            <button
              key={e._id}
              className="enquiry-row"
              onClick={() => open(e._id)}
            >
              <span className="destination">{e.destination}</span>
              <span className="enquiry-client">
                <strong>{e.clientName}</strong>
                <span>
                  {e.startDate} to {e.endDate} · {e.adults + e.children}{" "}
                  travellers
                </span>
              </span>
              <span className="outcome">
                {e.outcome === "pending"
                  ? "Pending"
                  : e.outcome === "won"
                    ? "Won"
                    : "Lost"}
              </span>
              <span className="row-open">View details</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Profile({
  profile,
  onSaved,
}: {
  profile: Doc<"agents"> | null;
  onSaved: () => void;
}) {
  const save = useMutation(api.agents.saveProfile);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await save({
        businessName: String(data.get("businessName")),
        contactName: String(data.get("contactName")),
        contactPhone: String(data.get("contactPhone")),
        contactEmail: String(data.get("contactEmail")),
        defaultMarkupPercent: Number(data.get("markup")),
      });
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <h1>{profile ? "Agency details" : "Let’s set up your agency"}</h1>
          <p>
            {profile
              ? "Keep your business contact details up to date."
              : "Add your business details before saving your first enquiry."}
          </p>
        </div>
      </div>
      <form className="editor" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Business name">
            <input
              name="businessName"
              required
              maxLength={120}
              defaultValue={profile?.businessName}
            />
          </Field>
          <Field label="Your name">
            <input
              name="contactName"
              required
              maxLength={100}
              autoComplete="name"
              defaultValue={profile?.contactName}
            />
          </Field>
          <Field label="Business phone" hint="Include the country code.">
            <input
              name="contactPhone"
              type="tel"
              required
              maxLength={30}
              defaultValue={profile?.contactPhone}
            />
          </Field>
          <Field label="Business email">
            <input
              name="contactEmail"
              type="email"
              required
              maxLength={254}
              defaultValue={profile?.contactEmail}
            />
          </Field>
          <Field
            label="Default agency markup (%)"
            hint="Saved for future quotes. This pilot does not calculate prices."
          >
            <input
              name="markup"
              type="number"
              min={0}
              max={100}
              step="0.1"
              required
              defaultValue={profile?.defaultMarkupPercent ?? 10}
            />
          </Field>
        </div>
        <ErrorText text={error} />
        <div className="form-actions">
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save agency details"}
          </button>
        </div>
      </form>
      <AgencyLogo enabled={Boolean(profile)} businessName={profile?.businessName} />
    </>
  );
}

function AgencyLogo({ enabled, businessName }: { enabled: boolean; businessName?: string }) {
  const logoUrl = useQuery(api.logos.getMineUrl);
  const upload = useAction(api.logos.upload);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => { setImageFailed(false); }, [logoUrl, preview]);
  async function saveLogo() {
    if (!file || busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await upload({ bytes: await file.arrayBuffer(), contentType: file.type });
      setFile(null);
      if (input.current) input.current.value = "";
      setSuccess("Agency logo saved.");
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <section className="logo-editor" aria-labelledby="logo-title">
    <h2 id="logo-title">Agency logo</h2>
    <p>{enabled ? "Add the logo that identifies your agency." : "Save your agency details first, then add your logo here."}</p>
    {enabled && <>
      {(preview || logoUrl) && !imageFailed && <div className="logo-preview"><img src={preview ?? logoUrl!} alt={preview ? "Selected agency logo preview" : `${businessName ?? "Agency"} logo`} onError={() => setImageFailed(true)} /></div>}
      {imageFailed && <p role="alert" className="error">This image could not be displayed. Choose another PNG, JPEG or WebP image.</p>}
      {logoUrl === undefined && <p role="status">Loading your saved logo…</p>}
      <Field label={logoUrl ? "Choose a replacement logo" : "Choose your logo"} hint="PNG, JPEG or WebP. Maximum 500 KB.">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => {
          setError(""); setSuccess(""); setFile(null);
          const selected = event.target.files?.[0];
          if (!selected) return;
          if (!["image/png", "image/jpeg", "image/webp"].includes(selected.type)) { setError("Choose a PNG, JPEG or WebP image."); event.target.value = ""; return; }
          if (!selected.size || selected.size > 500_000) { setError("Choose a logo no larger than 500 KB."); event.target.value = ""; return; }
          setFile(selected);
        }} />
      </Field>
      <ErrorText text={error} />
      {success && <p className="logo-success" role="status">{success}</p>}
      {file && <p className="logo-file">Selected: {file.name}. Save it to use this logo.</p>}
      <button type="button" className="primary" disabled={!file || busy || imageFailed} onClick={() => { void saveLogo(); }}>{busy ? "Uploading logo…" : "Save agency logo"}</button>
    </>}
  </section>;
}
function NewEnquiry({
  cancel,
  saved,
  initial,
}: {
  cancel: () => void;
  saved: (id: Id<"enquiries">) => void;
  initial?: Doc<"enquiries">;
}) {
  const create = useMutation(api.enquiries.create);
  const updateBrief = useMutation(api.enquiries.updateBrief);
  const [children, setChildren] = useState(initial?.children ?? 0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const d = new FormData(event.currentTarget);
    const str = (key: string) => String(d.get(key) ?? "");
    if (str("endDate") <= str("startDate")) {
      setError("The return date must be after the departure date.");
      return;
    }
    setBusy(true);
    try {
      const brief = {
        clientName: str("clientName"),
        clientContact: str("clientContact"),
        destination: str("destination") as "Thailand" | "Vietnam" | "Bali",
        departureCity: str("departureCity"),
        startDate: str("startDate"),
        endDate: str("endDate"),
        adults: Number(d.get("adults")),
        children,
        childAges: Array.from({ length: children }, (_, i) =>
          Number(d.get(`age${i}`)),
        ),
        budgetInr: Number(d.get("budget")),
        hotelStandard: str("hotel") as "3-star" | "4-star" | "5-star",
        flightPreference: str("flight") as "direct" | "flexible" | "no-flights",
        travelPace: str("pace") as "relaxed" | "balanced" | "active",
        interests: str("interests"),
        foodPreferences: str("food"),
        specialRequirements: str("special"),
        rawEnquiry: str("raw"),
      };
      const result = initial ? await updateBrief({ ...brief, enquiryId: initial._id, expectedUpdatedAt: initial.updatedAt }) : await create(brief);
      saved(result.enquiryId);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="text-button back" onClick={cancel}>
        {initial ? "Back to trip details" : "Back to enquiries"}
      </button>
      <div className="page-title">
        <div>
          <h1>{initial ? "Update the trip brief" : "A new trip starts here"}</h1>
          <p>{initial ? "Save the client’s latest details. The previous version stays in the history." : "Save the brief now. Add the preferences your client has shared."}</p>
        </div>
      </div>
      <form className="editor" onSubmit={submit}>
        <h2>Client and trip</h2>
        <div className="form-grid">
          <Field label="Client name">
            <input name="clientName" required maxLength={100} defaultValue={initial?.clientName} />
          </Field>
          <Field label="Client phone or email">
            <input name="clientContact" required maxLength={254} defaultValue={initial?.clientContact} />
          </Field>
          <Field label="Destination">
            <select name="destination" required defaultValue={initial?.destination ?? "Vietnam"}>
              <option>{initial?.destination ?? "Vietnam"}</option>
            </select>
          </Field>
          <Field label="Departure city">
            <input name="departureCity" required maxLength={100} defaultValue={initial?.departureCity} />
          </Field>
          <Field label="Departure date">
            <input
              name="startDate"
              type="date"
              defaultValue={initial?.startDate}
              min={new Date().toLocaleDateString("en-CA")}
              required
            />
          </Field>
          <Field label="Return date">
            <input name="endDate" type="date" required defaultValue={initial?.endDate} />
          </Field>
          <Field label="Adults">
            <input
              name="adults"
              type="number"
              min={1}
              max={30}
              defaultValue={initial?.adults ?? 1}
              required
            />
          </Field>
          <Field label="Children (under 18)">
            <input
              type="number"
              min={0}
              max={20}
              value={children}
              onChange={(e) =>
                setChildren(Math.min(20, Math.max(0, Number(e.target.value))))
              }
              required
            />
          </Field>
          {Array.from({ length: children }, (_, i) => (
            <Field key={i} label={`Child ${i + 1} age`}>
              <input name={`age${i}`} type="number" min={0} max={17} required defaultValue={initial?.childAges[i]} />
            </Field>
          ))}
          <Field
            label="Total trip budget (₹)"
            hint="The budget for all travellers, not per person."
          >
            <input
              name="budget"
              defaultValue={initial?.budgetInr}
              type="number"
              min={1}
              max={100000000}
              required
            />
          </Field>
        </div>
        <h2>Travel preferences</h2>
        <div className="form-grid">
          <Field label="Hotel standard">
            <select name="hotel" defaultValue={initial?.hotelStandard ?? ""} required>
              <option value="" disabled>
                Choose a standard
              </option>
              <option value="3-star">3-star</option>
              <option value="4-star">4-star</option>
              <option value="5-star">5-star</option>
            </select>
          </Field>
          <Field label="Flights">
            <select name="flight" defaultValue={initial?.flightPreference ?? ""} required>
              <option value="" disabled>
                Choose a preference
              </option>
              <option value="direct">Direct flights</option>
              <option value="flexible">Flexible</option>
              <option value="no-flights">No flights needed</option>
            </select>
          </Field>
          <Field label="Travel pace">
            <select name="pace" defaultValue={initial?.travelPace ?? ""} required>
              <option value="" disabled>
                Choose a pace
              </option>
              <option value="relaxed">Relaxed</option>
              <option value="balanced">Balanced</option>
              <option value="active">Active</option>
            </select>
          </Field>
        </div>
        <details>
          <summary>
            Add interests, food needs or the original message (optional)
          </summary>
          <div className="form-grid preferences">
            <Field label="Interests">
              <textarea
                name="interests"
                defaultValue={initial?.interests}
                maxLength={2000}
                rows={3}
                placeholder="Beaches, culture, shopping…"
              />
            </Field>
            <Field label="Food preferences">
              <textarea
                name="food"
                defaultValue={initial?.foodPreferences}
                maxLength={1000}
                rows={3}
                placeholder="Vegetarian, allergies or other needs"
              />
            </Field>
            <Field label="Special requirements">
              <textarea name="special" maxLength={3000} rows={3} defaultValue={initial?.specialRequirements} />
            </Field>
            <Field label="Original client message">
              <textarea name="raw" maxLength={6000} rows={3} defaultValue={initial?.rawEnquiry} />
            </Field>
          </div>
        </details>
        <ErrorText text={error} />
        <div className="form-actions">
          <button className="quiet" type="button" onClick={cancel}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving enquiry…" : initial ? "Save updated enquiry" : "Save enquiry"}
          </button>
        </div>
      </form>
    </>
  );
}
function EnquiryDetail({
  id,
  back,
}: {
  id: Id<"enquiries">;
  back: () => void;
}) {
  const enquiry = useQuery(api.enquiries.getMine, { enquiryId: id });
  const update = useMutation(api.enquiries.updateOutcome);
  const [editing, setEditing] = useState<Doc<"enquiries"> | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (enquiry === undefined) return <p role="status">Loading enquiry…</p>;
  if (!enquiry)
    return (
      <>
        <p>This enquiry could not be found.</p>
        <button onClick={back}>Back to enquiries</button>
      </>
    );
  const e = enquiry;
  if (editing) return <NewEnquiry initial={editing} cancel={() => setEditing(null)} saved={() => setEditing(null)} />;
  async function change(value: "pending" | "won" | "lost") {
    setBusy(true);
    setError("");
    try {
      await update({ enquiryId: id, outcome: value });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const rows = [
    ["Client contact", e.clientContact],
    ["Departure city", e.departureCity],
    ["Travel dates", `${e.startDate} to ${e.endDate}`],
    [
      "Travellers",
      `${e.adults} adults, ${e.children} children${e.children ? ` (ages ${e.childAges.join(", ")})` : ""}`,
    ],
    [
      "Total budget",
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(e.budgetInr),
    ],
    ["Hotel standard", e.hotelStandard],
    [
      "Flights",
      {
        direct: "Direct flights",
        flexible: "Flexible",
        "no-flights": "No flights needed",
      }[e.flightPreference],
    ],
    ["Travel pace", e.travelPace],
    ["Interests", e.interests || "Not provided"],
    ["Food preferences", e.foodPreferences || "Not provided"],
    ["Special requirements", e.specialRequirements || "Not provided"],
  ];
  return (
    <>
      <button className="text-button back" onClick={back}>
        Back to enquiries
      </button>
      <div className="page-title">
        <div>
          <h1>{e.clientName}’s trip</h1>
          <p>{e.destination}</p>
        </div>
        <button className="primary" onClick={() => setEditing(e)}>Edit trip details</button>
      </div>
      <div className="notice">
        <strong>Waiting for supplier connection</strong> Your brief is saved.
        Supplier prices, availability and a branded quote are not available yet.
      </div>
      <section className="detail-sheet">
        <h2>Trip brief</h2>
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {e.rawEnquiry && (
          <div className="original">
            <h3>Original client message</h3>
            <p>{e.rawEnquiry}</p>
          </div>
        )}
      </section>
      <ItineraryDraft enquiryId={e._id} expectedUpdatedAt={e.updatedAt} />
      <QuotePanel enquiryId={e._id} />
      <section className="revision-history">
        <h2>Trip brief history</h2>
        <p>Current version {e.revisionNumber ?? 1}. Earlier saved details stay available here.</p>
        <QueryErrorBoundary key={id} failureText="Previous versions could not be loaded. Your current brief is saved." retryLabel="Retry history">
          <EnquiryHistory id={id} />
        </QueryErrorBoundary>
      </section>
      <section className="outcome-editor">
        <h2>Booking outcome</h2>
        <p>Record what happened, even if the booking was made elsewhere.</p>
        <Field label="Outcome">
          <select
            value={e.outcome}
            disabled={busy}
            onChange={(event) => {
              void change(event.target.value as "pending" | "won" | "lost");
            }}
          >
            <option value="pending">Pending</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
        </Field>
        {busy && <p role="status">Saving outcome…</p>}
        <ErrorText text={error} />
      </section>
    </>
  );
}


function EnquiryHistory({ id }: { id: Id<"enquiries"> }) {
  const revisions = useQuery(api.enquiries.listRevisions, { enquiryId: id });
  return (
    <>
      {revisions === undefined ? (
        <p role="status">Loading previous versions…</p>
      ) : revisions.length === 0 ? (
        <p>No previous versions yet.</p>
      ) : revisions.map((revision) => (
        <details key={revision._id}>
          <summary>
            Version {revision.revisionNumber} · {new Date(revision.savedAt).toLocaleString()}
          </summary>
          <PreviousBrief brief={revision.snapshot} />
        </details>
      ))}
    </>
  );
}

function PreviousBrief({ brief }: { brief: Omit<Doc<"enquiries">, "_id" | "_creationTime"> }) {
  const fields = [
    ["Client", brief.clientName], ["Client contact", brief.clientContact],
    ["Destination", brief.destination], ["Departure city", brief.departureCity],
    ["Dates", `${brief.startDate} to ${brief.endDate}`],
    ["Travellers", `${brief.adults} adults, ${brief.children} children${brief.children ? ` (ages ${brief.childAges.join(", ")})` : ""}`],
    ["Total budget", new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(brief.budgetInr)],
    ["Hotels", brief.hotelStandard],
    ["Flights", {direct:"Direct flights",flexible:"Flexible","no-flights":"No flights needed"}[brief.flightPreference]],
    ["Pace", {relaxed:"Relaxed",balanced:"Balanced",active:"Active"}[brief.travelPace]],
    ["Interests", brief.interests], ["Food preferences", brief.foodPreferences],
    ["Special requirements", brief.specialRequirements], ["Original message", brief.rawEnquiry],
  ];
  return <dl>{fields.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || "Not provided"}</dd></div>)}</dl>;
}
