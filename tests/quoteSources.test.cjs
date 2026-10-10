const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {buildComparisonPlan}=require('../lib/comparisonPlan.cjs');
// Actual internal handler; database and already-tested saved-recheck readers
// are seams. Sample evidence here is never written to the hosted deployment.
const source=stripTypeScriptTypes(fs.readFileSync(require('node:path').join(__dirname,'../convex/quoteSources.ts'),'utf8'))
  .replace(/import \{([^}]+)\} from "([^"]+)";/g,'const {$1}=require("$2");')
  .replace('export const inspect','const inspect')+'\nexports.inspect=inspect;';
const exportsForTest={};
vm.runInNewContext(source,{exports:exportsForTest,TextEncoder,require:name=>{
  if(name==='convex/values')return require(name);
  if(name==='./_generated/server')return {internalQuery:definition=>definition};
  if(name==='../lib/comparisonPlan.cjs')return {buildComparisonPlan};
  if(name==='./intakes')return {nextQuestion:facts=>facts.missing?'missing':null,supplierQuestion:(_,facts)=>facts.leadNationality?null:'nationality'};
  if(name==='./hotelRechecks')return {getSavedHotelRecheck:async(_,run)=>run.status==='ready'?run.evidenceJson:null};
  if(name==='./flightRechecks')return {getSavedFlightRecheck:async(_,run)=>run.status==='ready'?run.evidenceJson:null};
  throw Error('Unexpected import '+name);
}});
function setup(flights='include'){
  const intake={_id:'intake',agentId:'agency',revisionNumber:3,factsConfirmed:true,status:'complete_brief',
    facts:{destination:'Vietnam',adults:4,nights:3,departureCity:'Ahmedabad',startDates:['2099-11-09'],
      hotelTiers:['4-star'],transportOptions:['private'],meals:['breakfast','lunch','dinner'],
      routeStops:[{city:'Hanoi',nights:1},{city:'Da Nang',nights:2}],rooms:[{adults:2,childAges:[]},{adults:2,childAges:[]}]},
    supplierFacts:{leadNationality:'India',flights,flightRequest:'Confirmed sample routing'}};
  const choice=buildComparisonPlan(intake.facts).options[0];
  const hotelPlan={_id:'hotel-plan',intakeId:'intake',agentId:'agency',briefRevision:3,requests:choice.stops.map((stop,i)=>({
    requestId:'hotel-'+i,optionIds:[choice.optionId],stopIndex:i,city:stop.city,hotelTier:choice.hotelTier,
    checkIn:stop.arrivalDate,checkOut:stop.departureDate,rooms:choice.rooms}))};
  const hotelRuns=choice.stops.map((_,i)=>({_id:'hotel-run-'+i,preparationId:'hotel-plan',sourceRequestId:'hotel-'+i,
    attempt:1,searchAttempt:1,status:'ready',selectedJson:'PRIVATE room reference',evidenceJson:'PRIVATE sample hotel price'}));
  const flightPlan={_id:'flight-plan',intakeId:'intake',agentId:'agency',briefRevision:3,
    requests:[{requestId:'flight',optionIds:[choice.optionId],startDate:choice.startDate,endDate:choice.endDate}]};
  const flightRun={_id:'flight-run',preparationId:'flight-plan',sourceRequestId:'flight',searchAttempt:1,
    status:'ready',selectedJson:'PRIVATE fare reference',evidenceJson:'PRIVATE sample fare and terms'};
  const rows=[intake,hotelPlan,...hotelRuns,flightPlan,flightRun];
  return {intake,choice,hotelPlan,hotelRuns,flightPlan,flightRun,
    ctx:{db:{get:async id=>rows.find(row=>row._id===id)??null}},
    args:{intakeId:'intake',expectedBriefRevision:3,comparisonOptionId:choice.optionId,
      hotels:hotelRuns.map((run,i)=>({stopIndex:i,runId:run._id})),...(flights==='include'?{flightRunId:'flight-run'}:{})}};
}
async function check(s){return exportsForTest.inspect.handler(s.ctx,s.args);}
test('exact complete rechecks form only private source facts, never quote readiness or calculated prices',async()=>{
  const s=setup(),result=await check(s);assert.equal(result.state,'source_checks_complete');assert.equal(result.quoteReady,false);
  const packet=JSON.parse(result.evidenceJson);assert.equal(packet.hotels.length,2);assert.equal(packet.flight.runId,'flight-run');
  assert.equal(packet.choice.optionId,s.choice.optionId);assert.equal(packet.quoteReady,false);
  assert.ok(packet.verificationRequired.includes('NET cost'));assert.ok(packet.verificationRequired.includes('GST treatment'));
  assert.equal(Object.hasOwn(packet,'supplierCostMinor'),false);assert.equal(Object.hasOwn(packet,'validUntil'),false);
});
test('every unique overnight stop must have its own complete selected hotel recheck',async()=>{
  for(const alter of [s=>s.args.hotels.pop(),s=>s.args.hotels.push(s.args.hotels[0]),
    s=>s.args.hotels[1].stopIndex=0,s=>s.args.hotels[1].runId=s.args.hotels[0].runId,
    s=>s.args.hotels[0].stopIndex=.5,s=>s.args.hotels[0].runId='missing']){
    const s=setup();alter(s);const result=await check(s);assert.equal(result.state,'blocked');assert.equal(result.evidenceJson,null);
  }
});
test('cross-agency, changed revision, wrong stop/date/tier/room or comparison selection blocks private source assembly',async()=>{
  for(const alter of [s=>s.intake.revisionNumber++,s=>s.intake.factsConfirmed=false,s=>s.intake.facts.missing=true,
    s=>s.intake.supplierFacts={},s=>s.args.comparisonOptionId='unknown',s=>s.hotelPlan.agentId='other',
    s=>s.hotelPlan.intakeId='other',s=>s.hotelPlan.briefRevision++,s=>s.hotelPlan.requests[0].city='other',
    s=>s.hotelPlan.requests[0].checkIn='2099-11-10',s=>s.hotelPlan.requests[0].hotelTier='5-star',
    s=>s.hotelPlan.requests[0].rooms=[{adults:1,childAges:[]}],s=>s.hotelPlan.requests[0].optionIds=[]]){
    const s=setup();alter(s);const result=await check(s);assert.equal(result.state,'blocked');assert.equal(result.evidenceJson,null);
    assert.equal(result.reason.includes('PRIVATE'),false);
  }
});
test('flight inclusion requires the current complete matching fare-and-terms run; excluded flights reject attachments',async()=>{
  for(const alter of [s=>delete s.args.flightRunId,s=>s.flightRun.status='failed',s=>s.flightPlan.agentId='other',
    s=>s.flightPlan.requests[0].endDate='2099-11-14',s=>s.flightPlan.requests[0].optionIds=[]]){
    const s=setup();alter(s);assert.equal((await check(s)).state,'blocked');
  }
  const excluded=setup('exclude');assert.equal((await check(excluded)).state,'source_checks_complete');
  excluded.args.flightRunId='flight-run';assert.equal((await check(excluded)).state,'blocked');
});
test('stale rechecks and excessive complete payloads expose no partial private facts',async()=>{
  const stale=setup();stale.hotelRuns[1].status='stale';assert.equal((await check(stale)).evidenceJson,null);
  const large=setup();large.flightRun.evidenceJson='X'.repeat(512000);
  const result=await check(large);assert.equal(result.state,'blocked');assert.equal(result.evidenceJson,null);
});
