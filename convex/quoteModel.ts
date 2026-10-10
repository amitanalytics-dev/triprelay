import { v } from "convex/values";

export const quoteComponent = v.object({
  id: v.string(),
  kind: v.union(v.literal("hotel"), v.literal("flight"), v.literal("transfer"), v.literal("experience"), v.literal("insurance")),
  mode: v.union(v.literal("live"), v.literal("test")), available: v.boolean(),
  checkedAt: v.number(), validUntil: v.number(), currency: v.string(), supplierCostMinor: v.number(),
  minimumClientPriceMinor: v.optional(v.number()),
  compulsoryFeesConfirmed: v.boolean(), termsConfirmed: v.boolean(),
  costBasis: v.union(v.literal("verified_net"), v.literal("unverified")), gstIncluded: v.boolean(),
  // Restricted reviewer facts, never returned by agency-facing queries.
  supplierReference: v.string(), description: v.string(), terms: v.string(),
});
export const itineraryDay = v.object({ date: v.string(), title: v.string(), activities: v.array(v.string()) });
export const branding = v.object({ businessName: v.string(), contactName: v.string(),
  contactEmail: v.string(), contactPhone: v.string(), logoStorageId: v.optional(v.id("_storage")) });
export const quoteContent = {
  option: v.union(v.literal("balanced"), v.literal("lowest")),
  requiredComponentIds: v.array(v.string()), components: v.array(quoteComponent),
  unresolvedFacts: v.array(v.string()), days: v.array(itineraryDay),
  inclusions: v.array(v.string()), exclusions: v.array(v.string()),
  cancellationTerms: v.optional(v.array(v.string())),
  comparisonCoverage:v.optional(v.object({
    stays:v.array(v.object({stopIndex:v.number(),componentIds:v.array(v.string())})),
    transportComponentIds:v.array(v.string()),
    meals:v.array(v.object({meal:v.string(),componentIds:v.array(v.string())})),
  })),
};
export const comparisonChoice = v.object({startDate:v.string(),endDate:v.string(),hotelTier:v.string(),transport:v.string(),
  adults:v.number(),rooms:v.array(v.object({adults:v.number(),childAges:v.array(v.number())})),meals:v.array(v.string()),
  stops:v.array(v.object({city:v.string(),nights:v.number(),arrivalDate:v.string(),departureDate:v.string()})),departureCity:v.string(),optionId:v.string()});
export const comparisonScope = v.object({choice:comparisonChoice,leadNationality:v.string(),
  flights:v.union(v.literal("include"),v.literal("exclude")),flightRequest:v.optional(v.string())});
export const quoteVersionFields = {
  ...quoteContent, enquiryId: v.optional(v.id("enquiries")),intakeId:v.optional(v.id("intakes")),
  comparisonScope:v.optional(comparisonScope),agentId: v.id("agents"),
  comparisonEvidenceId:v.optional(v.id("quoteComparisons")),
  comparisonSourceVersionId:v.optional(v.id("quoteVersions")),
  briefRevision: v.number(), agentMarkupBps: v.number(), branding,
  requestId: v.string(), createdAt: v.number(),
};
export const agentPrices = v.object({
  currency: v.literal("INR"), agentMarkupBps: v.number(),
  items: v.array(v.object({ description: v.string(), operatorSellingPriceMinor: v.number(),
    agentMarkupBps: v.number(), agentMarginMinor: v.number(), finalClientPriceMinor: v.number() })),
  operatorSellingPriceMinor: v.number(), agentMarginMinor: v.number(), finalClientPriceMinor: v.number(),
  pricesCheckedAt: v.number(), validUntil: v.number(),
});
export const reviewFields = { quoteVersionId: v.id("quoteVersions"), reviewerUserId: v.id("users"),
  decision: v.union(v.literal("approved"), v.literal("rejected")), note: v.string(), reviewedAt: v.number() };
export const finalPrices = v.object({ currency: v.literal("INR"),
  items: v.array(v.object({ description: v.string(), finalClientPriceMinor: v.number() })),
  finalClientPriceMinor: v.number(), pricesCheckedAt: v.number(), validUntil: v.number() });
