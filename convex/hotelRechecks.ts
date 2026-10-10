import {v,ConvexError} from "convex/values";
import {internalMutation,internalQuery,type QueryCtx} from "./_generated/server";
import type {Doc} from "./_generated/dataModel";
import {getSelectedRate} from "./hotelPreparation";
import {matchHotelRecheck} from "../lib/hotelRecheck.cjs";
const task={preparationId:v.id("hotelPreparations"),requestId:v.string()};
export const begin=internalMutation({
  args:{...task,sourceRequestId:v.string(),rateIndex:v.number(),retry:v.boolean()},
  returns:v.object({state:v.union(v.literal("start"),v.literal("ready"),v.literal("busy"),v.literal("failed"),v.literal("stale")),
    attempt:v.number(),selectedJson:v.union(v.string(),v.null())}),
  handler:async(ctx,args)=>{
    if(!args.requestId.trim() || args.requestId.length>100)throw new ConvexError("Use a valid recheck request.");
    const selection=await getSelectedRate(ctx,{preparationId:args.preparationId,requestId:args.sourceRequestId,rateIndex:args.rateIndex});
    if(!selection)return {state:"stale" as const,attempt:0,selectedJson:null};
    const old=await ctx.db.query("hotelRecheckRuns").withIndex("by_preparation_request",q=>q.eq("preparationId",args.preparationId).eq("requestId",args.requestId)).unique();
    if(old && (old.sourceRequestId!==args.sourceRequestId || old.rateIndex!==args.rateIndex || old.searchAttempt!==selection.searchAttempt || old.selectedJson!==selection.selectedJson))throw new ConvexError("This recheck request is bound to another or changed source. Use a new request.");
    const now=Date.now();
    if(old?.status==="ready")return {state:"ready" as const,attempt:old.attempt,selectedJson:null};
    if(old?.status==="running" && (!args.retry || now-old.startedAt<120000))return {state:"busy" as const,attempt:old.attempt,selectedJson:null};
    if(old && (!args.retry || old.attempt>=3))return {state:"failed" as const,attempt:old.attempt,selectedJson:null};
    const attempt=(old?.attempt??0)+1,record={preparationId:args.preparationId,requestId:args.requestId,sourceRequestId:args.sourceRequestId,
      rateIndex:args.rateIndex,searchAttempt:selection.searchAttempt,selectedJson:selection.selectedJson,status:"running" as const,attempt,startedAt:now};
    if(old)await ctx.db.patch(old._id,{...record,finishedAt:undefined,failureCode:undefined,resultJson:undefined});else await ctx.db.insert("hotelRecheckRuns",record);
    return {state:"start" as const,attempt,selectedJson:selection.selectedJson};
  },
});
export const finish=internalMutation({
  args:{...task,attempt:v.number(),resultJson:v.optional(v.string()),failureCode:v.optional(v.union(v.literal("connection_unavailable"),v.literal("supplier_recheck_failed"),v.literal("response_too_large")))},
  returns:v.union(v.literal("ready"),v.literal("failed"),v.literal("stale"),v.literal("ignored")),
  handler:async(ctx,args)=>{
    const row=await ctx.db.query("hotelRecheckRuns").withIndex("by_preparation_request",q=>q.eq("preparationId",args.preparationId).eq("requestId",args.requestId)).unique();
    if(!row || row.status!=="running" || row.attempt!==args.attempt)return "ignored" as const;
    let selected=null;
    try{selected=await getSelectedRate(ctx,{preparationId:row.preparationId,requestId:row.sourceRequestId,rateIndex:row.rateIndex});}catch{ /* A corrupted/replaced source cannot finish this recheck. */ }
    if(!selected || selected.searchAttempt!==row.searchAttempt || selected.selectedJson!==row.selectedJson){
      await ctx.db.patch(row._id,{status:"stale",finishedAt:Date.now(),failureCode:"source_changed",resultJson:undefined});return "stale" as const;
    }
    if(Boolean(args.resultJson)===Boolean(args.failureCode))throw new ConvexError("Supply recheck evidence or a safe failure code.");
    let resultJson;
    if(args.resultJson){
      if(new TextEncoder().encode(args.resultJson).byteLength>256000)throw new ConvexError("Recheck evidence is too large.");
      const result=JSON.parse(args.resultJson);
      if(result.checkedAt> Date.now() || result.checkedAt<row.startedAt)throw new ConvexError("Recheck evidence must come from this current attempt.");
      resultJson=JSON.stringify(matchHotelRecheck(JSON.parse(row.selectedJson),result));
    }
    const status=args.failureCode?"failed" as const:"ready" as const;
    await ctx.db.patch(row._id,{status,finishedAt:Date.now(),resultJson,failureCode:args.failureCode});return status;
  },
});
export const inspect=internalQuery({
  args:task,returns:v.union(v.string(),v.null()),handler:async(ctx,args)=>{
    const row=await ctx.db.query("hotelRecheckRuns").withIndex("by_preparation_request",q=>q.eq("preparationId",args.preparationId).eq("requestId",args.requestId)).unique();
    return row?getSavedHotelRecheck(ctx,row):null;
  },
});
// Shared by internal source preparation; never call a registered handler directly.
export const getSavedHotelRecheck=async(ctx:QueryCtx,row:Doc<"hotelRecheckRuns">)=>{
  if(row.status!=="ready" || !row.resultJson)return null;
  try{
    const selected=await getSelectedRate(ctx,{preparationId:row.preparationId,requestId:row.sourceRequestId,rateIndex:row.rateIndex});
    return selected && selected.searchAttempt===row.searchAttempt && selected.selectedJson===row.selectedJson?row.resultJson:null;
  }catch{return null;}
};
