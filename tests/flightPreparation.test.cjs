const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {buildFlightSearchPlan}=require('../lib/flightSearchPlan.cjs');
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
const model=load('flightPreparationModel.ts',{});
const intakes=load('intakes.ts',{'@convex-dev/auth/server':{getAuthUserId:async c=>c.userId},'./_generated/server':{query:d=>d,mutation:d=>d},
  './schema':{intakeFacts:v.any(),intakeQuestion:v.any(),intakeStatus:v.any(),intakeSupplierFacts:v.any()}});
const prep=load('flightPreparation.ts',{'./flightPreparationModel':model,'./intakes':intakes,'./_generated/server':{internalMutation:d=>d,internalQuery:d=>d}});
const search=load('flightSearch.ts',{'./_generated/server':{internalAction:d=>d},'./_generated/api':{internal:{
  flightPreparation:{beginSearch:'begin',finishSearch:'finish'},tbo:{connectionReadiness:'connection',searchFlights:'search'}}}});
function inputs(){
  const facts={destination:'Vietnam',adults:4,nights:6,departureCity:'Ahmedabad',startDates:['2099-11-09','2099-11-10','2099-11-11','2099-11-12'],
    hotelTiers:['4-star','5-star'],transportOptions:['private','shared'],meals:['breakfast','lunch','dinner'],
    routeStops:[{city:'Hanoi',nights:2},{city:'Ha Long',nights:1},{city:'Da Nang',nights:3}],rooms:[{adults:2,childAges:[]},{adults:2,childAges:[]}]};
  const customer={leadNationality:'India',flights:'include',flightRequest:'SAMPLE requested Ahmedabad to Hanoi and Da Nang to Ahmedabad, all four dates.'};
  const settings={confirmedFlightRequest:customer.flightRequest,confirmationNote:'SAMPLE operator-confirmed complete request, no real routing verified',
    routes:facts.startDates.map(startDate=>({startDate,adults:4,children:0,infants:0,directOnly:false,journeyType:3,confirmationNote:'SAMPLE explicit airports/passenger categories',
      segments:[{originCity:'Ahmedabad',destinationCity:'Hanoi',origin:'AMD',destination:'HAN',departureDate:startDate,cabinClass:2},
        {originCity:'Da Nang',destinationCity:'Ahmedabad',origin:'DAD',destination:'AMD',departureDate:`2099-11-${Number(startDate.slice(-2))+6}`,cabinClass:2}]}))};
  return {facts,customer,settings};
}
function setup(){
  const input=inputs(),tables={intakes:[{_id:'intake',agentId:'agency',revisionNumber:7,factsConfirmed:true,status:'complete_brief',facts:input.facts,supplierFacts:input.customer}],flightPreparations:[],flightSearchRuns:[]};
  const db={get:async id=>Object.values(tables).flat().find(r=>r._id===id)??null,
    insert:async(table,record)=>{const _id=table+tables[table].length;tables[table].push({_id,...record});return _id;},
    patch:async(id,changes)=>Object.assign(await db.get(id),changes),
    query:table=>{const checks=[];const q={withIndex:(_name,fn)=>{const b={eq:(key,value)=>{checks.push([key,value]);return b;}};fn(b);return q;},unique:async()=>tables[table].find(r=>checks.every(([key,value])=>r[key]===value))??null};return q;}};
  const ctx={db};return {input,tables,ctx};
}
test('four explicit open-jaw flight requests preserve all 16 comparison choices and correct return dates',()=>{
  const {facts,customer,settings}=inputs(),plan=buildFlightSearchPlan(facts,customer,settings);
  assert.equal(plan.optionCount,16);assert.equal(plan.requests.length,4);assert.ok(plan.requests.every(row=>row.optionIds.length===4));
  assert.deepEqual(plan.requests.map(row=>row.segments[1].departureDate),['2099-11-15','2099-11-16','2099-11-17','2099-11-18']);
  assert.equal(plan.requests[0].segments[0].origin,'AMD');assert.equal(plan.requests[0].journeyType,3);assert.equal(plan.requests[0].adults,4);
  assert.equal(facts.startDates.length,4);assert.match(plan.requiredChecks[0],/not inferred/);
});
test('missing alternatives, contradictory routing/passenger totals and stale customer flight notes cannot prepare search',()=>{
  for(const mutate of [s=>s.routes.pop(),s=>s.routes[1]=s.routes[0],s=>s.confirmedFlightRequest='Different request',s=>s.routes[0].adults=3,
    s=>s.routes[0].segments[0].origin='',s=>s.routes[0].segments[0].originCity='Unconfirmed city',s=>s.routes[0].segments[1].departureDate='2099-11-20',
    s=>s.routes[0].segments[0].departureDate='2099-11-08',s=>s.routes[0].journeyType=2,s=>s.routes[0].segments[0].cabinClass=9,s=>s.confirmationNote='']){
    const {facts,customer,settings}=inputs();mutate(settings);assert.throws(()=>buildFlightSearchPlan(facts,customer,settings));
  }
  const {facts,customer,settings}=inputs();customer.flights='exclude';assert.throws(()=>buildFlightSearchPlan(facts,customer,settings),/included flights/);
});
test('confirmed child travel ages still require explicit supplier passenger categories and total-group limit includes infants',()=>{
  const {facts,customer,settings}=inputs();facts.rooms[0].childAges=[0,12];
  assert.throws(()=>buildFlightSearchPlan(facts,customer,settings),/travel ages/);customer.childAgesAtTravelConfirmed=true;
  assert.throws(()=>buildFlightSearchPlan(facts,customer,settings),/passenger categories/);
  settings.routes.forEach(row=>{row.adults=5;row.infants=1;});
  const result=buildFlightSearchPlan(facts,customer,settings);assert.equal(result.requests[0].adults,5);assert.equal(result.requests[0].infants,1);
  facts.adults=8;facts.rooms=[{adults:4,childAges:[0]},{adults:4,childAges:[0]}];
  settings.routes.forEach(row=>{row.adults=8;row.infants=2;});assert.throws(()=>buildFlightSearchPlan(facts,customer,settings),/nine people/);
});
async function actionCase({connection=true,failure=false,changeSource=false,result={traceId:'PRIVATE-TRACE',rates:[{resultIndex:'PRIVATE-RESULT',resultGroup:0}],checkedAt:Date.now()}}={}){
  const s=setup(),id=await prep.create.handler(s.ctx,{intakeId:'intake',expectedBriefRevision:7,requestId:'prepare',settings:s.input.settings});
  assert.equal(await prep.create.handler(s.ctx,{intakeId:'intake',expectedBriefRevision:7,requestId:'prepare',settings:s.input.settings}),id);
  const args={preparationId:id,requestId:'2099-11-09'};let supplierCalls=0;
  const ctx={runMutation:async(name,args)=>(name==='begin'?prep.beginSearch:prep.finishSearch).handler(s.ctx,args),runAction:async(name,args)=>{
    if(name==='connection')return {flights:{ready:connection}};supplierCalls++;assert.equal(args.segments[0].origin,'AMD');
    assert.equal(Object.hasOwn(args.segments[0],'originCity'),false);assert.equal(Object.hasOwn(args,'confirmedFlightRequest'),false);
    if(changeSource)s.tables.intakes[0].revisionNumber++;if(failure)throw Error('PRIVATE token/request body');return result;}};
  return {s,ctx,args,response:await search.run.handler(ctx,args),get calls(){return supplierCalls;}};
}
test('missing flight connection cannot search; successful raw references remain private and completed calls are reused',async()=>{
  const blocked=await actionCase({connection:false});assert.equal(blocked.calls,0);assert.equal(blocked.response.state,'failed');
  assert.equal(blocked.s.tables.flightSearchRuns[0].failureCode,'connection_unavailable');
  const run=await actionCase();assert.equal(run.calls,1);assert.equal(run.response.state,'ready');assert.equal(run.response.rateCount,1);
  assert.equal(JSON.stringify(run.response).includes('PRIVATE'),false);assert.match(await prep.inspectResult.handler(run.s.ctx,run.args),/PRIVATE-TRACE/);
  assert.equal((await search.run.handler(run.ctx,run.args)).rateCount,null);assert.equal(run.calls,1);
});
test('source corrections, missing references, oversized results and supplier exceptions cannot become usable fares',async()=>{
  for(const options of [{changeSource:true},{failure:true},{result:{traceId:'',rates:[]}},{result:{traceId:' PRIVATE ',rates:[]}},
    {result:{traceId:'trace',rates:[{resultIndex:'',resultGroup:0}]}},{result:{traceId:'trace',rates:[],padding:'字'.repeat(90000)}}]){
    const run=await actionCase(options);assert.notEqual(run.response.state,'ready');assert.equal(run.response.rateCount,0);
    assert.equal(await prep.inspectResult.handler(run.s.ctx,run.args),null);assert.equal(JSON.stringify(run.s.tables.flightSearchRuns).includes('PRIVATE'),false);
  }
});
test('explicit retry cap and expired-running claim prevent late completion from replacing current source',async()=>{
  const failed=await actionCase({failure:true});for(let i=0;i<4;i++)await search.run.handler(failed.ctx,{...failed.args,retry:true});
  assert.equal(failed.calls,3);assert.equal(failed.s.tables.flightSearchRuns[0].attempt,3);
  const s=setup(),id=await prep.create.handler(s.ctx,{intakeId:'intake',expectedBriefRevision:7,requestId:'prepare',settings:s.input.settings});
  const args={preparationId:id,requestId:'2099-11-09',retry:false};assert.equal((await prep.beginSearch.handler(s.ctx,args)).attempt,1);
  assert.equal((await prep.beginSearch.handler(s.ctx,args)).state,'busy');s.tables.flightSearchRuns[0].startedAt-=130000;
  assert.equal((await prep.beginSearch.handler(s.ctx,{...args,retry:true})).attempt,2);
  assert.equal(await prep.finishSearch.handler(s.ctx,{preparationId:id,requestId:args.requestId,attempt:1,resultJson:'{"old":true}'}),'ignored');
  assert.equal(await prep.finishSearch.handler(s.ctx,{preparationId:id,requestId:args.requestId,attempt:2,resultJson:'{"current":true}'}),'ready');
  s.tables.intakes[0].revisionNumber++;assert.equal(await prep.inspectResult.handler(s.ctx,{preparationId:id,requestId:args.requestId}),null);
});
