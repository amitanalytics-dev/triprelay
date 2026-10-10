import React from "react";
import { createRoot } from "react-dom/client";
import QuotePanel from "../src/QuotePanel";
import QuoteReview from "../src/QuoteReview";
import "../src/styles.css";
const scenario = new URLSearchParams(location.search).get("scenario");
createRoot(document.getElementById("root")!).render(<main className="main-content">
  <div className="notice"><strong>TEST SCREEN — sample data only</strong>No supplier calls or approvals are saved.</div>
  {scenario?.startsWith("review") ? <QuoteReview /> : <QuotePanel enquiryId={"synthetic-enquiry" as never} />}
</main>);
