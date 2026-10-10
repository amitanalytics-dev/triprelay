import {v,ConvexError} from "convex/values";
import {internalMutation,internalQuery,type QueryCtx} from "./_generated/server";
import type {Doc} from "./_generated/dataModel";
import {hotelSearchSettings,hotelSearchRequest} from "./hotelPreparationModel";
import {nextQuestion,supplierQuestion} from "./intakes";
import {buildHotelSearchPlan} from "../lib/hotelSearchPlan.cjs";

async function current(ctx:QueryCtx,plan:Doc<"hotelPreparations">){
  const intake=await ctx.db.get(plan.intakeId);
  return Boolean(intake && intake.agentId===plan.agentId && intake.revisionNumber===plan.briefRevision && intake.factsConfirmed &&
    intake.status==="complete_brief" && !nextQuestion(intake.facts,true) && !supplierQuestion(intake.facts,intake.supplierFacts??{}));
}
// Explicit private operator mappings; no agency endpoint accepts supplier codes.
export const create=internalMutation({
  args:{intakeId:v.id("intakes"),expectedBriefRevision:v.number(),requestId:v.string(),settings:hotelSearchSettings},returns:v.id("hotelPreparations"),
  handler:async(ctx,args)=>{
    const intake=await ctx.db.get(args.intakeId);
    if(!intake || intake.revisionNumber!==args.expectedBriefRevision || !intake.factsConfirmed || intake.status!=="complete_brief" ||
      nextQuestion(intake.facts,true) || supplierQuestion(intake.facts,intake.supplierFacts??{}))throw new ConvexError("Confirm the current trip and customer search answers before preparing supplier searches.");
    if(!args.requestId.trim() || args.requestId.length>100)throw new ConvexError("Use a valid preparation request.");
    const plan=buildHotelSearchPlan(intake.facts,intake.supplierFacts,args.settings);
    const old=await ctx.db.query("hotelPreparations").withIndex("by_intake_request",q=>q.eq("intakeId",args.intakeId).eq("requestId",args.requestId)).unique();
    if(old){if(old.briefRevision!==args.expectedBriefRevision || JSON.stringify(old.settings)!==JSON.stringify(args.settings))throw new ConvexError("This request already saved different search preparation. Use a new request.");return old._id;}
    return ctx.db.insert("hotelPreparations",{intakeId:intake._id,agentId:intake.agentId,briefRevision:intake.revisionNumber,requestId:args.requestId,
      settings:args.settings,...plan,createdAt:Date.now()});
  },
});
export const beginSearch=internalMutation({
  args:{preparationId:v.id("hotelPreparations"),requestId:v.string(),retry:v.boolean()},
  returns:v.object({state:v.union(v.literal("start"),v.literal("ready"),v.literal("busy"),v.literal("failed"),v.literal("stale")),
    attempt:v.number(),request:v.union(hotelSearchRequest,v.null())}),
  handler:async(ctx,args)=>{
    const plan=await ctx.db.get(args.preparationId);if(!plan)throw new ConvexError("Supplier preparation not found.");
    if(!await current(ctx,plan))return {state:"stale" as const,attempt:0,request:null};
    const request=plan.requests.find(row=>row.requestId===args.requestId);if(!request)throw new ConvexError("Choose a search from the saved preparation.");
    const old=await ctx.db.query("hotelSearchRuns").withIndex("by_preparation_request",q=>q.eq("preparationId",args.preparationId).eq("requestId",args.requestId)).unique();
    const now=Date.now();
    if(old?.status==="ready")return {state:"ready" as const,attempt:old.attempt,request:null};
    if(old?.status==="running" && (!args.retry || now-old.startedAt<120000))return {state:"busy" as const,attempt:old.attempt,request:null};
    if(old && (!args.retry || old.attempt>=3))return {state:"failed" as const,attempt:old.attempt,request:null};
    const attempt=(old?.attempt??0)+1;
    const record={preparationId:plan._id,requestId:args.requestId,status:"running" as const,attempt,startedAt:now};
    if(old)await ctx.db.patch(old._id,{...record,finishedAt:undefined,failureCode:undefined,resultJson:undefined});else await ctx.db.insert("hotelSearchRuns",record);
    return {state:"start" as const,attempt,request};
  },
});
export const finishSearch=internalMutation({
  args:{preparationId:v.id("hotelPreparations"),requestId:v.string(),attempt:v.number(),resultJson:v.optional(v.string()),
    failureCode:v.optional(v.union(v.literal("connection_unavailable"),v.literal("supplier_request_failed"),v.literal("response_too_large")))},
  returns:v.union(v.literal("ready"),v.literal("failed"),v.literal("stale"),v.literal("ignored")),
  handler:async(ctx,args)=>{
    const plan=await ctx.db.get(args.preparationId),run=await ctx.db.query("hotelSearchRuns").withIndex("by_preparation_request",q=>q.eq("preparationId",args.preparationId).eq("requestId",args.requestId)).unique();
    if(!plan || !run || run.status!=="running" || run.attempt!==args.attempt)return "ignored" as const;
    if(!await current(ctx,plan)){await ctx.db.patch(run._id,{status:"stale",finishedAt:Date.now(),failureCode:"source_changed",resultJson:undefined});return "stale" as const;}
    if(Boolean(args.resultJson)===Boolean(args.failureCode))throw new ConvexError("Supply a result or safe failure code.");
    if(args.resultJson && new TextEncoder().encode(args.resultJson).byteLength>256000)throw new ConvexError("Supplier response exceeds the saved result size.");
    const status=args.failureCode?"failed" as const:"ready" as const;
    await ctx.db.patch(run._id,{status,finishedAt:Date.now(),resultJson:args.resultJson,failureCode:args.failureCode});return status;
  },
});
export const inspectResult=internalQuery({
  args:{preparationId:v.id("hotelPreparations"),requestId:v.string()},returns:v.union(v.string(),v.null()),
  handler:async(ctx,args)=>{
    const plan=await ctx.db.get(args.preparationId);if(!plan || !await current(ctx,plan))return null;
    const run=await ctx.db.query("hotelSearchRuns").withIndex("by_preparation_request",q=>q.eq("preparationId",plan._id).eq("requestId",args.requestId)).unique();
    return run?.status==="ready"?run.resultJson??null:null;
  },
});
export const getSelectedRate=async(ctx:QueryCtx,args:{preparationId:Doc<"hotelPreparations">["_id"];requestId:string;rateIndex:number})=>{
    const plan=await ctx.db.get(args.preparationId);if(!plan || !await current(ctx,plan))return null;
    const request=plan.requests.find(row=>row.requestId===args.requestId);
    if(!request || !Number.isSafeInteger(args.rateIndex) || args.rateIndex<0 || args.rateIndex>999)throw new ConvexError("Choose a rate from the saved hotel search.");
    const run=await ctx.db.query("hotelSearchRuns").withIndex("by_preparation_request",q=>q.eq("preparationId",plan._id).eq("requestId",args.requestId)).unique();
    if(run?.status!=="ready" || !run.resultJson)return null;
    const result=JSON.parse(run.resultJson),rate=result.rates?.[args.rateIndex];
    if(!rate || !request.hotelCodes.includes(rate.hotelCode) || typeof rate.bookingCode!=="string" || !rate.bookingCode.length ||
      rate.bookingCode.length>8000 || rate.bookingCode!==rate.bookingCode.trim() || /[\u0000-\u001f\u007f]/.test(rate.bookingCode) ||
      !Number.isFinite(rate.supplierTotal) || rate.supplierTotal<0 || !/^[A-Z]{3}$/.test(rate.currency) ||
      !Array.isArray(rate.roomNames) || rate.roomNames.length!==request.rooms.length || rate.roomNames.some((name:unknown)=>typeof name!=="string" || !name.trim())) {
      throw new ConvexError("The selected bookable unit must cover every requested room with valid saved supplier references.");
    }
    return {searchAttempt:run.attempt,selectedJson:JSON.stringify(rate)};
};
export const selectRate=internalQuery({
  args:{preparationId:v.id("hotelPreparations"),requestId:v.string(),rateIndex:v.number()},
  returns:v.union(v.object({searchAttempt:v.number(),selectedJson:v.string()}),v.null()),handler:getSelectedRate,
});
