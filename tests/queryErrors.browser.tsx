import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import QueryErrorBoundary from "../src/QueryErrorBoundary";

function QueryRead({ fail, label }: { fail: boolean; label: string }) {
  if (fail) throw new Error(`Deliberate ${label} read failure for recovery test`);
  return <p>{label} read recovered</p>;
}

function RecoveryChecks() {
  const [fault, setFault] = useState<"list" | "history" | null>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState("Not run");
  function run() {
    try {
      flushSync(() => setInput("Unsaved edit survives both retries"));
      for (const scope of ["list", "history"] as const) {
        flushSync(() => setFault(scope));
        const region = document.querySelector(`[data-scope=${scope}]`)!;
        if (!region.querySelector('[role="alert"]')) throw new Error(`${scope} fallback missing`);
        if (!document.querySelector("#saved-brief")) throw new Error("Current brief hidden");
        const field = document.querySelector<HTMLInputElement>("#unsaved-input")!;
        if (field.value !== "Unsaved edit survives both retries") throw new Error("Unsaved input lost on failure");
        flushSync(() => setFault(null));
        flushSync(() => region.querySelector<HTMLButtonElement>("button")!.click());
        if (region.querySelector('[role="alert"]') || !region.textContent?.includes("read recovered")) throw new Error(`${scope} retry failed`);
        if (field.value !== "Unsaved edit survives both retries") throw new Error("Unsaved input lost on retry");
      }
      setResult("PASS: both failure messages appear; both retries recover; current brief and unsaved input remain.");
    } catch (error) { setResult(`FAIL: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return <main><h1>Query boundary recovery checks</h1><p>Local test harness: deliberate child render failures with real React. No network, database, AI or saved trips are touched. This verifies isolation and retry rendering; live Convex subscription recovery requires a separate app check.</p>
    <p id="saved-brief">Current saved brief remains visible</p>
    <label>Unsaved input <input id="unsaved-input" value={input} onChange={e => setInput(e.target.value)} /></label>
    <section data-scope="list"><QueryErrorBoundary failureText="Saved enquiries could not be loaded. Your saved trips are unchanged." retryLabel="Retry enquiries"><QueryRead fail={fault === "list"} label="List" /></QueryErrorBoundary></section>
    <section data-scope="history"><QueryErrorBoundary failureText="Previous versions could not be loaded. Your current brief is saved." retryLabel="Retry history"><QueryRead fail={fault === "history"} label="History" /></QueryErrorBoundary></section>
    <button type="button" onClick={run}>Run boundary checks</button><p role="status">{result}</p>
  </main>;
}
createRoot(document.getElementById("root")!).render(<RecoveryChecks />);
