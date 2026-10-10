import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { agentPrices, quoteVersionFields, reviewFields } from "./quoteModel";
import {hotelSearchSettings,hotelSearchRequest,hotelSearchState} from "./hotelPreparationModel";
import {flightSearchSettings,flightSearchRequest} from "./flightPreparationModel";

export const profileFields = {
  userId: v.id("users"),
  businessName: v.string(),
  contactName: v.string(),
  contactPhone: v.string(),
  contactEmail: v.string(),
  defaultMarkupPercent: v.number(),
  logoStorageId: v.optional(v.id("_storage")),
  updatedAt: v.number(),
};

export const destination = v.union(
  v.literal("Thailand"),
  v.literal("Vietnam"),
  v.literal("Bali"),
);
export const outcome = v.union(
  v.literal("pending"),
  v.literal("won"),
  v.literal("lost"),
);
export const enquiryInputFields = {
  clientName: v.string(),
  clientContact: v.string(),
  destination,
  departureCity: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  adults: v.number(),
  children: v.number(),
  childAges: v.array(v.number()),
  budgetInr: v.number(),
  hotelStandard: v.union(
    v.literal("3-star"),
    v.literal("4-star"),
    v.literal("5-star"),
  ),
  flightPreference: v.union(
    v.literal("direct"),
    v.literal("flexible"),
    v.literal("no-flights"),
  ),
  travelPace: v.union(
    v.literal("relaxed"),
    v.literal("balanced"),
    v.literal("active"),
  ),
  interests: v.string(),
  foodPreferences: v.string(),
  specialRequirements: v.string(),
  rawEnquiry: v.optional(v.string()),
};
export const enquiryFields = {
  ...enquiryInputFields,
  agentId: v.id("agents"),
  status: v.literal("awaiting_supplier"),
  outcome,
  createdAt: v.number(),
  updatedAt: v.number(),
  revisionNumber: v.optional(v.number()),
};

export const enquiryRevisionFields = {
  enquiryId: v.id("enquiries"),
  agentId: v.id("agents"),
  revisionNumber: v.number(),
  savedAt: v.number(),
  snapshot: v.object(enquiryFields),
};

export const foundationStep = v.union(
  v.literal("profile_saved"),
  v.literal("brief_saved"),
  v.literal("brief_revised"),
);

export const itineraryStatus = v.union(v.literal("queued"), v.literal("running"), v.literal("ready"), v.literal("failed"), v.literal("stale"));
export const itineraryFailureStage = v.union(v.literal("setup"),v.literal("generation"),v.literal("validation"),v.literal("save"));
export const itineraryDraft = v.object({
  days: v.array(v.object({ date: v.string(), title: v.string(), activities: v.array(v.string()) })),
  assumptions: v.array(v.string()),
  unresolvedFacts: v.array(v.string()),
});
// Explicit allowlist: no client name/contact, agency identity or raw enquiry.
export const itinerarySnapshot = v.object({
  destination, departureCity: v.string(), startDate: v.string(), endDate: v.string(),
  adults: v.number(), children: v.number(), childAges: v.array(v.number()), budgetInr: v.number(),
  hotelStandard: v.string(), flightPreference: v.string(), travelPace: v.string(),
  interests: v.string(), foodPreferences: v.string(), specialRequirements: v.string(),
});

export const intakeFactsFields = {
  destination: v.optional(v.literal("Vietnam")),
  adults: v.optional(v.number()), nights: v.optional(v.number()), departureCity: v.optional(v.string()),
  startDates: v.array(v.string()),
  hotelTiers: v.array(v.union(v.literal("3-star"),v.literal("4-star"),v.literal("5-star"))),
  transportOptions: v.array(v.union(v.literal("private"),v.literal("shared"))),
  meals: v.array(v.union(v.literal("breakfast"),v.literal("lunch"),v.literal("dinner"))),
  routeStops: v.array(v.object({city:v.string(),nights:v.optional(v.number())})),
  rooms: v.array(v.object({adults:v.number(),childAges:v.array(v.number())})),
};
export const intakeFacts = v.object(intakeFactsFields);
export const intakeQuestion = v.object({field:v.string(),prompt:v.string()});
export const intakeStatus = v.union(v.literal("needs_confirmation"),v.literal("needs_details"),v.literal("complete_brief"));
export const intakeSupplierFacts = v.object({
  leadNationality:v.optional(v.string()),
  flights:v.optional(v.union(v.literal("include"),v.literal("exclude"))),
  flightRequest:v.optional(v.string()),
  childAgesAtTravelConfirmed:v.optional(v.boolean()),
});

export default defineSchema({
  ...authTables,
  intakes: defineTable({
    agentId:v.id("agents"), requestId:v.string(), originalMessage:v.string(),
    candidates:intakeFacts, facts:intakeFacts, factsConfirmed:v.boolean(), status:intakeStatus,
    sourceHints:v.optional(v.array(v.object({field:v.string(),snippet:v.string()}))),
    revisionNumber:v.number(), createdAt:v.number(), updatedAt:v.number(),
    supplierFacts:v.optional(intakeSupplierFacts),supplierFactsRevision:v.optional(v.number()),
  }).index("by_agent_created",["agentId","createdAt"]).index("by_agent_request",["agentId","requestId"]).index("by_created",["createdAt"]),
  intakeRevisions:defineTable({intakeId:v.id("intakes"),agentId:v.id("agents"),revisionNumber:v.number(),
    facts:intakeFacts,factsConfirmed:v.boolean(),status:intakeStatus,supplierFacts:v.optional(intakeSupplierFacts),savedAt:v.number()})
    .index("by_intake_revision",["intakeId","revisionNumber"]),
  itineraryRuns: defineTable({
    agentId: v.id("agents"), enquiryId: v.id("enquiries"), requestId: v.string(),
    status: itineraryStatus, briefUpdatedAt: v.number(), createdAt: v.number(), updatedAt: v.number(),
    day: v.string(), reservedPaise: v.number(), snapshot: itinerarySnapshot,
    draft: v.optional(itineraryDraft), error: v.optional(v.string()), threadId: v.optional(v.string()),
    inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()), actualCostUsd: v.optional(v.number()),
    failureStage: v.optional(itineraryFailureStage), failureCode: v.optional(v.string()),
  }).index("by_agent_request", ["agentId", "requestId"])
    .index("by_enquiry_created", ["enquiryId", "createdAt"])
    .index("by_enquiry_status", ["enquiryId", "status"]),
  itineraryDailyBudget: defineTable({ day: v.string(), runs: v.number(), reservedPaise: v.number() }).index("by_day", ["day"]),
  itineraryAgencyBudget: defineTable({ agentId: v.id("agents"), day: v.string(), runs: v.number() }).index("by_agent_day", ["agentId", "day"]),
  agents: defineTable(profileFields).index("by_user", ["userId"]),
  enquiries: defineTable(enquiryFields)
    .index("by_agent_created", ["agentId", "createdAt"])
    .index("by_agent_status", ["agentId", "status"]),
  enquiryRevisions: defineTable(enquiryRevisionFields)
    .index("by_enquiry_created", ["enquiryId", "savedAt"]),
  quoteComparisons: defineTable({intakeId:v.id("intakes"),agentId:v.id("agents"),briefRevision:v.number(),
    versionIds:v.array(v.id("quoteVersions")),lowestOptionIds:v.array(v.string()),
    finalClientPriceMinor:v.number(),validUntil:v.number(),createdAt:v.number()}),
  hotelPreparations:defineTable({intakeId:v.id("intakes"),agentId:v.id("agents"),briefRevision:v.number(),requestId:v.string(),settings:hotelSearchSettings,
    requests:v.array(hotelSearchRequest),optionCount:v.number(),requiredChecks:v.array(v.string()),createdAt:v.number()})
    .index("by_intake_request",["intakeId","requestId"]).index("by_intake_created",["intakeId","createdAt"]),
  flightPreparations:defineTable({intakeId:v.id("intakes"),agentId:v.id("agents"),briefRevision:v.number(),requestId:v.string(),settings:flightSearchSettings,
    requests:v.array(flightSearchRequest),optionCount:v.number(),requiredChecks:v.array(v.string()),createdAt:v.number()})
    .index("by_intake_request",["intakeId","requestId"]).index("by_intake_created",["intakeId","createdAt"]),
  flightSearchRuns:defineTable({preparationId:v.id("flightPreparations"),requestId:v.string(),status:hotelSearchState,attempt:v.number(),
    startedAt:v.number(),finishedAt:v.optional(v.number()),failureCode:v.optional(v.string()),resultJson:v.optional(v.string())})
    .index("by_preparation_request",["preparationId","requestId"]).index("by_preparation",["preparationId"]),
  flightRecheckRuns:defineTable({preparationId:v.id("flightPreparations"),requestId:v.string(),sourceRequestId:v.string(),rateIndices:v.array(v.number()),
    searchAttempt:v.number(),selectedJson:v.string(),selectionKey:v.optional(v.string()),status:hotelSearchState,startedAt:v.number(),workflowId:v.optional(v.string()),
    finishedAt:v.optional(v.number()),failureCode:v.optional(v.string())}).index("by_preparation_request",["preparationId","requestId"])
    .index("by_preparation_source_selection",["preparationId","sourceRequestId","selectionKey"])
    .index("by_preparation_source",["preparationId","sourceRequestId"]),
  flightRecheckParts:defineTable({runId:v.id("flightRecheckRuns"),slot:v.number(),stage:v.union(v.literal("fare"),v.literal("terms")),
    resultJson:v.optional(v.string()),checkedAt:v.number(),status:v.optional(hotelSearchState),startedAt:v.optional(v.number())})
    .index("by_run_slot_stage",["runId","slot","stage"]),
  hotelSearchRuns:defineTable({preparationId:v.id("hotelPreparations"),requestId:v.string(),status:hotelSearchState,attempt:v.number(),
    startedAt:v.number(),finishedAt:v.optional(v.number()),failureCode:v.optional(v.string()),resultJson:v.optional(v.string())})
    .index("by_preparation_request",["preparationId","requestId"]).index("by_preparation",["preparationId"]),
  hotelRecheckRuns:defineTable({preparationId:v.id("hotelPreparations"),requestId:v.string(),sourceRequestId:v.string(),rateIndex:v.number(),
    searchAttempt:v.number(),selectedJson:v.string(),status:hotelSearchState,attempt:v.number(),startedAt:v.number(),
    finishedAt:v.optional(v.number()),failureCode:v.optional(v.string()),resultJson:v.optional(v.string())})
    .index("by_preparation_request",["preparationId","requestId"]).index("by_preparation_source",["preparationId","sourceRequestId"]),
  quoteVersions: defineTable(quoteVersionFields)
    .index("by_intake_created",["intakeId","createdAt"])
    .index("by_intake_request",["intakeId","requestId"])
    .index("by_created", ["createdAt"])
    .index("by_enquiry_created", ["enquiryId", "createdAt"])
    .index("by_enquiry_request", ["enquiryId", "requestId"]),
  quoteReviews: defineTable(reviewFields).index("by_version_time", ["quoteVersionId", "reviewedAt"]),
  quoteApprovalCounts: defineTable({ quoteVersionId: v.id("quoteVersions"), countedAt: v.number() })
    .index("by_version", ["quoteVersionId"]),
  quoteReviewCounter: defineTable({ scope: v.literal("global"), approvedVersions: v.number() })
    .index("by_scope", ["scope"]),
  quoteReviewerGrants: defineTable({ userId: v.id("users"), active: v.boolean(), confirmedAt: v.number() })
    .index("by_user", ["userId"]),
  quoteReleases: defineTable({ quoteVersionId: v.id("quoteVersions"), agentId: v.id("agents"),
    reviewId: v.id("quoteReviews"), prices: agentPrices, releasedAt: v.number() })
    .index("by_version", ["quoteVersionId"]),
  quotePdfArtifacts: defineTable({ quoteVersionId: v.id("quoteVersions"), agentId: v.id("agents"),
    formatVersion: v.literal(1), storageId: v.id("_storage"), createdAt: v.number() })
    .index("by_version_format", ["quoteVersionId", "formatVersion"]),
  // Only anonymous step facts: no user, agency, enquiry or contact identifiers.
  foundationEvents: defineTable({
    step: foundationStep,
    occurredAt: v.number(),
    day: v.string(),
    isTest: v.boolean(),
  }).index("by_day_test_time", ["day", "isTest", "occurredAt"]),
});
