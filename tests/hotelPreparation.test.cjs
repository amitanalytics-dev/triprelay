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
const search=load('hotelSearch.ts',{'./_generated/server':{internalAction:d=>d},'./_generated/api':{internal:{
  hotelPreparation:{beginSearch:'begin',finishSearch:'finish'},tbo:{connectionReadiness:'connection',searchHotels:'search'}}}});
function inputs(){
  const facts={destination:'Vietnam',adults:4,nights:6,departureCity:'Ahmedabad',startDates:['2099-11-09','2099-11-10','2099-11-11','2099-11-12'],
    hotelTiers:['4-star','5-star'],transportOptions:['private','shared'],meals:['breakfast','lunch','dinner'],
    routeStops:[{city:'Hanoi',nights:2},{city:'Ha Long',nights:1},{city:'Da Nang',nights:3}],rooms:[{adults:2,childAges:[]},{adults:2,childAges:[]}]};
  const customer={leadNationality:'India',flights:'exclude'};
  const settings={confirmedNationalityLabel:'India',nationalityCode:'IN',confirmationNote:'SAMPLE explicitly mapped nationality',refundableOnly:false,
    mappings:facts.routeStops.flatMap((stop,stopIndex)=>facts.hotelTiers.map((hotelTier,i)=>({stopIndex,city:stop.city,hotelTier,
      hotelCodes:[String(1000+stopIndex*10+i)],confirmationNote:'SAMPLE verified mapping, not actual permitted inventory'})))};
  return {facts,customer,settings};
}
function setup(){
  const input=inputs(),tables={intakes:[{_id:'intake',agentId:'agency',revisionNumber:7,factsConfirmed:true,status:'complete_brief',facts:input.facts,supplierFacts:input.customer}],hotelPreparations:[],hotelSearchRuns:[]};
  const db={get:async id=>Object.values(tables).flat().find(r=>r._id===id)??null,
    insert:async(table,record)=>{const _id=table+tables[table].length;tables[table].push({_id,...record});return _id;},
    patch:async(id,changes)=>Object.assign(await db.get(id),changes),
    query:table=>{const checks=[];const q={withIndex:(_name,fn)=>{const b={eq:(key,value)=>{checks.push([key,value]);return b;}};fn(b);return q;},unique:async()=>tables[table].find(r=>checks.every(([key,value])=>r[key]===value))??null};return q;}};
  const ctx={db};return {input,tables,ctx};
}
test('16 Vietnam choices derive 24 private hotel searches without duplicate transport requests or invented codes',()=>{
  const {facts,customer,settings}=inputs(),plan=buildHotelSearchPlan(facts,customer,settings);
  assert.equal(plan.optionCount,16);assert.equal(plan.requests.length,24);assert.ok(plan.requests.every(r=>r.optionIds.length===2));
  const first=plan.requests[0];assert.equal(first.checkIn,'2099-11-09');assert.equal(first.checkOut,'2099-11-11');assert.equal(first.nationality,'IN');
  assert.deepEqual(first.rooms,facts.rooms);assert.deepEqual(first.hotelCodes,['1000']);assert.equal(plan.requests.find(r=>r.city==='Da Nang').checkOut,'2099-11-15');
  assert.equal(new Set(plan.requests.map(r=>r.requestId)).size,24);assert.match(plan.requiredChecks[0],/not verified/);
});
test('missing, duplicate, wrong-city/tier codes and unconfirmed nationality/child ages block preparation',()=>{
  for(const mutate of [s=>s.mappings.pop(),s=>s.mappings[1]=s.mappings[0],s=>s.mappings[0].city='Unknown',s=>s.mappings[0].hotelTier='3-star',
    s=>s.mappings[0].hotelCodes=['not-a-code'],s=>s.mappings[0].hotelCodes=['1000','1000'],s=>s.nationalityCode='',s=>s.confirmedNationalityLabel='Different',s=>s.confirmationNote='']){
    const {facts,customer,settings}=inputs();mutate(settings);assert.throws(()=>buildHotelSearchPlan(facts,customer,settings));
  }
  const {facts,customer,settings}=inputs();facts.rooms[0].childAges=[8];assert.throws(()=>buildHotelSearchPlan(facts,customer,settings),/answers/);
  customer.childAgesAtTravelConfirmed=true;assert.equal(buildHotelSearchPlan(facts,customer,settings).requests[0].rooms[0].childAges[0],8);
});
test('saved preparation is immutable/idempotent and one search claim excludes concurrent work',async()=>{
  const {input,tables,ctx}=setup(),args={intakeId:'intake',expectedBriefRevision:7,requestId:'prepare',settings:input.settings};
  const id=await prep.create.handler(ctx,args);assert.equal(await prep.create.handler(ctx,args),id);assert.equal(tables.hotelPreparations.length,1);
  await assert.rejects(()=>prep.create.handler(ctx,{...args,settings:{...input.settings,refundableOnly:true}}),/different/);
  const requestId=tables.hotelPreparations[0].requests[0].requestId;
  const first=await prep.beginSearch.handler(ctx,{preparationId:id,requestId,retry:false});assert.equal(first.state,'start');
  assert.equal((await prep.beginSearch.handler(ctx,{preparationId:id,requestId,retry:false})).state,'busy');
  tables.intakes[0].revisionNumber++;
  assert.equal(await prep.finishSearch.handler(ctx,{preparationId:id,requestId,attempt:1,resultJson:'{"sample":true}'}),'stale');
  assert.equal(await prep.inspectResult.handler(ctx,{preparationId:id,requestId}),null);assert.equal(tables.hotelSearchRuns[0].resultJson,undefined);
});
async function actionCase({connection=true,result={rates:[{hotelCode:'1000'}],checkedAt:Date.now()},failure=false,changeSource=false}={}){
  const s=setup();const id=await prep.create.handler(s.ctx,{intakeId:'intake',expectedBriefRevision:7,requestId:'prepare',settings:s.input.settings});
  const requestId=s.tables.hotelPreparations[0].requests[0].requestId;let supplierCalls=0;
  const ctx={runMutation:async(name,args)=>(name==='begin'?prep.beginSearch:prep.finishSearch).handler(s.ctx,args),runAction:async(name,args)=>{
    if(name==='connection')return {hotels:{ready:connection}};supplierCalls++;assert.deepEqual(args.hotelCodes,['1000']);assert.equal(Object.hasOwn(args,'city'),false);
    if(changeSource)s.tables.intakes[0].revisionNumber++;if(failure)throw Error('PRIVATE supplier credential/body');return result;}};
  const args={preparationId:id,requestId};const response=await search.run.handler(ctx,args);return {s,ctx,args,response,get calls(){return supplierCalls;}};
}
test('missing access prevents supplier search and records a safe connection blocker without retrying',async()=>{
  const run=await actionCase({connection:false});assert.equal(run.calls,0);assert.equal(run.response.state,'failed');
  assert.equal(run.s.tables.hotelSearchRuns[0].failureCode,'connection_unavailable');
  await search.run.handler(run.ctx,run.args);assert.equal(run.calls,0);assert.equal(run.s.tables.hotelSearchRuns[0].attempt,1);
});
test('successful raw search persists once privately; failures/stale/unrelated/oversized results cannot be used',async()=>{
  const run=await actionCase();assert.equal(run.response.state,'ready');assert.equal(run.response.rateCount,1);assert.equal(run.calls,1);
  assert.ok(await prep.inspectResult.handler(run.s.ctx,run.args));await search.run.handler(run.ctx,run.args);assert.equal(run.calls,1);
  for(const options of [{failure:true},{changeSource:true},{result:{rates:[{hotelCode:'9999'}]}},{result:{rates:[],padding:'x'.repeat(256001)}},{result:{rates:[],padding:'字'.repeat(90000)}}]){
    const failed=await actionCase(options);assert.notEqual(failed.response.state,'ready');assert.equal(failed.response.rateCount,0);
    assert.equal(await prep.inspectResult.handler(failed.s.ctx,failed.args),null);assert.equal(JSON.stringify(failed.s.tables.hotelSearchRuns).includes('PRIVATE'),false);
  }
});
test('explicit retry is capped and superseded attempts cannot overwrite the newer result',async()=>{
  const run=await actionCase({failure:true});
  for(let i=0;i<4;i++)await search.run.handler(run.ctx,{...run.args,retry:true});assert.equal(run.calls,3);assert.equal(run.s.tables.hotelSearchRuns[0].attempt,3);
  const stale=await prep.finishSearch.handler(run.s.ctx,{...run.args,attempt:1,resultJson:'{"old":true}'});assert.equal(stale,'ignored');
});
