const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module'),{v}=require('convex/values');
function load(file,deps){
 const source=fs.readFileSync(path.join(__dirname,'../convex/',file),'utf8'),names=[...source.matchAll(/export (?:const|function) (\w+)/g)].map(m=>m[1]);
 const code=stripTypeScriptTypes(source).replace(/import \{([^}]+)\} from "([^"]+)";/g,'const {$1}=require("$2");').replace(/export const /g,'const ').replace(/export function /g,'function ')+'\nObject.assign(exports,{'+names.join(',')+'});';
 const exports={};vm.runInNewContext(code,{exports,Date,JSON,TextEncoder,require:name=>{
  if(Object.hasOwn(deps,name))return deps[name];if(name==='convex/values')return require(name);
  if(name.startsWith('../lib/'))return require(path.join(__dirname,'..',name.slice(3)));throw Error(name);
 }});return exports;
}
const model=load('flightPreparationModel.ts',{}),intakes=load('intakes.ts',{'@convex-dev/auth/server':{getAuthUserId:async c=>c.userId},'./_generated/server':{query:d=>d,mutation:d=>d},
 './schema':{intakeFacts:v.any(),intakeQuestion:v.any(),intakeStatus:v.any(),intakeSupplierFacts:v.any()}});
const prep=load('flightPreparation.ts',{'./flightPreparationModel':model,'./intakes':intakes,'./_generated/server':{internalMutation:d=>d,internalQuery:d=>d}});
const refs={flightRechecks:Object.fromEntries(['start','count','claim','savePart','markFailed','finish','complete'].map(n=>[n,n])),flightWorkflow:{perform:'perform'},flightRecheckAction:{stage:'stage'},tbo:{connectionReadiness:'connection',recheckFlight:'fare',flightTerms:'terms'}};
const starts=[],options={workpoolOptions:{maxParallelism:2,retryActionsByDefault:false}};
const cancellations=[];
const manager={define:spec=>({handler:handler=>({...spec,handler})}),start:async(_ctx,_ref,args,opts)=>{starts.push({args,opts});return 'workflow-'+starts.length;},cancel:async(_ctx,id)=>{cancellations.push(id);}};
const rechecks=load('flightRechecks.ts',{'./flightPreparation':prep,'./_generated/server':{internalMutation:d=>d,internalQuery:d=>d},'./flightWorkflowManager':{manager},'./_generated/api':{internal:refs},'@convex-dev/workflow':{vWorkflowId:v.string(),vResultValidator:v.any()}});
const action=load('flightRecheckAction.ts',{'./_generated/server':{internalAction:d=>d},'./_generated/api':{internal:refs}});
const workflow=load('flightWorkflow.ts',{'./_generated/api':{internal:refs},'./flightWorkflowManager':{manager}});
const segment=(origin,destination,date)=>({origin,destination,departure:date+'T10:00:00',arrival:date+'T14:00:00',airline:'XY',flightNumber:'1'});
async function source(){
 const facts={destination:'Vietnam',adults:4,nights:6,departureCity:'Ahmedabad',startDates:['2099-11-09'],hotelTiers:['4-star'],transportOptions:['private'],meals:['breakfast'],routeStops:[{city:'Hanoi',nights:6}],rooms:[{adults:2,childAges:[]},{adults:2,childAges:[]}]};
 const supplierFacts={leadNationality:'India',flights:'include',flightRequest:'Sample return route, not confirmed live inventory'};
 const tables={intakes:[{_id:'intake',agentId:'agency',revisionNumber:7,factsConfirmed:true,status:'complete_brief',facts,supplierFacts}],flightPreparations:[],flightSearchRuns:[],flightRecheckRuns:[],flightRecheckParts:[]};
 const db={get:async id=>Object.values(tables).flat().find(r=>r._id===id)??null,insert:async(table,row)=>{const _id=table+tables[table].length;tables[table].push({_id,...row});return _id;},patch:async(id,row)=>Object.assign(await db.get(id),row),
 query:table=>{const checks=[],matches=()=>tables[table].filter(r=>checks.every(([k,value])=>r[k]===value));const q={withIndex:(_n,fn)=>{const b={eq:(k,value)=>{checks.push([k,value]);return b;}};fn(b);return q;},unique:async()=>{const rows=matches();assert.ok(rows.length<=1);return rows[0]??null;},take:async n=>matches().slice(0,n)};return q;}};
 const ctx={db},settings={confirmedFlightRequest:supplierFacts.flightRequest,confirmationNote:'SAMPLE mapping only',routes:[{startDate:'2099-11-09',confirmationNote:'SAMPLE confirmed routing/categories, not live inventory',adults:4,children:0,infants:0,directOnly:false,journeyType:2,segments:[{originCity:'Ahmedabad',destinationCity:'Hanoi',origin:'AMD',destination:'HAN',departureDate:'2099-11-09',cabinClass:1},{originCity:'Hanoi',destinationCity:'Ahmedabad',origin:'HAN',destination:'AMD',departureDate:'2099-11-15',cabinClass:1}]}]};
 const preparationId=await prep.create.handler(ctx,{intakeId:'intake',expectedBriefRevision:7,requestId:'prepare',settings}),sourceRequestId=tables.flightPreparations[0].requests[0].requestId;
 const rates=[{resultIndex:'PRIVATE-out',resultGroup:0,supplierTotal:100,currency:'INR',segments:[segment('AMD','HAN','2099-11-09')]},{resultIndex:'PRIVATE-back',resultGroup:1,supplierTotal:200,currency:'INR',segments:[segment('HAN','AMD','2099-11-15')]}];
 tables.flightSearchRuns.push({_id:'search',preparationId,requestId:sourceRequestId,status:'ready',attempt:1,resultJson:JSON.stringify({traceId:'PRIVATE-trace',rates})});
 return {tables,ctx,rates,args:{preparationId,sourceRequestId,requestId:'recheck',rateIndices:[1,0]}};
}
function transport(s,{connection=true,change=()=>{},sourceChange=()=>{},crash=false}={}){
 const calls=[],journal=[],runAction=async(name,args)=>{
  if(name==='connection')return {flights:{ready:connection}};
  calls.push({name,args});if(crash)throw Error('PRIVATE network credential text');
  const fare=s.rates.find(r=>r.resultIndex===args.resultIndex);assert.ok(fare);assert.equal(args.traceId,'PRIVATE-trace');
  const result=name==='fare'?{source:'TBO',traceId:args.traceId,fare:structuredClone(fare),checkedAt:Date.now(),fareEvidence:{passengerBreakdown:[{passengerType:1,passengerCount:4}]},priceChanged:null}:
   {source:'TBO',traceId:args.traceId,resultIndex:args.resultIndex,checkedAt:Date.now(),termsAvailable:true,rules:[{detail:'Sample terms requiring human review'}]};
  change(result,name);sourceChange(s,name);return result;
 };
 const actionCtx={runAction,runMutation:(name,args)=>rechecks[name].handler(s.ctx,args)};
 const step={runQuery:(name,args)=>rechecks[name].handler(s.ctx,args),runMutation:actionCtx.runMutation,runAction:async(name,args,opts)=>{
  assert.equal(name,'stage');assert.equal(opts.retry,false);const result=await action.stage.handler(actionCtx,args);journal.push(result);return result;
 }};
 return {step,actionCtx,calls,journal};
}
async function run(options){const s=await source(),start=await rechecks.start.handler(s.ctx,s.args),io=transport(s,options);await workflow.perform.handler(io.step,{runId:start.runId});return {s,start,io,row:s.tables.flightRecheckRuns[0]};}
test('complete fare and terms stages use exact saved groups and keep workflow results free of costs/references',async()=>{
 const r=await run();assert.equal(r.row.status,'ready');assert.equal(r.io.calls.map(c=>c.name).join(','),'fare,terms,fare,terms');
 const evidence=JSON.parse(await rechecks.inspect.handler(r.s.ctx,{runId:r.start.runId}));assert.equal(evidence.results.length,2);assert.equal(evidence.quoteReady,false);
 assert.equal(r.io.journal.join(','),'ready,ready,ready,ready');assert.equal(JSON.stringify(r.io.journal).includes('PRIVATE'),false);
 const before=starts.length;assert.equal((await rechecks.start.handler(r.s.ctx,{...r.s.args,rateIndices:[0,1]})).state,'ready');assert.equal(starts.length,before);
 const stageResult=await action.stage.handler(r.io.actionCtx,{runId:r.start.runId,slot:0,stage:'fare'});assert.equal(stageResult,'ignored');assert.equal(r.io.calls.length,4);
 const launch=starts.at(-1);assert.equal(launch.opts.startAsync,true);assert.equal(launch.opts.onComplete,'complete');
});
test('missing return cannot create a recheck or start a workflow',async()=>{
 const s=await source(),before=starts.length;await assert.rejects(()=>rechecks.start.handler(s.ctx,{...s.args,rateIndices:[0]}),/each confirmed flight leg/);assert.equal(starts.length,before);assert.equal(s.tables.flightRecheckRuns.length,0);
});
test('missing access, changed fare references/passengers/schedule, empty terms and oversized or old evidence fail safely',async()=>{
 const missing=await run({connection:false});assert.equal(missing.io.calls.length,0);assert.equal(missing.row.failureCode,'connection_unavailable');
 for(const options of [{crash:true},{change:(r,n)=>{if(n==='fare')r.traceId='other';}},{change:(r,n)=>{if(n==='fare')r.fareEvidence.passengerBreakdown[0].passengerCount=1;}},
  {change:(r,n)=>{if(n==='fare')r.fare.segments[0].flightNumber='changed';}},{change:(r,n)=>{if(n==='terms')r.rules=[];}},{change:r=>r.checkedAt-=60000},{change:r=>r.checkedAt=null},{change:r=>r.padding='字'.repeat(90000)}]){
  const r=await run(options);assert.equal(r.row.status,'failed');assert.equal(await rechecks.inspect.handler(r.s.ctx,{runId:r.start.runId}),null);assert.equal(r.row.failureCode.includes('PRIVATE'),false);
 }
});
test('source changes in flight or after completion invalidate every saved recheck',async()=>{
 for(const sourceChange of [s=>s.tables.intakes[0].revisionNumber++,s=>s.tables.flightSearchRuns[0].attempt++,s=>s.tables.flightSearchRuns[0].resultJson='{}']){
  const r=await run({sourceChange});assert.equal(r.row.status,'stale');assert.equal(r.io.calls.length,1);assert.equal(await rechecks.inspect.handler(r.s.ctx,{runId:r.start.runId}),null);
 }
 const r=await run();r.s.tables.intakes[0].revisionNumber++;assert.equal(await rechecks.inspect.handler(r.s.ctx,{runId:r.start.runId}),null);
});
test('atomic stage claims avoid duplicate supplier calls and incomplete parts cannot finish',async()=>{
 const s=await source(),start=await rechecks.start.handler(s.ctx,s.args),args={runId:start.runId,slot:0,stage:'fare'},io=transport(s);
 assert.ok((await rechecks.claim.handler(s.ctx,args)).selectedJson);assert.equal((await rechecks.claim.handler(s.ctx,args)).selectedJson,null);
 assert.equal(await action.stage.handler(io.actionCtx,args),'running');assert.equal(io.calls.length,0);
 await assert.rejects(()=>rechecks.claim.handler(s.ctx,{...args,stage:'terms'}),/matching fare recheck/);
 assert.equal(await rechecks.finish.handler(s.ctx,{runId:start.runId}),'failed');
});
test('a replay uses saved successful parts, skips supplier IO, and needs both stages for each group',async()=>{
 const s=await source(),start=await rechecks.start.handler(s.ctx,s.args),io=transport(s),args={runId:start.runId,slot:0,stage:'fare'};
 assert.equal(await action.stage.handler(io.actionCtx,args),'ready');assert.equal(await action.stage.handler(io.actionCtx,args),'ready');assert.equal(io.calls.length,1);
 await workflow.perform.handler(io.step,{runId:start.runId});assert.equal(io.calls.length,4);assert.equal(s.tables.flightRecheckRuns[0].status,'ready');
});
test('failure/cancel callbacks cannot approve partial runs, overwrite completed rows or act for another workflow',async()=>{
 const s=await source(),start=await rechecks.start.handler(s.ctx,s.args),row=s.tables.flightRecheckRuns[0];
 await rechecks.complete.handler(s.ctx,{workflowId:'other',context:{runId:start.runId},result:{kind:'canceled'}});assert.equal(row.status,'running');
 await rechecks.complete.handler(s.ctx,{workflowId:row.workflowId,context:{runId:start.runId},result:{kind:'success',returnValue:null}});assert.equal(row.status,'failed');
 const r=await run();await rechecks.complete.handler(r.s.ctx,{workflowId:r.row.workflowId,context:{runId:r.start.runId},result:{kind:'canceled'}});assert.equal(r.row.status,'ready');
});
test('request binding, active selection exclusion and three explicit attempts prevent silent restarts',async()=>{
 const s=await source(),first=await rechecks.start.handler(s.ctx,s.args);
 await assert.rejects(()=>rechecks.start.handler(s.ctx,{...s.args,requestId:'duplicate'}),/still running/);
 await rechecks.markFailed.handler(s.ctx,{runId:first.runId,code:'supplier_recheck_failed'});
 for(let attempt=2;attempt<=3;attempt++){const row=await rechecks.start.handler(s.ctx,{...s.args,requestId:'attempt-'+attempt});await rechecks.markFailed.handler(s.ctx,{runId:row.runId,code:'supplier_recheck_failed'});}
 await assert.rejects(()=>rechecks.start.handler(s.ctx,{...s.args,requestId:'attempt-4'}),/Three explicit attempts/);
 assert.equal((await rechecks.start.handler(s.ctx,s.args)).state,'failed');s.tables.flightSearchRuns[0].attempt++;
 await assert.rejects(()=>rechecks.start.handler(s.ctx,s.args),/another or changed source/);
});
test('configured workflow manager disables automatic action retries',()=>{
 const instances=[];class WorkflowManager{constructor(component,opts){instances.push({component,opts});}}
 load('flightWorkflowManager.ts',{'@convex-dev/workflow':{WorkflowManager},'./_generated/api':{components:{workflow:'component'}}});
 assert.equal(instances[0].opts.workpoolOptions.retryActionsByDefault,false);assert.equal(instances[0].opts.workpoolOptions.maxParallelism,options.workpoolOptions.maxParallelism);
});
test('explicit cancellation releases a stuck run and rejects late results without restarting it',async()=>{
 const s=await source(),start=await rechecks.start.handler(s.ctx,s.args),args={runId:start.runId,slot:0,stage:'fare'};
 await rechecks.claim.handler(s.ctx,args);await rechecks.cancel.handler(s.ctx,{runId:start.runId});
 assert.equal(s.tables.flightRecheckRuns[0].failureCode,'operator_canceled');assert.equal(cancellations.at(-1),s.tables.flightRecheckRuns[0].workflowId);
 assert.equal(await rechecks.savePart.handler(s.ctx,{...args,resultJson:'{}'}),'ignored');
 assert.equal((await rechecks.start.handler(s.ctx,s.args)).state,'failed');
 assert.equal((await rechecks.start.handler(s.ctx,{...s.args,requestId:'explicit-new-attempt'})).state,'running');
});
