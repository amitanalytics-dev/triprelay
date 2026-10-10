import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import App from "./App";
import "./styles.css";

const url = import.meta.env.VITE_CONVEX_URL;
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {url ? (
      <ConvexAuthProvider client={new ConvexReactClient(url)}>
        <App />
      </ConvexAuthProvider>
    ) : (
      <main className="setup">
        <h1>TripRelay</h1>
        <p>
          The workspace is not connected yet. Please try again after setup is
          complete.
        </p>
      </main>
    )}
  </React.StrictMode>,
);
