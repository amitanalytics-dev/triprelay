"use node";
import {v} from "convex/values";
import {internalAction} from "./_generated/server";
import {internal} from "./_generated/api";
// One supplier operation per action; bodies are persisted before returning status.
export const stage=internalAction({
  args:{runId:v.id("flightRecheckRuns"),slot:v.number(),stage:v.union(v.literal("fare"),v.literal("terms"))},
  returns:v.union(v.literal("ready"),v.literal("running"),v.literal("failed"),v.literal("stale"),v.literal("ignored")),
  handler:async(ctx,args):Promise<"ready"|"running"|"failed"|"stale"|"ignored">=>{
    const claim=await ctx.runMutation(internal.flightRechecks.claim,args);
    if(!claim.selectedJson)return claim.state;
    try{
      const connection=await ctx.runAction(internal.tbo.connectionReadiness,{});
      if(!connection.flights.ready)return await ctx.runMutation(internal.flightRechecks.markFailed,{runId:args.runId,code:"connection_unavailable"});
      const selected=JSON.parse(claim.selectedJson),ref={traceId:selected.traceId,resultIndex:selected.fare.resultIndex};
      const result=args.stage==="fare"?await ctx.runAction(internal.tbo.recheckFlight,{...ref,resultGroup:selected.fare.resultGroup}):await ctx.runAction(internal.tbo.flightTerms,ref);
      const resultJson=JSON.stringify(result);
      if(new TextEncoder().encode(resultJson).byteLength>256000)return await ctx.runMutation(internal.flightRechecks.markFailed,{runId:args.runId,code:"response_too_large"});
      return await ctx.runMutation(internal.flightRechecks.savePart,{...args,resultJson});
    }catch{return await ctx.runMutation(internal.flightRechecks.markFailed,{runId:args.runId,code:"supplier_recheck_failed"});}
  },
});
