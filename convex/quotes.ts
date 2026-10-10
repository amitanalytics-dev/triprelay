import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { agentPrices, branding, comparisonChoice, finalPrices, itineraryDay, quoteContent, quoteVersionFields } from "./quoteModel";
import { checkQuoteReadiness } from "../lib/quoteReadiness.cjs";
import { assembleAgentQuote } from "../lib/quoteAssembly.cjs";
import { buildComparisonPlan } from "../lib/comparisonPlan.cjs";
import { compareReviewedChoices } from "../lib/quoteComparison.cjs";
import { nextQuestion, supplierQuestion } from "./intakes";

async function ownAgent(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Please sign in to see your quotes.");
  const agent = await ctx.db.query("agents").withIndex("by_user", q => q.eq("userId", userId)).unique();
  if (!agent) throw new ConvexError("Save your agency details first.");
  return agent;
}
async function isReviewer(ctx: QueryCtx, userId: Id<"users">) {
  const grant = await ctx.db.query("quoteReviewerGrants").withIndex("by_user", q => q.eq("userId", userId)).unique();
  return grant?.active === true;
}
async function reviewer(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId || !await isReviewer(ctx, userId)) throw new ConvexError("Quote review is restricted to the designated reviewer.");
  return userId;
}
export const requireQuoteReviewer=reviewer;
async function latestReview(ctx: QueryCtx, versionId: Id<"quoteVersions">) {
  return await ctx.db.query("quoteReviews").withIndex("by_version_time", q => q.eq("quoteVersionId", versionId)).order("desc").first();
}
type SourceBrief={startDate:string;endDate:string;flightPreference:string;sourceProblems?:string[]};
function contentProblems(version: Doc<"quoteVersions">, enquiry: SourceBrief) {
  const reasons: string[] = [...(enquiry.sourceProblems??[])];

  if(version.intakeId && version.comparisonScope){
    const scope=version.comparisonScope.choice,coverage=version.comparisonCoverage;
    const references=(ids:string[],kinds:string[])=>ids.length>0 && new Set(ids).size===ids.length && ids.every(id=>version.components.some(component=>component.id===id && kinds.includes(component.kind)));
    const requiredStops=scope.stops.map((stop,index)=>stop.nights>0?index:-1).filter(index=>index>=0);
    if(!coverage || coverage.stays.length!==requiredStops.length || new Set(coverage.stays.map(stay=>stay.stopIndex)).size!==requiredStops.length ||
      coverage.stays.some(stay=>!requiredStops.includes(stay.stopIndex) || !references(stay.componentIds,["hotel"])) ||
      !references(coverage.transportComponentIds,["transfer"]) || coverage.meals.length!==scope.meals.length ||
      new Set(coverage.meals.map(meal=>meal.meal)).size!==scope.meals.length ||
      coverage.meals.some(meal=>!scope.meals.includes(meal.meal) || !references(meal.componentIds,["hotel","experience"]))) {
      reasons.push("Verify priced component coverage for every overnight stop, the requested transport and every required meal.");
    }
  }
  if (version.components.some(component => component.costBasis !== "verified_net" || component.gstIncluded !== true)) {
    reasons.push("Verify NET supplier cost and GST-inclusive final-price treatment for every component.");
  }
  const start = Date.parse(`${enquiry.startDate}T00:00:00Z`);
  const end = Date.parse(`${enquiry.endDate}T00:00:00Z`);
  const expectedDays = (end - start) / 86400000 + 1;
  if (version.days.length !== expectedDays || version.days.some((day, index) =>
    day.date !== new Date(start + index * 86400000).toISOString().slice(0, 10) || !day.title.trim() ||
    !day.activities.length || day.activities.some(activity => !activity.trim()))) {
    reasons.push("Complete the day-by-day itinerary for the saved travel dates.");
  }
  if (!version.inclusions.length || !version.exclusions.length ||
    [...version.inclusions, ...version.exclusions].some(text => !text.trim()) ||
    version.components.some(component => !component.description.trim() || !component.terms.trim() || !component.supplierReference.trim())) {
    reasons.push("Complete the component descriptions, verified terms, inclusions and exclusions.");
  }
  if (!version.cancellationTerms?.length || version.cancellationTerms.some(text => !text.trim())) {
    reasons.push("Confirm the client-facing cancellation terms before approval.");
  }
  if (!version.components.some(component => component.kind === "hotel") ||
    (enquiry.flightPreference !== "no-flights" && !version.components.some(component => component.kind === "flight"))) {
    reasons.push("Include the hotel and any flights required by this trip brief.");
  }
  if (enquiry.flightPreference === "no-flights" && version.components.some(component => component.kind === "flight")) {
    reasons.push("Remove flights from this no-flights trip brief.");
  }
  return reasons;
}
async function candidate(ctx: QueryCtx, version: Doc<"quoteVersions">, review: Doc<"quoteReviews"> | null) {
  let enquiry:SourceBrief,currentBriefRevision:number,comparisonValidUntil:number|undefined;
  if(version.intakeId && !version.enquiryId){
    const intake=await ctx.db.get(version.intakeId),scope=version.comparisonScope;
    if(!intake || intake.agentId!==version.agentId || !scope)throw new ConvexError("Quote not found.");
    const sourceProblems:string[]=[];
    if(!intake.factsConfirmed || intake.status!=="complete_brief" || nextQuestion(intake.facts,true))sourceProblems.push("Confirm the complete comparison brief before delivering a quote.");
    if(supplierQuestion(intake.facts,intake.supplierFacts??{}))sourceProblems.push("Confirm the missing customer supplier-search details.");
    let currentChoice;
    try{currentChoice=buildComparisonPlan(intake.facts).options.find(choice=>choice.optionId===scope.choice.optionId);}catch{ /* The source problem above blocks incomplete facts. */ }
    const key=(choice:typeof scope.choice)=>JSON.stringify([choice.optionId,choice.startDate,choice.endDate,choice.hotelTier,choice.transport,
      choice.adults,choice.departureCity,choice.meals,choice.rooms.map(room=>[room.adults,room.childAges]),
      choice.stops.map(stop=>[stop.city,stop.nights,stop.arrivalDate,stop.departureDate])]);
    if(!currentChoice || key(currentChoice)!==key(scope.choice))sourceProblems.push("This quote must match a current confirmed comparison choice.");
    enquiry={startDate:scope.choice.startDate,endDate:scope.choice.endDate,flightPreference:scope.flights==="exclude"?"no-flights":"include-flights",sourceProblems};
    currentBriefRevision=intake.revisionNumber;
  }else if(version.enquiryId && !version.intakeId){
    const source=await ctx.db.get(version.enquiryId);
    if(!source || source.agentId!==version.agentId)throw new ConvexError("Quote not found.");
    enquiry=source;currentBriefRevision=source.revisionNumber??1;
  }else throw new ConvexError("Quote not found.");
  if(version.option==="lowest"){
    const problem=await lowestEvidenceProblem(ctx,version);
    if(problem)enquiry.sourceProblems=[...(enquiry.sourceProblems??[]),problem];
    else comparisonValidUntil=(await ctx.db.get(version.comparisonEvidenceId!))!.validUntil;
  }
  return { value: { ...version, versionId: version._id, currentBriefRevision,
    ...(comparisonValidUntil!==undefined?{comparisonValidUntil}:{}),
    review: review ? { status: review.decision, versionId: review.quoteVersionId,
      briefRevision: version.briefRevision, reviewedAt: review.reviewedAt,
      authorized: await isReviewer(ctx, review.reviewerUserId) } : null }, enquiry };
}

// Trusted supplier/itinerary processing is the only creation path. No public
// mutation accepts supplier costs, live flags, deadlines or review permission.
export const saveVersion = internalMutation({
  args: { enquiryId: v.id("enquiries"), expectedBriefRevision: v.number(), requestId: v.string(), ...quoteContent },
  returns: v.id("quoteVersions"),
  handler: async (ctx, args) => {
    const enquiry = await ctx.db.get(args.enquiryId);
    if (!enquiry || args.expectedBriefRevision !== (enquiry.revisionNumber ?? 1)) throw new ConvexError("The trip brief changed. Prepare a new quote version.");
    const agent = await ctx.db.get(enquiry.agentId);
    if (!agent) throw new ConvexError("Agency not found.");
    if (!args.requestId.trim() || args.requestId.length > 100 || args.components.length > 100 ||
      args.requiredComponentIds.length > 100 || args.days.length > 91 ||
      args.days.some(day => day.activities.length > 20) || args.unresolvedFacts.length > 100 ||
      args.inclusions.length > 100 || args.exclusions.length > 100 || (args.cancellationTerms?.length ?? 0) > 100 || JSON.stringify(args).length > 100000) {
      throw new ConvexError("Quote content exceeds the allowed size.");
    }
    const { expectedBriefRevision, ...content } = args;
    const existing = await ctx.db.query("quoteVersions").withIndex("by_enquiry_request", q =>
      q.eq("enquiryId", args.enquiryId).eq("requestId", args.requestId)).unique();
    if (existing) {
      for (const key of Object.keys(content) as (keyof typeof content)[]) {
        if (JSON.stringify(existing[key]) !== JSON.stringify(content[key])) throw new ConvexError("This quote request already saved different content. Use a new request.");
      }
      return existing._id;
    }
    const agentMarkupBps = Math.round(agent.defaultMarkupPercent * 100);
    if (!Number.isSafeInteger(agentMarkupBps) || agentMarkupBps < 0) throw new ConvexError("The agency markup is invalid.");
    return await ctx.db.insert("quoteVersions", { ...content, agentId: agent._id,
      briefRevision: expectedBriefRevision, agentMarkupBps,
      branding: { businessName: agent.businessName, contactName: agent.contactName,
        contactEmail: agent.contactEmail, contactPhone: agent.contactPhone,
        ...(agent.logoStorageId ? { logoStorageId: agent.logoStorageId } : {}) }, createdAt: Date.now() });
  },
});
export const saveIntakeVersion=internalMutation({
  args:{intakeId:v.id("intakes"),expectedBriefRevision:v.number(),comparisonOptionId:v.string(),requestId:v.string(),...quoteContent},
  returns:v.id("quoteVersions"),
  handler:async(ctx,args)=>{
    const intake=await ctx.db.get(args.intakeId);
    if(!intake || intake.revisionNumber!==args.expectedBriefRevision)throw new ConvexError("The intake changed. Prepare a new quote version.");
    if(!intake.factsConfirmed || intake.status!=="complete_brief" || nextQuestion(intake.facts,true) || supplierQuestion(intake.facts,intake.supplierFacts??{}))throw new ConvexError("Confirm the comparison brief and customer supplier-search details first.");
    const choice=buildComparisonPlan(intake.facts).options.find(option=>option.optionId===args.comparisonOptionId);
    if(!choice)throw new ConvexError("Choose a confirmed comparison option without discarding alternatives.");
    const agent=await ctx.db.get(intake.agentId);if(!agent)throw new ConvexError("Agency not found.");
    validateContentSize(args);
    const {expectedBriefRevision,comparisonOptionId,...content}=args;
    const existing=await ctx.db.query("quoteVersions").withIndex("by_intake_request",q=>q.eq("intakeId",args.intakeId).eq("requestId",args.requestId)).unique();
    if(existing){
      if(existing.briefRevision!==expectedBriefRevision || existing.comparisonScope?.choice.optionId!==comparisonOptionId || Object.keys(content).some(key=>JSON.stringify(existing[key as keyof typeof existing])!==JSON.stringify(content[key as keyof typeof content])))throw new ConvexError("This request already saved a different quote. Use a new request.");
      return existing._id;
    }
    const agentMarkupBps=Math.round(agent.defaultMarkupPercent*100);
    if(!Number.isSafeInteger(agentMarkupBps) || agentMarkupBps<0)throw new ConvexError("The agency markup is invalid.");
    return ctx.db.insert("quoteVersions",{...content,agentId:agent._id,briefRevision:expectedBriefRevision,agentMarkupBps,
      comparisonScope:{choice,leadNationality:intake.supplierFacts!.leadNationality!,flights:intake.supplierFacts!.flights!,
        ...(intake.supplierFacts?.flightRequest?{flightRequest:intake.supplierFacts.flightRequest}:{})},
      branding:{businessName:agent.businessName,contactName:agent.contactName,contactEmail:agent.contactEmail,contactPhone:agent.contactPhone,
        ...(agent.logoStorageId?{logoStorageId:agent.logoStorageId}:{})},createdAt:Date.now()});
  },
});
function validateContentSize(args:{requestId:string;components:unknown[];requiredComponentIds:string[];days:{activities:string[]}[];unresolvedFacts:string[];inclusions:string[];exclusions:string[];cancellationTerms?:string[]}){
  if(!args.requestId.trim() || args.requestId.length>100 || args.components.length>100 || args.requiredComponentIds.length>100 || args.days.length>91 ||
    args.days.some(day=>day.activities.length>20) || args.unresolvedFacts.length>100 || args.inclusions.length>100 || args.exclusions.length>100 || (args.cancellationTerms?.length??0)>100 || JSON.stringify(args).length>100000)throw new ConvexError("Quote content exceeds the allowed size.");
}

async function comparisonAssessment(ctx:QueryCtx,intakeId:Id<"intakes">){
    const intake=await ctx.db.get(intakeId);
    const blocked=(expectedCount=0,readyCount=0,reason="Confirm the complete comparison brief and customer search details.")=>
      ({complete:false,expectedCount,readyCount,lowestOptionIds:[],finalClientPriceMinor:null,validUntil:null,reason,versionIds:[] as Id<"quoteVersions">[]});
    if(!intake || !intake.factsConfirmed || intake.status!=="complete_brief" || nextQuestion(intake.facts,true) ||
      supplierQuestion(intake.facts,intake.supplierFacts??{}))return blocked();
    const choices=buildComparisonPlan(intake.facts).options;
    const versions=await ctx.db.query("quoteVersions").withIndex("by_intake_created",q=>q.eq("intakeId",intakeId)).order("desc").take(201);
    if(versions.length>200)return blocked(choices.length,0,"Comparison history exceeds this bounded check; prepare a current comparison batch.");
    const now=Date.now(),assessments=[],versionIds:Id<"quoteVersions">[]=[];
    for(const choice of choices){
      const version=versions.find(row=>row.option==="balanced" && row.briefRevision===intake.revisionNumber && row.comparisonScope?.choice.optionId===choice.optionId);
      if(!version)continue;
      const review=await latestReview(ctx,version._id),{value,enquiry}=await candidate(ctx,version,review);
      if(!checkQuoteReadiness(value,now).ready || contentProblems(version,enquiry).length)continue;
      try{
        const prices=assembleAgentQuote(value,now);
        versionIds.push(version._id);
        assessments.push({optionId:choice.optionId,ready:true,currency:prices.currency,
          agentMarkupBps:prices.agentMarkupBps,finalClientPriceMinor:prices.finalClientPriceMinor,validUntil:prices.validUntil});
      }catch{ /* Incomplete price evidence cannot become a comparison winner. */ }
    }
    const result=compareReviewedChoices(choices.map(choice=>choice.optionId),assessments,now);
    return {...result,versionIds,expectedCount:choices.length,readyCount:assessments.length,
      reason:result.complete?"":"Every requested alternative needs a complete, fresh reviewed quote at the same markup."};
}
export const assessIntakeComparison=internalQuery({
  args:{intakeId:v.id("intakes")},
  returns:v.object({complete:v.boolean(),expectedCount:v.number(),readyCount:v.number(),
    lowestOptionIds:v.array(v.string()),finalClientPriceMinor:v.union(v.number(),v.null()),
    validUntil:v.union(v.number(),v.null()),reason:v.string()}),
  handler:async(ctx,args)=>{const {versionIds,...result}=await comparisonAssessment(ctx,args.intakeId);return result;},
});
async function lowestEvidenceProblem(ctx:QueryCtx,version:Doc<"quoteVersions">){
  const problem="Complete verified comparison pricing is required before this can be called the lowest-price option.";
  if(!version.intakeId || !version.comparisonEvidenceId || !version.comparisonSourceVersionId)return problem;
  const evidence=await ctx.db.get(version.comparisonEvidenceId),source=await ctx.db.get(version.comparisonSourceVersionId);
  if(!evidence || !source || source.option!=="balanced" || source.intakeId!==version.intakeId ||
    evidence.intakeId!==version.intakeId || evidence.agentId!==version.agentId || evidence.briefRevision!==version.briefRevision ||
    !evidence.versionIds.includes(source._id) || !evidence.lowestOptionIds.includes(source.comparisonScope?.choice.optionId??""))return problem;
  // The lowest-labelled version must preserve exactly the compared source;
  // human review is still separately required for this newly labelled version.
  const snapshot=(row:Doc<"quoteVersions">)=>{
    const {_id,_creationTime,option,requestId,createdAt,comparisonEvidenceId,comparisonSourceVersionId,...content}=row;
    return JSON.stringify(content);
  };
  if(snapshot(version)!==snapshot(source))return problem;
  const current=await comparisonAssessment(ctx,version.intakeId);
  if(!current.complete || current.finalClientPriceMinor!==evidence.finalClientPriceMinor ||
    current.validUntil!==evidence.validUntil || JSON.stringify(current.versionIds)!==JSON.stringify(evidence.versionIds) ||
    JSON.stringify(current.lowestOptionIds)!==JSON.stringify(evidence.lowestOptionIds))return problem;
  return null;
}
export const saveLowestIntakeVersion=internalMutation({
  args:{intakeId:v.id("intakes"),expectedBriefRevision:v.number(),comparisonOptionId:v.string(),requestId:v.string()},
  returns:v.id("quoteVersions"),
  handler:async(ctx,args)=>{
    if(!args.requestId.trim() || args.requestId.length>100)throw new ConvexError("Use a valid quote request.");
    const intake=await ctx.db.get(args.intakeId);
    if(!intake || intake.revisionNumber!==args.expectedBriefRevision)throw new ConvexError("The intake changed. Prepare a new comparison.");
    const comparison=await comparisonAssessment(ctx,args.intakeId);
    if(!comparison.complete || comparison.finalClientPriceMinor===null || comparison.validUntil===null ||
      !comparison.lowestOptionIds.includes(args.comparisonOptionId))throw new ConvexError("Every requested alternative must have fresh complete reviewed pricing before selecting its lowest-price choice.");
    const versions=await Promise.all(comparison.versionIds.map(id=>ctx.db.get(id)));
    const source=versions.find(row=>row?.comparisonScope?.choice.optionId===args.comparisonOptionId);
    if(!source)throw new ConvexError("Compared quote not found.");
    const existing=await ctx.db.query("quoteVersions").withIndex("by_intake_request",q=>q.eq("intakeId",args.intakeId).eq("requestId",args.requestId)).unique();
    if(existing){
      if(existing.option!=="lowest" || existing.briefRevision!==args.expectedBriefRevision || existing.comparisonSourceVersionId!==source._id ||
        await lowestEvidenceProblem(ctx,existing))throw new ConvexError("This request already saved a different or outdated comparison. Use a new request.");
      return existing._id;
    }
    const evidenceId=await ctx.db.insert("quoteComparisons",{intakeId:intake._id,agentId:intake.agentId,briefRevision:intake.revisionNumber,
      versionIds:comparison.versionIds,lowestOptionIds:comparison.lowestOptionIds,finalClientPriceMinor:comparison.finalClientPriceMinor,
      validUntil:comparison.validUntil,createdAt:Date.now()});
    const {_id,_creationTime,...content}=source;
    return ctx.db.insert("quoteVersions",{...content,option:"lowest",requestId:args.requestId,createdAt:Date.now(),
      comparisonEvidenceId:evidenceId,comparisonSourceVersionId:source._id});
  },
});

// Internal administrative operation; call only after Amit confirms this exact
// sign-in user identity. No first-user privilege or agency-email inference.
export const setReviewer = internalMutation({
  args: { userId: v.id("users"), confirmedSignInEmail: v.string(), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user?.email || user.email.toLowerCase() !== args.confirmedSignInEmail.trim().toLowerCase()) {
      throw new ConvexError("The confirmed sign-in identity does not match this user.");
    }
    const grant = await ctx.db.query("quoteReviewerGrants").withIndex("by_user", q => q.eq("userId", args.userId)).unique();
    const fields = { userId: args.userId, active: args.active, confirmedAt: Date.now() };
    if (grant) await ctx.db.patch(grant._id, fields); else await ctx.db.insert("quoteReviewerGrants", fields);
    return null;
  },
});

export const reviewerAccess = query({
  args: {}, returns: v.boolean(),
  handler: async ctx => { const userId = await getAuthUserId(ctx); return userId ? await isReviewer(ctx, userId) : false; },
});
export const inspectForReview = query({
  args: { quoteVersionId: v.id("quoteVersions") },
  returns: v.union(v.object({ _id: v.id("quoteVersions"), _creationTime: v.number(), ...quoteVersionFields }), v.null()),
  handler: async (ctx, args) => { await reviewer(ctx); return await ctx.db.get(args.quoteVersionId); },
});
const reviewDecision = v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"));
const versionSummary = {
  quoteVersionId: v.id("quoteVersions"), option: v.union(v.literal("balanced"), v.literal("lowest")),
  createdAt: v.number(), briefRevision: v.number(), decision: reviewDecision,
  comparisonLabel:v.optional(v.string()),
};
export const listMine = query({
  args: { enquiryId: v.id("enquiries") }, returns: v.array(v.object(versionSummary)),
  handler: async (ctx, args) => {
    const agent = await ownAgent(ctx);
    const enquiry = await ctx.db.get(args.enquiryId);
    if (!enquiry || enquiry.agentId !== agent._id) throw new ConvexError("Enquiry not found.");
    const versions = await ctx.db.query("quoteVersions").withIndex("by_enquiry_created", q => q.eq("enquiryId", args.enquiryId)).order("desc").take(20);
    const result = [];
    for (const version of versions) {
      const review = await latestReview(ctx, version._id);
      result.push({ quoteVersionId: version._id, option: version.option, createdAt: version.createdAt,
        briefRevision: version.briefRevision, decision: review?.decision ?? "pending" as const });
    }
    return result;
  },
});
export const listForIntake=query({
  args:{intakeId:v.id("intakes")},returns:v.array(v.object(versionSummary)),
  handler:async(ctx,args)=>{
    const agent=await ownAgent(ctx),intake=await ctx.db.get(args.intakeId);
    if(!intake || intake.agentId!==agent._id)throw new ConvexError("Intake not found.");
    const versions=await ctx.db.query("quoteVersions").withIndex("by_intake_created",q=>q.eq("intakeId",intake._id)).order("desc").take(20);
    const result=[];
    for(const version of versions){const review=await latestReview(ctx,version._id),choice=version.comparisonScope?.choice;
      result.push({quoteVersionId:version._id,option:version.option,createdAt:version.createdAt,briefRevision:version.briefRevision,
        decision:review?.decision??"pending" as const,...(choice?{comparisonLabel:`${choice.startDate} to ${choice.endDate} · ${choice.hotelTier} · ${choice.transport}`}:{})});}
    return result;
  },
});
export const reviewQueue = query({
  args: {}, returns: v.array(v.object({ ...versionSummary, agencyName: v.string() })),
  handler: async ctx => {
    await reviewer(ctx);
    const versions = await ctx.db.query("quoteVersions").withIndex("by_created").order("desc").take(20);
    const result = [];
    for (const version of versions) {
      const review = await latestReview(ctx, version._id);
      result.push({ quoteVersionId: version._id, option: version.option, createdAt: version.createdAt,
        briefRevision: version.briefRevision, decision: review?.decision ?? "pending" as const,
        agencyName: version.branding.businessName });
    }
    return result;
  },
});
export const reviewDetails = query({
  args: { quoteVersionId: v.id("quoteVersions") },
  returns: v.union(v.object({ version: v.object({ _id: v.id("quoteVersions"), _creationTime: v.number(), ...quoteVersionFields }),
    reasons: v.array(v.string()), prices: v.union(agentPrices, v.null()), decision: reviewDecision,
    note: v.string(),comparison:v.optional(v.object({current:v.boolean(),validUntil:v.number(),
      choices:v.array(v.object({choice:comparisonChoice,finalClientPriceMinor:v.union(v.number(),v.null())}))})) }), v.null()),
  handler: async (ctx, args) => {
    await reviewer(ctx);
    const version = await ctx.db.get(args.quoteVersionId);
    if (!version) return null;
    const last = await latestReview(ctx, version._id);
    const { value, enquiry } = await candidate(ctx, version, null);
    const now = Date.now();
    // Assessment for the reviewer only; this does not save or imply approval.
    const assessment = { ...value, review: { status: "approved", versionId: version._id,
      briefRevision: version.briefRevision, reviewedAt: now, authorized: true } };
    const reasons = [...checkQuoteReadiness(assessment, now).reasons, ...contentProblems(version, enquiry)];
    let prices = null;
    if (!reasons.length) {
      try { prices = assembleAgentQuote(assessment, now); }
      catch { reasons.push("Check quote currencies, permitted minimum selling prices, markup and totals."); }
    }
    let comparison;
    if(version.option==="lowest" && version.comparisonEvidenceId){
      const evidence=await ctx.db.get(version.comparisonEvidenceId);
      if(evidence && evidence.versionIds.length<=48){
        const choices=[];
        for(const id of evidence.versionIds){
          const source=await ctx.db.get(id);if(!source?.comparisonScope || source.option!=="balanced" || source.intakeId!==version.intakeId || source.agentId!==version.agentId)continue;
          let finalClientPriceMinor=null;
          const base=await candidate(ctx,source,await latestReview(ctx,id));
          if(!contentProblems(source,base.enquiry).length){
            try{finalClientPriceMinor=assembleAgentQuote(base.value,now).finalClientPriceMinor;}catch{ /* Show unavailable rather than a stale comparison price. */ }
          }
          choices.push({choice:source.comparisonScope.choice,finalClientPriceMinor});
        }
        comparison={current:await lowestEvidenceProblem(ctx,version)===null,validUntil:evidence.validUntil,choices};
      }
    }
    return { version, reasons, prices, decision: last?.decision ?? "pending" as const, note: last?.note ?? "",...(comparison?{comparison}:{}) };
  },
});
export const decide = mutation({
  args: { quoteVersionId: v.id("quoteVersions"), decision: v.union(v.literal("approved"), v.literal("rejected")), note: v.string() },
  returns: v.id("quoteReviews"),
  handler: async (ctx, args) => {
    const userId = await reviewer(ctx);
    const version = await ctx.db.get(args.quoteVersionId);
    if (!version) throw new ConvexError("Quote not found.");
    const prior = await latestReview(ctx, version._id);
    const now = Math.max(Date.now(), (prior?.reviewedAt ?? 0) + 1);
    const note = args.note.trim();
    if (note.length > 3000 || (args.decision === "rejected" && !note)) throw new ConvexError("Give a correction reason of at most 3000 characters.");
    if (args.decision === "approved") {
      const { value, enquiry } = await candidate(ctx, version, null);
      const approval = { status: "approved", versionId: version._id, briefRevision: version.briefRevision, reviewedAt: now, authorized: true };
      const reasons = [...checkQuoteReadiness({ ...value, review: approval }, now).reasons, ...contentProblems(version, enquiry)];
      if (reasons.length) throw new ConvexError(reasons.join(" "));
      // Price calculation and overflow must also pass before approval is saved.
      try { assembleAgentQuote({ ...value, review: approval }, now); }
      catch { throw new ConvexError("Quote prices cannot be approved. Check currencies, permitted minimum selling prices, markup and totals."); }
      // Distinct approved quote versions, including revisions, count once.
      // Review stays required after 100 until a separate policy is confirmed.
      if (prior?.decision === "approved") return prior._id;
      const counted = await ctx.db.query("quoteApprovalCounts").withIndex("by_version", q => q.eq("quoteVersionId", version._id)).unique();
      if (!counted) {
        const counter = await ctx.db.query("quoteReviewCounter").withIndex("by_scope", q => q.eq("scope", "global")).unique();
        const approvedVersions = (counter?.approvedVersions ?? 0) + 1;
        if (!Number.isSafeInteger(approvedVersions)) throw new ConvexError("The review count needs checking.");
        if (counter) await ctx.db.patch(counter._id, { approvedVersions });
        else await ctx.db.insert("quoteReviewCounter", { scope: "global", approvedVersions });
        await ctx.db.insert("quoteApprovalCounts", { quoteVersionId: version._id, countedAt: now });
      }
    }
    return await ctx.db.insert("quoteReviews", { quoteVersionId: version._id, reviewerUserId: userId,
      decision: args.decision, note, reviewedAt: now });
  },
});

const safeQuote = v.object({ quoteVersionId: v.id("quoteVersions"), option: v.union(v.literal("balanced"), v.literal("lowest")),
  ready: v.boolean(), reasons: v.array(v.string()),
  quote: v.union(v.object({ branding, days: v.array(itineraryDay), inclusions: v.array(v.string()),
    exclusions: v.array(v.string()), cancellationTerms: v.array(v.string()),comparisonChoice:v.optional(comparisonChoice), prices: finalPrices }), v.null()) });
export const getMine = query({
  args: { quoteVersionId: v.id("quoteVersions") }, returns: v.union(safeQuote, v.null()),
  handler: async (ctx, args) => {
    const agent = await ownAgent(ctx);
    const version = await ctx.db.get(args.quoteVersionId);
    if (!version || version.agentId !== agent._id) return null;
    const { value, enquiry } = await candidate(ctx, version, await latestReview(ctx, version._id));
    const now = Date.now();
    const reasons = [...checkQuoteReadiness(value, now).reasons, ...contentProblems(version, enquiry)];
    if (reasons.length) return { quoteVersionId: version._id, option: version.option, ready: false, reasons, quote: null };
    try {
      const internalPrices = assembleAgentQuote(value, now);
      const prices = { currency: internalPrices.currency,
        items: internalPrices.items.map(item => ({ description: item.description, finalClientPriceMinor: item.finalClientPriceMinor })),
        finalClientPriceMinor: internalPrices.finalClientPriceMinor, pricesCheckedAt: internalPrices.pricesCheckedAt,
        validUntil: internalPrices.validUntil };
      return { quoteVersionId: version._id, option: version.option, ready: true, reasons: [], quote: {
        branding: version.branding, days: version.days, inclusions: version.inclusions,
        exclusions: version.exclusions, cancellationTerms: version.cancellationTerms ?? [],
        ...(version.comparisonScope?{comparisonChoice:version.comparisonScope.choice}:{}),prices } };
    } catch { return { quoteVersionId: version._id, option: version.option, ready: false,
      reasons: ["Quote prices need checking before release."], quote: null }; }
  },
});
export const getMineLogoUrl = query({
  args: { quoteVersionId: v.id("quoteVersions") }, returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const agent = await ownAgent(ctx);
    const version = await ctx.db.get(args.quoteVersionId);
    if (!version || version.agentId !== agent._id) return null;
    return version.branding.logoStorageId ? await ctx.storage.getUrl(version.branding.logoStorageId) : null;
  },
});
export const cachedPdf = internalQuery({
  args: { quoteVersionId: v.id("quoteVersions") }, returns: v.union(v.id("_storage"), v.null()),
  handler: async (ctx, args) => {
    const agent = await ownAgent(ctx);
    const version = await ctx.db.get(args.quoteVersionId);
    if (!version || version.agentId !== agent._id) return null;
    const artifact = await ctx.db.query("quotePdfArtifacts").withIndex("by_version_format", q =>
      q.eq("quoteVersionId",version._id).eq("formatVersion",1)).unique();
    return artifact?.storageId ?? null;
  },
});
export const attachPdf = internalMutation({
  args: { quoteVersionId: v.id("quoteVersions"), storageId: v.id("_storage") }, returns: v.id("_storage"),
  handler: async (ctx,args) => {
    const agent = await ownAgent(ctx);
    const version = await ctx.db.get(args.quoteVersionId);
    if (!version || version.agentId !== agent._id) throw new ConvexError("Quote not found.");
    const {value,enquiry} = await candidate(ctx,version,await latestReview(ctx,version._id));
    if (!checkQuoteReadiness(value,Date.now()).ready || contentProblems(version,enquiry).length) {
      throw new ConvexError("This quote needs fresh complete facts and approval before PDF delivery.");
    }
    assembleAgentQuote(value,Date.now());
    const existing = await ctx.db.query("quotePdfArtifacts").withIndex("by_version_format",q =>
      q.eq("quoteVersionId",version._id).eq("formatVersion",1)).unique();
    if (existing) return existing.storageId;
    await ctx.db.insert("quotePdfArtifacts",{quoteVersionId:version._id,agentId:agent._id,
      formatVersion:1,storageId:args.storageId,createdAt:Date.now()});
    return args.storageId;
  },
});
export const release = mutation({
  args: { quoteVersionId: v.id("quoteVersions") }, returns: v.id("quoteReleases"),
  handler: async (ctx, args) => {
    const agent = await ownAgent(ctx);
    const version = await ctx.db.get(args.quoteVersionId);
    if (!version || version.agentId !== agent._id) throw new ConvexError("Quote not found.");
    const review = await latestReview(ctx, version._id);
    const { value, enquiry } = await candidate(ctx, version, review);
    const now = Date.now();
    if (!review || !checkQuoteReadiness(value, now).ready || contentProblems(version, enquiry).length) {
      throw new ConvexError("This quote needs fresh complete facts and approval before release.");
    }
    const prices = assembleAgentQuote(value, now);
    const existing = await ctx.db.query("quoteReleases").withIndex("by_version", q => q.eq("quoteVersionId", version._id)).unique();
    if (existing) return existing._id;
    return await ctx.db.insert("quoteReleases", { quoteVersionId: version._id, agentId: agent._id,
      reviewId: review._id, prices, releasedAt: now });
  },
});
