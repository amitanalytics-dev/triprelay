import {v,ConvexError} from "convex/values";
import {query} from "./_generated/server";
import {requireQuoteReviewer} from "./quotes";
import {intakeFacts,intakeSupplierFacts,intakeStatus} from "./schema";
import {getSelectedRate} from "./hotelPreparation";
import {getSelectedFares} from "./flightPreparation";
const stepState=v.union(v.literal("not_started"),v.literal("running"),v.literal("ready"),v.literal("failed"),v.literal("stale"));
const step=v.object({state:stepState,attempt:v.union(v.number(),v.null()),startedAt:v.union(v.number(),v.null()),finishedAt:v.union(v.number(),v.null()),reason:v.string()});
const row=v.object({label:v.string(),current:v.boolean(),search:step,recheck:step,parts:v.array(v.object({slot:v.number(),stage:v.union(v.literal("fare"),v.literal("terms")),check:step}))});
const briefFields={originalMessage:v.string(),revisionNumber:v.number(),factsConfirmed:v.boolean(),facts:intakeFacts,supplierFacts:v.union(intakeSupplierFacts,v.null())};
const failures:Record<string,string>={connection_unavailable:"Supplier connection settings are missing.",supplier_request_failed:"The supplier search failed.",
  supplier_recheck_failed:"The supplier price or terms check failed.",response_too_large:"The supplier response exceeded the saved evidence limit.",source_changed:"The saved enquiry or search changed.",
  incomplete_evidence:"Complete fare and terms evidence is missing.",workflow_incomplete:"The check ended before all evidence was saved.",workflow_canceled:"The check was canceled.",operator_canceled:"The reviewer canceled this check."};
function summary(value:{status?:"running"|"ready"|"failed"|"stale";attempt?:number;startedAt?:number;finishedAt?:number;failureCode?:string}|null,stale=false){
  return {state:stale?"stale" as const:value?.status??"not_started" as const,attempt:value?.attempt??null,startedAt:value?.startedAt??null,finishedAt:value?.finishedAt??null,
    reason:stale?"The saved enquiry or selected search evidence changed.":value?.failureCode?(failures[value.failureCode]??"This supplier check needs attention."):""};
}
export const queue=query({
  args:{},returns:v.array(v.object({intakeId:v.id("intakes"),agencyName:v.string(),revisionNumber:v.number(),status:intakeStatus})),
  handler:async(ctx)=>{
    await requireQuoteReviewer(ctx);
    const intakes=await ctx.db.query("intakes").withIndex("by_created").order("desc").take(20),result=[];
    for(const intake of intakes){const agent=await ctx.db.get(intake.agentId);if(agent)result.push({intakeId:intake._id,agencyName:agent.businessName,revisionNumber:intake.revisionNumber,status:intake.status});}
    return result;
  },
});
export const details=query({
  args:{intakeId:v.id("intakes"),hotelOffset:v.optional(v.number()),flightOffset:v.optional(v.number())},
  returns:v.union(v.object({...briefFields,hotels:v.array(row),flights:v.array(row),hotelOffset:v.number(),flightOffset:v.number(),hotelCount:v.number(),flightCount:v.number(),quoteReady:v.literal(false)}),v.null()),
  handler:async(ctx,args)=>{
    await requireQuoteReviewer(ctx);const intake=await ctx.db.get(args.intakeId);if(!intake)return null;
    let hotelOffset=args.hotelOffset??0,flightOffset=args.flightOffset??0;
    if(!Number.isSafeInteger(hotelOffset) || hotelOffset<0 || hotelOffset>192 || hotelOffset%6 || !Number.isSafeInteger(flightOffset) || flightOffset<0 || flightOffset>8)throw new ConvexError("Choose a valid saved-check page.");
    const hotel=await ctx.db.query("hotelPreparations").withIndex("by_intake_created",q=>q.eq("intakeId",intake._id)).order("desc").first();
    const flight=await ctx.db.query("flightPreparations").withIndex("by_intake_created",q=>q.eq("intakeId",intake._id)).order("desc").first();
    hotelOffset=Math.min(hotelOffset,Math.max(0,Math.floor(((hotel?.requests.length??0)-1)/6)*6));
    flightOffset=Math.min(flightOffset,Math.max(0,(flight?.requests.length??0)-1));
    const current=(plan:{agentId:typeof intake.agentId;briefRevision:number})=>plan.agentId===intake.agentId && plan.briefRevision===intake.revisionNumber && intake.factsConfirmed && intake.status==="complete_brief";
    const hotels=[],flights=[];
    if(hotel){if(hotel.requests.length>192)throw new Error("Hotel plan exceeds the bounded review view.");
      for(const request of hotel.requests.slice(hotelOffset,hotelOffset+6)){
        const search=await ctx.db.query("hotelSearchRuns").withIndex("by_preparation_request",q=>q.eq("preparationId",hotel._id).eq("requestId",request.requestId)).unique();
        const recheck=await ctx.db.query("hotelRecheckRuns").withIndex("by_preparation_source",q=>q.eq("preparationId",hotel._id).eq("sourceRequestId",request.requestId)).order("desc").first();
        let sameSource=current(hotel);if(recheck){try{const selected=await getSelectedRate(ctx,{preparationId:hotel._id,requestId:request.requestId,rateIndex:recheck.rateIndex});sameSource=Boolean(sameSource && selected?.searchAttempt===recheck.searchAttempt && selected.selectedJson===recheck.selectedJson);}catch{sameSource=false;}}
        hotels.push({label:`${request.checkIn} to ${request.checkOut} · ${request.city} · ${request.hotelTier}`,current:current(hotel),search:summary(search,!current(hotel)),recheck:summary(recheck,!sameSource),parts:[]});
      }
    }
    if(flight){if(flight.requests.length>8)throw new Error("Flight plan exceeds the bounded review view.");
      for(const request of flight.requests.slice(flightOffset,flightOffset+1)){
        const search=await ctx.db.query("flightSearchRuns").withIndex("by_preparation_request",q=>q.eq("preparationId",flight._id).eq("requestId",request.requestId)).unique();
        const recheck=await ctx.db.query("flightRecheckRuns").withIndex("by_preparation_source",q=>q.eq("preparationId",flight._id).eq("sourceRequestId",request.requestId)).order("desc").first();
        let sameSource=current(flight),slots=0;
        if(recheck){try{const selected=await getSelectedFares(ctx,{preparationId:flight._id,requestId:request.requestId,rateIndices:recheck.rateIndices});sameSource=Boolean(sameSource && selected?.searchAttempt===recheck.searchAttempt && selected.selectedJson===recheck.selectedJson);slots=Math.min(6,recheck.rateIndices.length);}catch{sameSource=false;}}
        const parts=[];
        if(recheck)for(let slot=0;slot<slots;slot++)for(const stage of ["fare","terms"] as const){
          const part=await ctx.db.query("flightRecheckParts").withIndex("by_run_slot_stage",q=>q.eq("runId",recheck._id).eq("slot",slot).eq("stage",stage)).unique();
          parts.push({slot,stage,check:summary(part,!sameSource)});
        }
        flights.push({label:`${request.startDate} to ${request.endDate} · ${request.segments.map(segment=>`${segment.originCity} to ${segment.destinationCity}`).join("; ")}`,current:current(flight),
          search:summary(search,!current(flight)),recheck:summary(recheck,!sameSource),parts});
      }
    }
    return {originalMessage:intake.originalMessage,revisionNumber:intake.revisionNumber,factsConfirmed:intake.factsConfirmed,facts:intake.facts,supplierFacts:intake.supplierFacts??null,
      hotels,flights,hotelOffset,flightOffset,hotelCount:hotel?.requests.length??0,flightCount:flight?.requests.length??0,quoteReady:false as const};
  },
});
export const brief=query({
  args:{intakeId:v.id("intakes")},returns:v.union(v.object(briefFields),v.null()),handler:async(ctx,args)=>{
    await requireQuoteReviewer(ctx);const intake=await ctx.db.get(args.intakeId);if(!intake)return null;
    return {originalMessage:intake.originalMessage,revisionNumber:intake.revisionNumber,factsConfirmed:intake.factsConfirmed,facts:intake.facts,supplierFacts:intake.supplierFacts??null};
  },
});
