const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {buildHotelSearchPlan}=require('../lib/hotelSearchPlan.cjs');
const {v}=require('convex/values');
function load(file,deps){
  const source=fs.readFileSync(path.join(__dirname,'../convex/',file),'utf8');
  const names=[...source.matchAll(/export (?:const|function) (\w+)/g)].map(m=>m[1]);
  const code=stripTypeScriptTypes(source).replace(/import \{([^}]+)\} from "([^"]+)";/g,'const {$1}=require("$2");').replace(/export const /g,'const ').replace(/export function /g,'function ')+'\nObject.assign(exports,{'+names.join(',')+'});';
  const exports={};vm.runInNewContext(code,{exports,Date,JSON,TextEncoder,require:name=>{
    if(Object.hasOwn(deps,name))return deps[name];if(name==='convex/values')return require(name);
    if(name.startsWith('../lib/'))return require(path.join(__dirname,'..',name.slice(3)));throw Error(name);
  }});return exports;
}
const model=load('hotelPreparationModel.ts',{});
const intakes=load('intakes.ts',{'@convex-dev/auth/server':{getAuthUserId:async c=>c.userId},'./_generated/server':{query:d=>d,mutation:d=>d},
  './schema':{intakeFacts:v.any(),intakeQuestion:v.any(),intakeStatus:v.any(),intakeSupplierFacts:v.any()}});
const prep=load('hotelPreparation.ts',{'./hotelPreparationModel':model,'./intakes':intakes,'./_generated/server':{internalMutation:d=>d,internalQuery:d=>d}});
const rechecks=load('hotelRechecks.ts',{'./hotelPreparation':prep,'./_generated/server':{internalMutation:d=>d,internalQuery:d=>d}});
const action=load('hotelRecheckAction.ts',{'./_generated/server':{internalAction:d=>d},'./_generated/api':{internal:{
  hotelRechecks:{begin:'begin',finish:'finish'},tbo:{connectionReadiness:'connection',recheckHotel:'recheck'}}}});
function setup(){
  const facts={destination:'Vietnam',adults:4,nights:1,departureCity:'Ahmedabad',startDates:['2099-11-09'],hotelTiers:['4-star'],transportOptions:['private'],
    meals:['breakfast'],routeStops:[{city:'Hanoi',nights:1}],rooms:[{adults:2,childAges:[]},{adults:2,childAges:[]}]};
  const tables={intakes:[{_id:'intake',agentId:'agency',revisionNumber:7,factsConfirmed:true,status:'complete_brief',facts,supplierFacts:{leadNationality:'India',flights:'exclude'}}],
    hotelPreparations:[],hotelSearchRuns:[],hotelRecheckRuns:[]};
  const db={get:async id=>Object.values(tables).flat().find(r=>r._id===id)??null,
    insert:async(table,row)=>{const _id=table+tables[table].length;tables[table].push({_id,...row});return _id;},patch:async(id,row)=>Object.assign(await db.get(id),row),
    query:table=>{const checks=[];const q={withIndex:(_name,fn)=>{const b={eq:(key,value)=>{checks.push([key,value]);return b;}};fn(b);return q;},unique:async()=>tables[table].find(r=>checks.every(([key,value])=>r[key]===value))??null};return q;}};
  const ctx={db};
  const settings={confirmedNationalityLabel:'India',nationalityCode:'IN',confirmationNote:'SAMPLE mapping only',refundableOnly:false,
    mappings:[{stopIndex:0,city:'Hanoi',hotelTier:'4-star',hotelCodes:['1000'],confirmationNote:'SAMPLE code, not real approved inventory'}]};
  const rate={hotelCode:'1000',bookingCode:'PRIVATE-BOOKABLE-UNIT',roomNames:['Twin','Twin'],supplierTotal:100,currency:'INR',
    fareEvidence:{netCostBasisVerified:false,gstTreatmentVerified:false},terms:'Sample source terms',compulsoryFeesConfirmed:false};
  return {tables,ctx,settings,rate};
}
async function source(){
  const s=setup(),id=await prep.create.handler(s.ctx,{intakeId:'intake',expectedBriefRevision:7,requestId:'prepare',settings:s.settings});
  const sourceRequestId=s.tables.hotelPreparations[0].requests[0].requestId;
  s.tables.hotelSearchRuns.push({_id:'search',preparationId:id,requestId:sourceRequestId,status:'ready',attempt:1,
    resultJson:JSON.stringify({rates:[s.rate],checkedAt:Date.now(),source:'TBO'})});
  return {...s,args:{preparationId:id,sourceRequestId,rateIndex:0,requestId:'recheck',retry:false}};
}
async function runCase({connection=true,failure=false,changed=false,alterResult=()=>{},alterSource=()=>{}}={}){
  const s=await source();let calls=0;
  const ctx={runMutation:async(name,args)=>(name==='begin'?rechecks.begin:rechecks.finish).handler(s.ctx,args),runAction:async(name,args)=>{
    if(name==='connection')return {hotels:{ready:connection}};calls++;assert.equal(args.bookingCode,s.rate.bookingCode);assert.equal(Object.keys(args).join(','),'bookingCode');
    if(failure)throw Error('PRIVATE credential/network body');
    const result={source:'TBO',checkedAt:Date.now(),rateChanged:null,rates:[{...s.rate,supplierTotal:changed?110:100}]};alterResult(result);alterSource(s);return result;
  }};
  return {s,ctx,response:await action.run.handler(ctx,s.args),get calls(){return calls;}};
}
test('selecting one room from a two-room request, foreign rate/code and invalid indices cannot start rechecking',async()=>{
  for(const edit of [r=>r.roomNames=['Twin'],r=>r.bookingCode='',r=>r.hotelCode='9999',r=>r.supplierTotal=-1]){
    const s=await source(),rate={...s.rate};edit(rate);s.tables.hotelSearchRuns[0].resultJson=JSON.stringify({rates:[rate]});
    await assert.rejects(()=>rechecks.begin.handler(s.ctx,s.args),/complete.*room|requested room/);assert.equal(s.tables.hotelRecheckRuns.length,0);
  }
  const s=await source();for(const rateIndex of [-1,1.5,1000])await assert.rejects(()=>rechecks.begin.handler(s.ctx,{...s.args,rateIndex}),/Choose a rate/);
});
test('exact saved unit is rechecked once privately; unchanged and changed rates both remain unverified for quotes',async()=>{
  for(const changed of [false,true]){
    const run=await runCase({changed});assert.equal(run.response.state,'ready');assert.equal(run.response.quoteReady,false);assert.equal(run.calls,1);
    const evidence=JSON.parse(await rechecks.inspect.handler(run.s.ctx,run.s.args));
    assert.equal(evidence.priceChanged,changed);assert.equal(evidence.supplierReportedRateChanged,null);assert.equal(evidence.quoteReady,false);
    assert.equal(evidence.selectedRate.fareEvidence.netCostBasisVerified,false);assert.equal(evidence.selectedRate.supplierTotal,changed?110:100);
    assert.equal(JSON.stringify(run.response).includes('PRIVATE'),false);
    await action.run.handler(run.ctx,run.s.args);assert.equal(run.calls,1);
  }
});
test('missing access prevents recheck; supplier failure, mismatched/duplicated unit, old timestamp and oversized evidence fail safely',async()=>{
  const missing=await runCase({connection:false});assert.equal(missing.calls,0);assert.equal(missing.response.state,'failed');
  assert.equal(missing.s.tables.hotelRecheckRuns[0].failureCode,'connection_unavailable');
  for(const options of [{failure:true},{alterResult:r=>r.rates[0].bookingCode='Different'}, {alterResult:r=>r.rates[0].roomNames=['Other','Other']},
    {alterResult:r=>r.rates.push(r.rates[0])},{alterResult:r=>r.checkedAt-=60000},{alterResult:r=>r.padding='字'.repeat(90000)}]){
    const run=await runCase(options);assert.equal(run.response.state,'failed');assert.equal(await rechecks.inspect.handler(run.s.ctx,run.s.args),null);
    assert.equal(JSON.stringify(run.s.tables.hotelRecheckRuns.map(r=>r.failureCode)).includes('PRIVATE'),false);
  }
});
test('changed brief, changed search attempt or changed source unit discards in-flight evidence and hides old results',async()=>{
  for(const alterSource of [s=>s.tables.intakes[0].revisionNumber++,s=>s.tables.hotelSearchRuns[0].attempt++,
    s=>s.tables.hotelSearchRuns[0].resultJson=JSON.stringify({rates:[{...s.rate,supplierTotal:90}]}),s=>s.tables.hotelSearchRuns[0].resultJson=JSON.stringify({rates:[{...s.rate,roomNames:['Missing']} ]})]){
    const run=await runCase({alterSource});assert.equal(run.response.state,'stale');assert.equal(await rechecks.inspect.handler(run.s.ctx,run.s.args),null);
    assert.equal(run.s.tables.hotelRecheckRuns[0].resultJson,undefined);
  }
  const ready=await runCase();ready.s.tables.intakes[0].revisionNumber++;assert.equal(await rechecks.inspect.handler(ready.s.ctx,ready.s.args),null);
});
test('busy/retry/late-completion safeguards and request-source binding preserve the current recheck',async()=>{
  const s=await source();assert.equal((await rechecks.begin.handler(s.ctx,s.args)).attempt,1);
  assert.equal((await rechecks.begin.handler(s.ctx,s.args)).state,'busy');
  s.tables.hotelRecheckRuns[0].startedAt-=130000;
  assert.equal((await rechecks.begin.handler(s.ctx,{...s.args,retry:true})).attempt,2);
  assert.equal(await rechecks.finish.handler(s.ctx,{...s.args,attempt:1,failureCode:'supplier_recheck_failed'}),'ignored');
  await rechecks.finish.handler(s.ctx,{...s.args,attempt:2,failureCode:'supplier_recheck_failed'});
  await rechecks.begin.handler(s.ctx,{...s.args,retry:true});await rechecks.finish.handler(s.ctx,{...s.args,attempt:3,failureCode:'supplier_recheck_failed'});
  assert.equal((await rechecks.begin.handler(s.ctx,{...s.args,retry:true})).state,'failed');
  s.tables.hotelSearchRuns[0].attempt++;await assert.rejects(()=>rechecks.begin.handler(s.ctx,s.args),/another or changed source/);
});
