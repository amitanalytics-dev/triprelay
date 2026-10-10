"use node";
import {v} from "convex/values";
import {internalAction} from "./_generated/server";
import {internal} from "./_generated/api";
export const run=internalAction({
  args:{preparationId:v.id("hotelPreparations"),requestId:v.string(),sourceRequestId:v.string(),rateIndex:v.number(),retry:v.optional(v.boolean())},
  returns:v.object({state:v.union(v.literal("ready"),v.literal("busy"),v.literal("failed"),v.literal("stale"),v.literal("ignored")),quoteReady:v.literal(false)}),
  handler:async(ctx,args):Promise<{state:"ready"|"busy"|"failed"|"stale"|"ignored";quoteReady:false}>=>{
    const task=await ctx.runMutation(internal.hotelRechecks.begin,{...args,retry:args.retry??false});
    if(task.state!=="start")return {state:task.state,quoteReady:false};
    if(!task.selectedJson)throw new Error("Saved hotel selection is missing.");
    const finish={preparationId:args.preparationId,requestId:args.requestId,attempt:task.attempt};
    try{
      const connection=await ctx.runAction(internal.tbo.connectionReadiness,{});
      if(!connection.hotels.ready){const state=await ctx.runMutation(internal.hotelRechecks.finish,{...finish,failureCode:"connection_unavailable"});return {state,quoteReady:false};}
      const selected=JSON.parse(task.selectedJson);
      const result=await ctx.runAction(internal.tbo.recheckHotel,{bookingCode:selected.bookingCode});
      const resultJson=JSON.stringify(result);
      if(new TextEncoder().encode(resultJson).byteLength>256000){const state=await ctx.runMutation(internal.hotelRechecks.finish,{...finish,failureCode:"response_too_large"});return {state,quoteReady:false};}
      const state=await ctx.runMutation(internal.hotelRechecks.finish,{...finish,resultJson});return {state,quoteReady:false};
    }catch{
      const state=await ctx.runMutation(internal.hotelRechecks.finish,{...finish,failureCode:"supplier_recheck_failed"});return {state,quoteReady:false};
    }
  },
});
