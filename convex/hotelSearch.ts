"use node";
import {v} from "convex/values";
import {internalAction} from "./_generated/server";
import {internal} from "./_generated/api";
// One saved search per action. No automatic retries, no price selection,
// booking or promotion of raw supplier results into verified quote facts.
export const run=internalAction({
  args:{preparationId:v.id("hotelPreparations"),requestId:v.string(),retry:v.optional(v.boolean())},
  returns:v.object({state:v.union(v.literal("ready"),v.literal("busy"),v.literal("failed"),v.literal("stale"),v.literal("ignored")),rateCount:v.union(v.number(),v.null())}),
  handler:async(ctx,args):Promise<{state:"ready"|"busy"|"failed"|"stale"|"ignored";rateCount:number|null}>=>{
    const start=await ctx.runMutation(internal.hotelPreparation.beginSearch,{...args,retry:args.retry??false});
    if(start.state!=="start")return {state:start.state,rateCount:start.state==="ready"?null:0};
    if(!start.request)throw new Error("Saved search request is missing.");
    const finish={preparationId:args.preparationId,requestId:args.requestId,attempt:start.attempt};
    try{
      const connection=await ctx.runAction(internal.tbo.connectionReadiness,{});
      if(!connection.hotels.ready){
        const state=await ctx.runMutation(internal.hotelPreparation.finishSearch,{...finish,failureCode:"connection_unavailable"});return {state,rateCount:0};
      }
      const {hotelCodes,checkIn,checkOut,nationality,rooms,refundableOnly}=start.request;
      const result=await ctx.runAction(internal.tbo.searchHotels,{hotelCodes,checkIn,checkOut,nationality,rooms,refundableOnly});
      if(result.rates.some(rate=>!hotelCodes.includes(rate.hotelCode)))throw new Error("Supplier returned an unrelated hotel.");
      const resultJson=JSON.stringify(result);
      if(new TextEncoder().encode(resultJson).byteLength>256000){const state=await ctx.runMutation(internal.hotelPreparation.finishSearch,{...finish,failureCode:"response_too_large"});return {state,rateCount:0};}
      const state=await ctx.runMutation(internal.hotelPreparation.finishSearch,{...finish,resultJson});
      return {state,rateCount:state==="ready"?result.rates.length:0};
    }catch{
      const state=await ctx.runMutation(internal.hotelPreparation.finishSearch,{...finish,failureCode:"supplier_request_failed"});return {state,rateCount:0};
    }
  },
});
