import {v} from "convex/values";
import {internal} from "./_generated/api";
import {manager} from "./flightWorkflowManager";
export const perform=manager.define({args:{runId:v.id("flightRecheckRuns")},returns:v.null()}).handler(async(step,args):Promise<null>=>{
  const count:number=await step.runQuery(internal.flightRechecks.count,args);
  if(!count){await step.runMutation(internal.flightRechecks.markFailed,{...args,code:"incomplete_evidence"});return null;}
  for(let slot=0;slot<count;slot++)for(const stage of ["fare","terms"] as const){
    const state:string=await step.runAction(internal.flightRecheckAction.stage,{...args,slot,stage},{retry:false});
    if(state!=="ready"){await step.runMutation(internal.flightRechecks.markFailed,{...args,code:"incomplete_evidence"});return null;}
  }
  await step.runMutation(internal.flightRechecks.finish,args);return null;
});
