/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents from "../agents.js";
import type * as auth from "../auth.js";
import type * as enquiries from "../enquiries.js";
import type * as flightPreparation from "../flightPreparation.js";
import type * as flightPreparationModel from "../flightPreparationModel.js";
import type * as flightRecheckAction from "../flightRecheckAction.js";
import type * as flightRechecks from "../flightRechecks.js";
import type * as flightSearch from "../flightSearch.js";
import type * as flightWorkflow from "../flightWorkflow.js";
import type * as flightWorkflowManager from "../flightWorkflowManager.js";
import type * as hotelPreparation from "../hotelPreparation.js";
import type * as hotelPreparationModel from "../hotelPreparationModel.js";
import type * as hotelRecheckAction from "../hotelRecheckAction.js";
import type * as hotelRechecks from "../hotelRechecks.js";
import type * as hotelSearch from "../hotelSearch.js";
import type * as http from "../http.js";
import type * as intakes from "../intakes.js";
import type * as itineraries from "../itineraries.js";
import type * as itineraryAgent from "../itineraryAgent.js";
import type * as logos from "../logos.js";
import type * as metrics from "../metrics.js";
import type * as quoteModel from "../quoteModel.js";
import type * as quotePdf from "../quotePdf.js";
import type * as quoteSources from "../quoteSources.js";
import type * as quotes from "../quotes.js";
import type * as supplierRuns from "../supplierRuns.js";
import type * as tbo from "../tbo.js";
import type * as tboTransport from "../tboTransport.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  auth: typeof auth;
  enquiries: typeof enquiries;
  flightPreparation: typeof flightPreparation;
  flightPreparationModel: typeof flightPreparationModel;
  flightRecheckAction: typeof flightRecheckAction;
  flightRechecks: typeof flightRechecks;
  flightSearch: typeof flightSearch;
  flightWorkflow: typeof flightWorkflow;
  flightWorkflowManager: typeof flightWorkflowManager;
  hotelPreparation: typeof hotelPreparation;
  hotelPreparationModel: typeof hotelPreparationModel;
  hotelRecheckAction: typeof hotelRecheckAction;
  hotelRechecks: typeof hotelRechecks;
  hotelSearch: typeof hotelSearch;
  http: typeof http;
  intakes: typeof intakes;
  itineraries: typeof itineraries;
  itineraryAgent: typeof itineraryAgent;
  logos: typeof logos;
  metrics: typeof metrics;
  quoteModel: typeof quoteModel;
  quotePdf: typeof quotePdf;
  quoteSources: typeof quoteSources;
  quotes: typeof quotes;
  supplierRuns: typeof supplierRuns;
  tbo: typeof tbo;
  tboTransport: typeof tboTransport;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
