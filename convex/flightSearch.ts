"use node";
import {v} from "convex/values";
import {internalAction} from "./_generated/server";
import {internal} from "./_generated/api";
// One saved search per action. No automatic retries, no price selection,
// booking or promotion of raw supplier results into verified quote facts.
export const run=internalAction({
  args:{preparationId:v.id("flightPreparations"),requestId:v.string(),retry:v.optional(v.boolean())},
  returns:v.object({state:v.union(v.literal("ready"),v.literal("busy"),v.literal("failed"),v.literal("stale"),v.literal("ignored")),rateCount:v.union(v.number(),v.null())}),
  handler:async(ctx,args):Promise<{state:"ready"|"busy"|"failed"|"stale"|"ignored";rateCount:number|null}>=>{
    const start=await ctx.runMutation(internal.flightPreparation.beginSearch,{...args,retry:args.retry??false});
    if(start.state!=="start")return {state:start.state,rateCount:start.state==="ready"?null:0};
    if(!start.request)throw new Error("Saved search request is missing.");
    const finish={preparationId:args.preparationId,requestId:args.requestId,attempt:start.attempt};
    try{
      const connection=await ctx.runAction(internal.tbo.connectionReadiness,{});
      if(!connection.flights.ready){
        const state=await ctx.runMutation(internal.flightPreparation.finishSearch,{...finish,failureCode:"connection_unavailable"});return {state,rateCount:0};
      }
      const {adults,children,infants,directOnly,journeyType}=start.request;
      const segments=start.request.segments.map(({origin,destination,departureDate,cabinClass})=>({origin,destination,departureDate,cabinClass}));
      const result=await ctx.runAction(internal.tbo.searchFlights,{adults,children,infants,directOnly,journeyType,segments});
      const reference=(value:string)=>value.length>0 && value.length<=2000 && value===value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
      if(!reference(result.traceId) || result.rates.some(rate=>!reference(rate.resultIndex) || !Number.isInteger(rate.resultGroup) || rate.resultGroup<0 || rate.resultGroup>100))throw new Error("Supplier search references are missing.");
      const resultJson=JSON.stringify(result);
      if(new TextEncoder().encode(resultJson).byteLength>256000){const state=await ctx.runMutation(internal.flightPreparation.finishSearch,{...finish,failureCode:"response_too_large"});return {state,rateCount:0};}
      const state=await ctx.runMutation(internal.flightPreparation.finishSearch,{...finish,resultJson});
      return {state,rateCount:state==="ready"?result.rates.length:0};
    }catch{
      const state=await ctx.runMutation(internal.flightPreparation.finishSearch,{...finish,failureCode:"supplier_request_failed"});return {state,rateCount:0};
    }
  },
});
