import {v} from "convex/values";
import {internalQuery} from "./_generated/server";
import {buildComparisonPlan} from "../lib/comparisonPlan.cjs";
import {nextQuestion,supplierQuestion} from "./intakes";
import {getSavedHotelRecheck} from "./hotelRechecks";
import {getSavedFlightRecheck} from "./flightRechecks";

// Private operator preparation only. Complete rechecks are not verified costs,
// a pricing deadline, ground/meal coverage or permission to release a quote.
export const inspect=internalQuery({
  args:{intakeId:v.id("intakes"),expectedBriefRevision:v.number(),comparisonOptionId:v.string(),
    hotels:v.array(v.object({stopIndex:v.number(),runId:v.id("hotelRecheckRuns")})),
    flightRunId:v.optional(v.id("flightRecheckRuns"))},
  returns:v.object({state:v.union(v.literal("blocked"),v.literal("source_checks_complete")),
    reason:v.union(v.string(),v.null()),evidenceJson:v.union(v.string(),v.null()),quoteReady:v.literal(false)}),
  handler:async(ctx,args)=>{
    const blocked=(reason:string)=>({state:"blocked" as const,reason,evidenceJson:null,quoteReady:false as const});
    const intake=await ctx.db.get(args.intakeId);
    if(!intake || intake.revisionNumber!==args.expectedBriefRevision)return blocked("The saved enquiry changed or is unavailable.");
    if(!intake.factsConfirmed || intake.status!=="complete_brief" || nextQuestion(intake.facts,true) ||
      supplierQuestion(intake.facts,intake.supplierFacts??{}))return blocked("Confirm the complete enquiry and customer search details first.");
    const choice=buildComparisonPlan(intake.facts).options.find(row=>row.optionId===args.comparisonOptionId);
    if(!choice)return blocked("Choose an exact saved comparison option.");
    const stops=choice.stops.map((stop,index)=>stop.nights>0?index:-1).filter(index=>index>=0);
    if(args.hotels.length>48 || args.hotels.length!==stops.length ||
      new Set(args.hotels.map(row=>row.stopIndex)).size!==stops.length ||
      new Set(args.hotels.map(row=>row.runId)).size!==stops.length ||
      args.hotels.some(row=>!Number.isSafeInteger(row.stopIndex) || !stops.includes(row.stopIndex))) {
      return blocked("Select exactly one complete hotel-unit recheck for every overnight stop.");
    }
    const hotels=[];
    const matchingPlan=(plan:{intakeId:typeof intake._id;agentId:typeof intake.agentId;briefRevision:number})=>
      plan.intakeId===intake._id && plan.agentId===intake.agentId && plan.briefRevision===intake.revisionNumber;
    for(const binding of [...args.hotels].sort((a,b)=>a.stopIndex-b.stopIndex)){
      const run=await ctx.db.get(binding.runId),stop=choice.stops[binding.stopIndex];
      if(!run)return blocked("A selected hotel check is unavailable.");
      const plan=await ctx.db.get(run.preparationId);
      if(!plan || !matchingPlan(plan))return blocked("A hotel check belongs to another or changed enquiry.");
      const request=plan.requests.find(row=>row.requestId===run.sourceRequestId);
      if(!request || !request.optionIds.includes(choice.optionId) || request.stopIndex!==binding.stopIndex ||
        request.city!==stop.city || request.hotelTier!==choice.hotelTier || request.checkIn!==stop.arrivalDate ||
        request.checkOut!==stop.departureDate || JSON.stringify(request.rooms)!==JSON.stringify(choice.rooms)) {
        return blocked("A hotel check does not match this option's stop, dates, standard and rooms.");
      }
      const evidenceJson=await getSavedHotelRecheck(ctx,run);
      if(!evidenceJson)return blocked("A hotel recheck is incomplete or its selected search source changed.");
      hotels.push({stopIndex:binding.stopIndex,runId:run._id,attempt:run.attempt,searchAttempt:run.searchAttempt,
        selectedJson:run.selectedJson,evidenceJson});
    }
    let flight=null;
    if(intake.supplierFacts!.flights==="include"){
      if(!args.flightRunId)return blocked("Select the complete flight fare-and-terms recheck for this option.");
      const run=await ctx.db.get(args.flightRunId);
      if(!run)return blocked("The selected flight check is unavailable.");
      const plan=await ctx.db.get(run.preparationId);
      if(!plan || !matchingPlan(plan))return blocked("The flight check belongs to another or changed enquiry.");
      const request=plan.requests.find(row=>row.requestId===run.sourceRequestId);
      if(!request || !request.optionIds.includes(choice.optionId) || request.startDate!==choice.startDate ||
        request.endDate!==choice.endDate)return blocked("The flight check does not match this option's travel dates.");
      const evidenceJson=await getSavedFlightRecheck(ctx,run);
      if(!evidenceJson)return blocked("The complete flight fare-and-terms checks are incomplete or their source changed.");
      flight={runId:run._id,searchAttempt:run.searchAttempt,selectedJson:run.selectedJson,evidenceJson};
    }else if(args.flightRunId)return blocked("Do not attach flights to a no-flights enquiry.");
    const evidenceJson=JSON.stringify({intakeId:intake._id,agentId:intake.agentId,briefRevision:intake.revisionNumber,
      choice,hotels,flight,verificationRequired:["NET cost","GST treatment","compulsory fees","ground and meal coverage",
        "supplier-backed validity","client-facing terms","itinerary fit","authorized human review"],quoteReady:false});
    if(new TextEncoder().encode(evidenceJson).byteLength>512000)return blocked("The complete private evidence exceeds the preparation limit.");
    return {state:"source_checks_complete" as const,reason:null,evidenceJson,quoteReady:false as const};
  },
});
