import {v,ConvexError} from "convex/values";
import {vWorkflowId,vResultValidator,type WorkflowId} from "@convex-dev/workflow";
import {internalMutation,internalQuery,type QueryCtx,type MutationCtx} from "./_generated/server";
import type {Doc,Id} from "./_generated/dataModel";
import {internal} from "./_generated/api";
import {manager} from "./flightWorkflowManager";
import {getSelectedFares} from "./flightPreparation";
import {matchFlightFare,matchFlightTerms} from "../lib/flightCoverage.cjs";
const stage=v.union(v.literal("fare"),v.literal("terms"));
const slotArgs={runId:v.id("flightRecheckRuns"),slot:v.number(),stage};
const state=v.union(v.literal("ready"),v.literal("running"),v.literal("failed"),v.literal("stale"),v.literal("ignored"));
async function selection(ctx:QueryCtx,row:Doc<"flightRecheckRuns">){
  try{
    const selected=await getSelectedFares(ctx,{preparationId:row.preparationId,requestId:row.sourceRequestId,rateIndices:row.rateIndices});
    return selected?.searchAttempt===row.searchAttempt && selected.selectedJson===row.selectedJson?JSON.parse(row.selectedJson):null;
  }catch{return null;}
}
async function fail(ctx:MutationCtx,row:Doc<"flightRecheckRuns">,code:string,status:"failed"|"stale"="failed"){
  await ctx.db.patch(row._id,{status,failureCode:code,finishedAt:Date.now()});return status;
}
export const start=internalMutation({
  args:{preparationId:v.id("flightPreparations"),requestId:v.string(),sourceRequestId:v.string(),rateIndices:v.array(v.number())},
  returns:v.object({runId:v.union(v.id("flightRecheckRuns"),v.null()),state,quoteReady:v.literal(false)}),
  handler:async(ctx,args):Promise<{runId:Id<"flightRecheckRuns">|null;state:"running"|"ready"|"failed"|"stale";quoteReady:false}>=>{
    if(args.requestId!==args.requestId.trim() || !args.requestId || args.requestId.length>100 || /[\u0000-\u001f\u007f]/.test(args.requestId))throw new ConvexError("Use a valid recheck request.");
    const rateIndices=[...args.rateIndices].sort((a,b)=>a-b);
    const selected=await getSelectedFares(ctx,{preparationId:args.preparationId,requestId:args.sourceRequestId,rateIndices});
    if(!selected)return {runId:null,state:"stale",quoteReady:false};
    const old=await ctx.db.query("flightRecheckRuns").withIndex("by_preparation_request",q=>q.eq("preparationId",args.preparationId).eq("requestId",args.requestId)).unique();
    if(old){
      if(old.sourceRequestId!==args.sourceRequestId || JSON.stringify(old.rateIndices)!==JSON.stringify(rateIndices) || old.searchAttempt!==selected.searchAttempt || old.selectedJson!==selected.selectedJson)throw new ConvexError("This request saved another or changed source. Use a new request.");
      return {runId:old._id,state:old.status,quoteReady:false};
    }
    const selectionKey=rateIndices.join(",");
    const previous=await ctx.db.query("flightRecheckRuns").withIndex("by_preparation_source_selection",q=>q.eq("preparationId",args.preparationId).eq("sourceRequestId",args.sourceRequestId).eq("selectionKey",selectionKey)).take(3);
    if(previous.some(row=>row.status==="running"))throw new ConvexError("A recheck of this selection is still running.");
    if(previous.length>=3)throw new ConvexError("Three explicit attempts used. Prepare a fresh supplier search before rechecking again.");
    const runId=await ctx.db.insert("flightRecheckRuns",{...args,rateIndices,selectionKey,...selected,status:"running",startedAt:Date.now()});
    const workflowId=await manager.start(ctx,internal.flightWorkflow.perform,{runId},{startAsync:true,onComplete:internal.flightRechecks.complete,context:{runId}});
    await ctx.db.patch(runId,{workflowId});return {runId,state:"running",quoteReady:false};
  },
});
export const count=internalQuery({
  args:{runId:v.id("flightRecheckRuns")},returns:v.number(),handler:async(ctx,args)=>{
    const row=await ctx.db.get(args.runId);if(!row || row.status!=="running" || !await selection(ctx,row))return 0;
    return JSON.parse(row.selectedJson).fares.length;
  },
});
export const claim=internalMutation({
  args:slotArgs,returns:v.object({state,selectedJson:v.union(v.string(),v.null())}),handler:async(ctx,args)=>{
    const row=await ctx.db.get(args.runId);if(!row || row.status!=="running")return {state:"ignored" as const,selectedJson:null};
    const selected=await selection(ctx,row);if(!selected)return {state:await fail(ctx,row,"source_changed","stale"),selectedJson:null};
    if(!Number.isSafeInteger(args.slot) || args.slot<0 || args.slot>=selected.fares.length)throw new ConvexError("Choose a saved complete-fare slot.");
    const part=await ctx.db.query("flightRecheckParts").withIndex("by_run_slot_stage",q=>q.eq("runId",row._id).eq("slot",args.slot).eq("stage",args.stage)).unique();
    if(part)return {state:part.status??"failed",selectedJson:null};
    if(args.stage==="terms"){
      const fare=await ctx.db.query("flightRecheckParts").withIndex("by_run_slot_stage",q=>q.eq("runId",row._id).eq("slot",args.slot).eq("stage","fare")).unique();
      if(fare?.status!=="ready")throw new ConvexError("Finish the matching fare recheck before fetching terms.");
    }
    const now=Date.now();await ctx.db.insert("flightRecheckParts",{...args,status:"running",startedAt:now,checkedAt:now});
    return {state:"running" as const,selectedJson:JSON.stringify({traceId:selected.traceId,fare:selected.fares[args.slot],request:selected.request})};
  },
});
export const savePart=internalMutation({
  args:{...slotArgs,resultJson:v.string()},returns:state,handler:async(ctx,args)=>{
    const row=await ctx.db.get(args.runId);if(!row || row.status!=="running")return "ignored" as const;
    const selected=await selection(ctx,row);if(!selected)return await fail(ctx,row,"source_changed","stale");
    const part=await ctx.db.query("flightRecheckParts").withIndex("by_run_slot_stage",q=>q.eq("runId",row._id).eq("slot",args.slot).eq("stage",args.stage)).unique();
    if(part?.status!=="running" || part.startedAt===undefined)return "ignored" as const;
    if(new TextEncoder().encode(args.resultJson).byteLength>256000)throw new ConvexError("Supplier evidence is too large.");
    const result=JSON.parse(args.resultJson),choice={traceId:selected.traceId,fare:selected.fares[args.slot]};
    if(!Number.isFinite(result.checkedAt) || result.checkedAt<part.startedAt || result.checkedAt>Date.now())throw new ConvexError("Evidence must come from this current stage.");
    if(args.stage==="fare")matchFlightFare(choice,result,selected.request);else matchFlightTerms(choice,result);
    await ctx.db.patch(part._id,{status:"ready",resultJson:args.resultJson,checkedAt:result.checkedAt});return "ready" as const;
  },
});
export const markFailed=internalMutation({
  args:{runId:v.id("flightRecheckRuns"),code:v.union(v.literal("connection_unavailable"),v.literal("supplier_recheck_failed"),v.literal("response_too_large"),v.literal("incomplete_evidence"))},
  returns:state,handler:async(ctx,args)=>{
    const row=await ctx.db.get(args.runId);if(!row || row.status!=="running")return "ignored" as const;
    return await selection(ctx,row)?await fail(ctx,row,args.code):await fail(ctx,row,"source_changed","stale");
  },
});
async function completeParts(ctx:QueryCtx,row:Doc<"flightRecheckRuns">){
  const selected=await selection(ctx,row);if(!selected)return null;
  const results=[];
  for(let slot=0;slot<selected.fares.length;slot++){
    const evidence:{fare?:unknown;terms?:unknown}={};
    for(const name of ["fare","terms"] as const){
      const part=await ctx.db.query("flightRecheckParts").withIndex("by_run_slot_stage",q=>q.eq("runId",row._id).eq("slot",slot).eq("stage",name)).unique();
      if(part?.status!=="ready" || !part.resultJson)return null;
      const result=JSON.parse(part.resultJson),choice={traceId:selected.traceId,fare:selected.fares[slot]};
      if(name==="fare")matchFlightFare(choice,result,selected.request);else matchFlightTerms(choice,result);
      evidence[name]=result;
    }
    results.push(evidence);
  }
  return {results,quoteReady:false};
}
export const finish=internalMutation({
  args:{runId:v.id("flightRecheckRuns")},returns:state,handler:async(ctx,args)=>{
    const row=await ctx.db.get(args.runId);if(!row || row.status!=="running")return "ignored" as const;
    if(!await selection(ctx,row))return await fail(ctx,row,"source_changed","stale");
    if(!await completeParts(ctx,row))return await fail(ctx,row,"incomplete_evidence");
    await ctx.db.patch(row._id,{status:"ready",finishedAt:Date.now()});return "ready" as const;
  },
});
export const inspect=internalQuery({
  args:{runId:v.id("flightRecheckRuns")},returns:v.union(v.string(),v.null()),handler:async(ctx,args)=>{
    const row=await ctx.db.get(args.runId);return row?getSavedFlightRecheck(ctx,row):null;
  },
});
export const getSavedFlightRecheck=async(ctx:QueryCtx,row:Doc<"flightRecheckRuns">)=>{
  if(row.status!=="ready")return null;
  try{const evidence=await completeParts(ctx,row);return evidence?JSON.stringify(evidence):null;}catch{return null;}
};
export const complete=internalMutation({
  args:{workflowId:vWorkflowId,result:vResultValidator,context:v.object({runId:v.id("flightRecheckRuns")})},returns:v.null(),handler:async(ctx,args)=>{
    const row=await ctx.db.get(args.context.runId);
    if(row?.status==="running" && row.workflowId===args.workflowId)await fail(ctx,row,args.result.kind==="canceled"?"workflow_canceled":"workflow_incomplete");
    return null;
  },
});
export const cancel=internalMutation({
  args:{runId:v.id("flightRecheckRuns")},returns:v.null(),handler:async(ctx,args)=>{
    const row=await ctx.db.get(args.runId);if(!row || row.status!=="running")return null;
    if(row.workflowId)await manager.cancel(ctx,row.workflowId as WorkflowId);
    await fail(ctx,row,"operator_canceled");return null;
  },
});
