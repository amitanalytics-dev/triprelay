import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { itineraryDraft, itinerarySnapshot, itineraryStatus, itineraryFailureStage } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

export const MODEL = "openai/gpt-4o-mini";
export const RESERVED_PAISE = 500;
export const MAX_INPUT_BYTES = 32000;
export const MAX_INPUT_TOKENS = 40000;
export const MAX_OUTPUT_TOKENS = 6000;
export const INR_PER_USD_BUFFER = 500; // Conservative ceiling, not market FX or actual billed INR.
export const MAX_CALL_INR = (MAX_INPUT_TOKENS * 0.15 + MAX_OUTPUT_TOKENS * 0.60) / 1_000_000 * INR_PER_USD_BUFFER;
export function indiaDay(now: number) { return new Date(now + 330 * 60_000).toISOString().slice(0, 10); }
export function requireEnabled(now: number) {
  if (process.env.AI_ITINERARIES_ENABLED !== "true") throw new ConvexError("AI drafts are not enabled yet.");
  const verified = Date.parse(process.env.AI_PRICING_VERIFIED_AT ?? "");
  if (!Number.isFinite(verified) || verified > now || now - verified > 86_400_000 || MAX_CALL_INR > 5) {
    throw new ConvexError("AI pricing must be checked before another draft can run.");
  }
  if (process.env.CONVEX_INTERNAL_AI_GATEWAY_HOST) throw new ConvexError("The standard Convex AI gateway is required.");
}
export function consecutiveDates(start: string, end: string): string[] {
  const a = Date.parse(`${start}T00:00:00Z`), b = Date.parse(`${end}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(a) || !Number.isFinite(b) || new Date(a).toISOString().slice(0, 10) !== start || new Date(b).toISOString().slice(0, 10) !== end || b <= a || b-a > 90*86_400_000) throw new ConvexError("Choose valid trip dates, up to 90 nights.");
  return Array.from({length: (b-a)/86_400_000+1}, (_, i) => new Date(a+i*86_400_000).toISOString().slice(0,10));
}
export function validateUnpricedDraft(draft: {days:{date:string;title:string;activities:string[]}[];assumptions:string[];unresolvedFacts:string[]}, start:string,end:string) {
  const dates=consecutiveDates(start,end);
  if(draft.days.length!==dates.length||draft.days.some((d,i)=>d.date!==dates[i]))throw new Error("Invalid itinerary dates");
  const fields=[...draft.days.flatMap((d,i)=>[{value:d.title,path:`days[${i}].title`,unresolved:false},...d.activities.map((value,j)=>({value,path:`days[${i}].activities[${j}]`,unresolved:false}))]),...draft.assumptions.map((value,i)=>({value,path:`assumptions[${i}]`,unresolved:false})),...draft.unresolvedFacts.map((value,i)=>({value,path:`unresolvedFacts[${i}]`,unresolved:true}))];
  for(const {value,path,unresolved} of fields) {
    if(/[₹$€£]|\b(?:INR|USD|EUR|GBP|Rs\.?|rupees?|dollars?)\b|\b(?:costs?|prices?|priced|fare|rate|fees?)\b[^.!?\n]{0,40}\d|\d[^.!?\n]{0,40}\b(?:costs?|prices?|priced|fare|rate|fees?)\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value))throw new Error("Priced or private draft");
    // Permit explicit uncertainty, but reject positive service confirmations.
    for(const sentence of value.split(/[.!?;\n]+|\b(?:but|and|while|however)\b/i)) {
      // Preserve the qualifier when "subject to opening hours and availability" is split at "and".
      const conditionalOnly=/\bsubject to\b/i.test(value)&&!/\b(?:available|booked|confirmed|reserved|guaranteed|issued|secured)\b/i.test(value);
      const missingFactLabel=conditionalOnly||(unresolved&&/\b(?:availability|booking)\b/i.test(sentence)&&!/[=:]|\b(?:is|are|will|has|have|available|booked|confirmed|reserved|guaranteed|issued|secured|yes)\b/i.test(sentence));
      if(/\b(?:available|availability|booked|booking|confirmed|reserved|guaranteed|tickets? issued)\b/i.test(sentence) && !missingFactLabel && !/\b(?:not|no|unverified|unconfirmed|unknown|unresolved|unchecked|check|verify|verification|required|pending|subject to)\b/i.test(sentence))throw new Error(`Unverified availability claim at ${path}`);
    }
    if(/\b(?:TBO|TripJack|Duffel|Booking\.com)\b/i.test(value))throw new Error("Supplier identity");
  }
  const unresolved=draft.unresolvedFacts.join(" ");
  if(!/supplier|live pricing|live prices/i.test(unresolved)||!/review/i.test(unresolved))throw new Error("Missing quote limitations");
}
function privateText(value: string): string {
  // Only canonical keywords are forwarded; the original free text is never copied.
  const words = ["beach", "nature", "culture", "shopping", "adventure", "theme parks", "vegetarian", "vegan", "jain", "halal", "indian", "local"];
  return words.filter(word => new RegExp(`\\b${word}\\b`, "i").test(value)).join(", ");
}
export function snapshotOf(e: Doc<"enquiries">) {
  const cities = ["Ahmedabad", "Mumbai", "Delhi", "New Delhi", "Bengaluru", "Bangalore", "Chennai", "Kolkata", "Hyderabad", "Pune", "Surat", "Jaipur", "Kochi", "Lucknow", "Goa"];
  const departureCity = cities.find(city=>city.toLowerCase()===e.departureCity.trim().toLowerCase()) ?? "Unverified departure city; manual review required";
  const s = { destination:e.destination, departureCity, startDate:e.startDate, endDate:e.endDate, adults:e.adults, children:e.children, childAges:e.childAges, budgetInr:e.budgetInr, hotelStandard:e.hotelStandard, flightPreference:e.flightPreference, travelPace:e.travelPace, interests:privateText(e.interests), foodPreferences:privateText(e.foodPreferences), specialRequirements:"Free-text special requirements need manual review; they were not sent to AI." };
  consecutiveDates(s.startDate,s.endDate);
  if (new TextEncoder().encode(JSON.stringify(s)).length > MAX_INPUT_BYTES) throw new ConvexError("Trip preferences are too long for an AI draft.");
  return s;
}
async function owned(ctx: QueryCtx | MutationCtx, enquiryId: Id<"enquiries">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in to access your itinerary drafts.");
  const agent = await ctx.db.query("agents").withIndex("by_user",q=>q.eq("userId",userId)).unique();
  const enquiry = await ctx.db.get(enquiryId);
  if (!agent || !enquiry || enquiry.agentId !== agent._id) throw new ConvexError("This enquiry is not available.");
  return {agent,enquiry};
}
const started = v.object({runId:v.id("itineraryRuns"),status:itineraryStatus});
export const start = mutation({
  args:{enquiryId:v.id("enquiries"),expectedUpdatedAt:v.number(),requestId:v.string()}, returns:started,
  handler:async(ctx,args) => {
    const {agent,enquiry} = await owned(ctx,args.enquiryId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.requestId)) throw new ConvexError("Use a new valid draft request ID.");
    const existing = await ctx.db.query("itineraryRuns").withIndex("by_agent_request",q=>q.eq("agentId",agent._id).eq("requestId",args.requestId)).unique();
    if (existing) {
      if (existing.enquiryId!==args.enquiryId || existing.briefUpdatedAt!==args.expectedUpdatedAt) throw new ConvexError("This request ID belongs to a different brief.");
      return {runId:existing._id,status:existing.status};
    }
    if (enquiry.updatedAt!==args.expectedUpdatedAt) throw new ConvexError("This brief changed. Reload before requesting a draft.");
    const now=Date.now(); requireEnabled(now);
    for (const status of ["queued","running"] as const) if (await ctx.db.query("itineraryRuns").withIndex("by_enquiry_status",q=>q.eq("enquiryId",enquiry._id).eq("status",status)).first()) throw new ConvexError("A draft is already running for this enquiry.");
    const snapshot=snapshotOf(enquiry), day=indiaDay(now);
    const global=await ctx.db.query("itineraryDailyBudget").withIndex("by_day",q=>q.eq("day",day)).unique();
    const agency=await ctx.db.query("itineraryAgencyBudget").withIndex("by_agent_day",q=>q.eq("agentId",agent._id).eq("day",day)).unique();
    if ((global?.runs??0)>=20 || (global?.reservedPaise??0)+RESERVED_PAISE>10000) throw new ConvexError("Today's ₹100 AI draft limit has been reached. Try tomorrow.");
    if ((agency?.runs??0)>=5) throw new ConvexError("Your agency's five drafts for today have been used. Try tomorrow.");
    if(global) await ctx.db.patch(global._id,{runs:global.runs+1,reservedPaise:global.reservedPaise+RESERVED_PAISE});
    else await ctx.db.insert("itineraryDailyBudget",{day,runs:1,reservedPaise:RESERVED_PAISE});
    if(agency) await ctx.db.patch(agency._id,{runs:agency.runs+1}); else await ctx.db.insert("itineraryAgencyBudget",{agentId:agent._id,day,runs:1});
    const runId=await ctx.db.insert("itineraryRuns",{agentId:agent._id,enquiryId:enquiry._id,requestId:args.requestId,status:"queued",briefUpdatedAt:enquiry.updatedAt,createdAt:now,updatedAt:now,day,reservedPaise:RESERVED_PAISE,snapshot});
    await ctx.scheduler.runAfter(0,internal.itineraryAgent.generate,{runId});
    await ctx.scheduler.runAfter(180000,internal.itineraries.expire,{runId});
    return {runId,status:"queued" as const};
  },
});
export const listMine=query({args:{enquiryId:v.id("enquiries")},returns:v.array(v.object({_id:v.id("itineraryRuns"),status:itineraryStatus,createdAt:v.number(),updatedAt:v.number(),briefUpdatedAt:v.number(),draft:v.union(itineraryDraft,v.null()),error:v.union(v.string(),v.null())})),handler:async(ctx,args)=>{
  const {enquiry}=await owned(ctx,args.enquiryId);
  const runs=await ctx.db.query("itineraryRuns").withIndex("by_enquiry_created",q=>q.eq("enquiryId",enquiry._id)).order("desc").take(10);
  return runs.map(r=>({_id:r._id,status:r.briefUpdatedAt!==enquiry.updatedAt&&r.status==="ready"?"stale" as const:r.status,createdAt:r.createdAt,updatedAt:r.updatedAt,briefUpdatedAt:r.briefUpdatedAt,draft:r.draft??null,error:r.error??null}));
}});
export const claim=internalMutation({args:{runId:v.id("itineraryRuns")},returns:v.union(v.object({snapshot:itinerarySnapshot}),v.null()),handler:async(ctx,{runId})=>{
  const r=await ctx.db.get(runId); if(!r||r.status!=="queued")return null;
  const now=Date.now();
  if(indiaDay(now)!==r.day||now-r.createdAt>180000){await ctx.db.patch(runId,{status:"failed",updatedAt:now,error:"This draft request expired before it started. Its original daily reservation remains used."});return null;}
  const e=await ctx.db.get(r.enquiryId); if(!e||e.updatedAt!==r.briefUpdatedAt){await ctx.db.patch(runId,{status:"stale",updatedAt:Date.now()});return null;}
  await ctx.db.patch(runId,{status:"running",updatedAt:Date.now()});return {snapshot:r.snapshot};
}});
export const finish=internalMutation({args:{runId:v.id("itineraryRuns"),draft:v.optional(itineraryDraft),threadId:v.optional(v.string()),inputTokens:v.optional(v.number()),outputTokens:v.optional(v.number()),actualCostUsd:v.optional(v.number()),failureStage:v.optional(itineraryFailureStage),failureCode:v.optional(v.string())},returns:v.null(),handler:async(ctx,args)=>{
  const r=await ctx.db.get(args.runId);if(!r||r.status!=="running")return null;
  const e=await ctx.db.get(r.enquiryId), stale=!e||e.updatedAt!==r.briefUpdatedAt;
  if(args.draft)validateUnpricedDraft(args.draft,r.snapshot.startDate,r.snapshot.endDate);
  const {runId,...details}=args;
  await ctx.db.patch(runId,{...details,status:stale?"stale":args.draft?"ready":"failed",updatedAt:Date.now(),...(args.draft?{}:{error:"The AI draft could not be completed. Its daily reservation remains used."})});return null;
}});
export const expire=internalMutation({args:{runId:v.id("itineraryRuns")},returns:v.null(),handler:async(ctx,{runId})=>{const r=await ctx.db.get(runId);if(r&&(r.status==="queued"||r.status==="running"))await ctx.db.patch(runId,{status:"failed",updatedAt:Date.now(),error:"The AI draft timed out. Its daily reservation remains used."});return null;}});
export const diagnosticContext=internalQuery({args:{runId:v.id("itineraryRuns")},returns:v.union(v.object({threadId:v.string(),snapshot:itinerarySnapshot}),v.null()),handler:async(ctx,{runId})=>{const r=await ctx.db.get(runId);return r?.threadId?{threadId:r.threadId,snapshot:r.snapshot}:null;}});
export const recoverSaved=internalMutation({args:{runId:v.id("itineraryRuns"),threadId:v.string(),draft:itineraryDraft,inputTokens:v.optional(v.number()),outputTokens:v.optional(v.number())},returns:v.boolean(),handler:async(ctx,args)=>{
  const r=await ctx.db.get(args.runId);if(!r||r.status!=="failed"||r.threadId!==args.threadId)return false;
  const e=await ctx.db.get(r.enquiryId);if(!e||e.updatedAt!==r.briefUpdatedAt){await ctx.db.patch(r._id,{status:"stale",updatedAt:Date.now()});return false;}
  validateUnpricedDraft(args.draft,r.snapshot.startDate,r.snapshot.endDate);
  await ctx.db.patch(r._id,{draft:args.draft,status:"ready",updatedAt:Date.now(),error:undefined,failureStage:undefined,failureCode:undefined,...(args.inputTokens!==undefined?{inputTokens:args.inputTokens}:{}),...(args.outputTokens!==undefined?{outputTokens:args.outputTokens}:{})});return true;
}});
