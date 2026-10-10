const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../convex/intakes.ts'),'utf8')).replace(/^import .*;\r?$/gm,'').replace(/\bexport /g,'');
const v=new Proxy({}, {get:()=>()=>({})});const define=def=>({_handler:def.handler});
const api=new Function('getAuthUserId','ConvexError','v','mutation','query','intakeFacts','intakeQuestion','intakeStatus','intakeSupplierFacts','buildComparisonPlan',source+'\nreturn {create,getMine,listMine,confirmFacts,comparisonPlan,saveSupplierFacts,history,supplierQuestion,extractCandidates,validateFacts,nextQuestion,emptyFacts};')(async ctx=>ctx.userId,class extends Error{},v,define,define,{},{},{},{},require('../lib/comparisonPlan.cjs').buildComparisonPlan);
const original='  Vietnam for four adults, six nights, 9-12 November 2026. Compare 4-star or 5-star, private and shared transport, breakfast, lunch and dinner. Departure from Ahmedabad. Hanoi 2 nights, Ha Long 1 night, Da Nang 3 nights. Two rooms with two adults each.  ';
const requestId='00000000-0000-4000-8000-000000000001';
async function confirmed(){const ctx=context();const {intakeId}=await api.create._handler(ctx,{originalMessage:original,requestId});await api.confirmFacts._handler(ctx,{intakeId,expectedRevisionNumber:1,facts:api.extractCandidates(original)});return {ctx,intakeId};}
test('supplier questions collect nationality, flight inclusion and explicit routing without inference',async()=>{
 const {ctx,intakeId}=await confirmed();let saved=await api.getMine._handler(ctx,{intakeId});assert.equal(saved.nextSupplierQuestion.field,'leadNationality');
 const nation=await api.saveSupplierFacts._handler(ctx,{intakeId,expectedRevisionNumber:2,supplierFacts:{leadNationality:' India '}});
 assert.equal(nation.nextQuestion.field,'flights');
 const flights=await api.saveSupplierFacts._handler(ctx,{intakeId,expectedRevisionNumber:3,supplierFacts:{leadNationality:'India',flights:'include'}});
 assert.equal(flights.nextQuestion.field,'flightRequest');
 await api.saveSupplierFacts._handler(ctx,{intakeId,expectedRevisionNumber:4,supplierFacts:{leadNationality:'India',flights:'include',flightRequest:'Client-confirmed sample routing'}});
 saved=await api.getMine._handler(ctx,{intakeId});assert.equal(saved.revisionNumber,5);assert.equal(saved.nextSupplierQuestion,null);
 assert.equal(saved.supplierFacts.leadNationality,'India');assert.equal(saved.originalMessage,original);
 assert.equal((await api.comparisonPlan._handler(ctx,{intakeId})).options.length,16);
 assert.equal((await api.history._handler(ctx,{intakeId})).length,4);
});
test('supplier saves enforce ownership, complete briefs, stale edits and idempotent retries',async()=>{
 const {ctx,intakeId}=await confirmed(),request={intakeId,expectedRevisionNumber:2,supplierFacts:{leadNationality:'India',flights:'exclude'}};
 await assert.rejects(()=>api.saveSupplierFacts._handler({...ctx,userId:'u2'},request),/not available/);
 await assert.rejects(()=>api.saveSupplierFacts._handler({...ctx,userId:null},request),/Sign in/);
 const first=await api.saveSupplierFacts._handler(ctx,request);assert.equal(first.revisionNumber,3);
 assert.deepEqual(await api.saveSupplierFacts._handler(ctx,request),first);
 await assert.rejects(()=>api.saveSupplierFacts._handler(ctx,{...request,supplierFacts:{leadNationality:'Vietnam',flights:'exclude'}}),/changed/);
 assert.deepEqual(await api.history._handler({...ctx,userId:'u2'},{intakeId}),[]);
});
test('trip corrections clear affected flight and child-age confirmation and retain old supplier answers',async()=>{
 const {ctx,intakeId}=await confirmed();await api.saveSupplierFacts._handler(ctx,{intakeId,expectedRevisionNumber:2,supplierFacts:{leadNationality:'India',flights:'include',flightRequest:'Old confirmed legs',childAgesAtTravelConfirmed:true}});
 const record=await ctx.db.get(intakeId);
 await api.confirmFacts._handler(ctx,{intakeId,expectedRevisionNumber:3,facts:{...record.facts,startDates:['2026-11-12'],rooms:[{adults:2,childAges:[8]},{adults:2,childAges:[]}]}});
 const saved=await api.getMine._handler(ctx,{intakeId});assert.equal(saved.supplierFacts.flightRequest,undefined);assert.equal(saved.supplierFacts.childAgesAtTravelConfirmed,undefined);
 assert.equal(saved.nextSupplierQuestion.field,'flightRequest');
 const history=await api.history._handler(ctx,{intakeId});assert.ok(history.some(row=>row.supplierFacts.flightRequest==='Old confirmed legs'));
 assert.equal(api.supplierQuestion(saved.facts,{leadNationality:'India',flights:'exclude'}).field,'childAgesAtTravelConfirmed');
});
test('excluding flights removes obsolete routing and invalid supplier answers do not overwrite saved versions',async()=>{
 const {ctx,intakeId}=await confirmed();await api.saveSupplierFacts._handler(ctx,{intakeId,expectedRevisionNumber:2,supplierFacts:{leadNationality:'India',flights:'exclude',flightRequest:'Do not retain as current routing'}});
 assert.equal((await api.getMine._handler(ctx,{intakeId})).supplierFacts.flightRequest,undefined);
 await assert.rejects(()=>api.saveSupplierFacts._handler(ctx,{intakeId,expectedRevisionNumber:3,supplierFacts:{leadNationality:'  '}}),/nationality/);
 assert.equal((await api.getMine._handler(ctx,{intakeId})).revisionNumber,3);
});
test('comparison preparation requires confirmed complete owner facts and reflects corrections',async()=>{
  const ctx=context(),{intakeId}=await api.create._handler(ctx,{originalMessage:original,requestId});
  assert.equal(await api.comparisonPlan._handler(ctx,{intakeId}),null);
  await api.confirmFacts._handler(ctx,{intakeId,expectedRevisionNumber:1,facts:api.extractCandidates(original)});
  assert.equal((await api.comparisonPlan._handler(ctx,{intakeId})).options.length,16);
  assert.equal(await api.comparisonPlan._handler({...ctx,userId:'u2'},{intakeId}),null);
  await assert.rejects(()=>api.comparisonPlan._handler({...ctx,userId:null},{intakeId}),/Sign in/);
  const record=await ctx.db.get(intakeId);
  await api.confirmFacts._handler(ctx,{intakeId,expectedRevisionNumber:2,facts:{...record.facts,startDates:['2026-11-12']}});
  const corrected=await api.comparisonPlan._handler(ctx,{intakeId});
  assert.equal(corrected.revisionNumber,3);assert.equal(corrected.options.length,4);
  assert.equal(corrected.options[0].startDate,'2026-11-12');
});
function context(){
 const rows=new Map([['agents',[{_id:'a1',userId:'u1'},{_id:'a2',userId:'u2'}]]]);let number=0;
 const table=name=>{if(!rows.has(name))rows.set(name,[]);return rows.get(name);};
 const db={query(name){let conditions=[],desc=false;return {withIndex(_index,fn){const q={eq(k,val){conditions.push([k,val]);return q;}};fn(q);return this;},order(dir){desc=dir==='desc';return this;},async take(n){let found=table(name).filter(row=>conditions.every(([key,val])=>row[key]===val));if(desc)found=[...found].reverse();return found.slice(0,n);},async unique(){return (await this.take(2))[0]??null;}};},async get(id){for(const list of rows.values()){const found=list.find(r=>r._id===id);if(found)return found;}return null;},async insert(name,value){const _id=`${name}${++number}`;table(name).push({...value,_id});return _id;},async patch(id,value){Object.assign(await this.get(id),value);}};
 return {userId:'u1',db,rows};
}
test('extracts alternatives without selecting a date, hotel or transport choice',()=>{
  const facts=api.extractCandidates(original);
 assert.deepEqual(facts.startDates,['2026-11-09','2026-11-10','2026-11-11','2026-11-12']);
 assert.deepEqual(facts.hotelTiers,['4-star','5-star']);assert.deepEqual(facts.transportOptions,['private','shared']);assert.deepEqual(facts.meals,['breakfast','lunch','dinner']);
 assert.equal(facts.adults,4);assert.equal(facts.nights,6);assert.equal(facts.departureCity,'Ahmedabad');
 assert.deepEqual(facts.routeStops,[{city:'Hanoi',nights:2},{city:'Ha Long',nights:1},{city:'Da Nang',nights:3}]);assert.deepEqual(facts.rooms,[{adults:2,childAges:[]},{adults:2,childAges:[]}]);
});
test('compact adults/nights are candidates and saved hints are excerpts of the original',async()=>{
 const compact=api.extractCandidates('Vietnam 4adults 6nights');assert.equal(compact.adults,4);assert.equal(compact.nights,6);
 const ctx=context(),{intakeId}=await api.create._handler(ctx,{originalMessage:original,requestId});const saved=await api.getMine._handler(ctx,{intakeId});
 assert.ok(saved.sourceHints.some(h=>h.field==='startDates'&&h.snippet==='9-12 November 2026'));
 assert.ok(saved.sourceHints.every(h=>original.includes(h.snippet)&&h.snippet.length<=160));
});
test('missing year, departure, rooms and stop nights are never filled from builder example',()=>{
 const facts=api.extractCandidates('Vietnam four adults, six nights. Hanoi, Ha Long, Da Nang. 9-12 November.');
 assert.deepEqual(facts.startDates,[]);assert.equal(facts.departureCity,undefined);assert.deepEqual(facts.rooms,[]);assert.ok(facts.routeStops.every(stop=>stop.nights===undefined));assert.deepEqual(facts.meals,[]);
 assert.equal(api.nextQuestion(facts,false).field,'confirmation');
 assert.equal(api.nextQuestion(facts,true).field,'startDates');
 const next={...facts,startDates:['2026-11-09']};assert.deepEqual(api.nextQuestion(next,true),{field:'routeStops',prompt:'How many nights should be spent in Hanoi?'});
});
test('original private text persists exactly; extracted candidates remain unconfirmed',async()=>{
 const ctx=context(),result=await api.create._handler(ctx,{originalMessage:original,requestId});
 const saved=await api.getMine._handler(ctx,{intakeId:result.intakeId});assert.equal(saved.originalMessage,original);assert.equal(saved.factsConfirmed,false);assert.deepEqual(saved.facts,api.emptyFacts());assert.equal(saved.status,'needs_confirmation');assert.equal(saved.nextQuestion.field,'confirmation');
 const reload=await api.getMine._handler(ctx,{intakeId:result.intakeId});assert.deepEqual(reload.candidates.startDates,saved.candidates.startDates);
});
test('anonymous and another agency cannot read or confirm original message',async()=>{
 const ctx=context(),result=await api.create._handler(ctx,{originalMessage:original,requestId});
 ctx.userId=null;await assert.rejects(api.getMine._handler(ctx,{intakeId:result.intakeId}),/Sign in/);await assert.rejects(api.create._handler(ctx,{originalMessage:original,requestId}),/Sign in/);
 ctx.userId='u2';assert.equal(await api.getMine._handler(ctx,{intakeId:result.intakeId}),null);assert.deepEqual(await api.listMine._handler(ctx),[]);await assert.rejects(api.confirmFacts._handler(ctx,{intakeId:result.intakeId,expectedRevisionNumber:1,facts:api.extractCandidates(original)}),/not available/);
});
test('create retries are idempotent and cannot reuse an ID for another message',async()=>{
 const ctx=context(),first=await api.create._handler(ctx,{originalMessage:original,requestId});assert.deepEqual(await api.create._handler(ctx,{originalMessage:original,requestId}),first);assert.equal(ctx.rows.get('intakes').length,1);
 await assert.rejects(api.create._handler(ctx,{originalMessage:original+' Changed.',requestId}),/another message/);
});
test('only explicit complete confirmation persists a complete comparison brief; no price or quote',async()=>{
 const ctx=context(),{intakeId}=await api.create._handler(ctx,{originalMessage:original,requestId});const facts=api.extractCandidates(original);
 const confirmed=await api.confirmFacts._handler(ctx,{intakeId,expectedRevisionNumber:1,facts});assert.equal(confirmed.status,'complete_brief');assert.equal(confirmed.nextQuestion,null);
 const saved=await api.getMine._handler(ctx,{intakeId});assert.equal(saved.factsConfirmed,true);assert.deepEqual(saved.facts.startDates,facts.startDates);assert.equal(saved.originalMessage,original);assert.equal('price' in saved,false);assert.equal('quoteId' in saved,false);
  assert.equal((await api.confirmFacts._handler(ctx,{intakeId,expectedRevisionNumber:1,facts})).revisionNumber,2);
  const reordered=Object.fromEntries(Object.entries(facts).reverse());assert.equal((await api.confirmFacts._handler(ctx,{intakeId,expectedRevisionNumber:1,facts:reordered})).revisionNumber,2);
 await assert.rejects(api.confirmFacts._handler(ctx,{intakeId,expectedRevisionNumber:1,facts:{...facts,departureCity:'Mumbai'}}),/changed/);
});
test('incomplete confirmed facts ask one question and do not become complete',async()=>{
 const ctx=context(),{intakeId}=await api.create._handler(ctx,{originalMessage:'Vietnam holiday',requestId});const result=await api.confirmFacts._handler(ctx,{intakeId,expectedRevisionNumber:1,facts:{...api.emptyFacts(),destination:'Vietnam'}});assert.equal(result.status,'needs_details');assert.deepEqual(result.nextQuestion,{field:'adults',prompt:'How many adults are travelling?'});
});
test('invalid occupancy, date, night totals and oversized input fail without overwrites',async()=>{
 const facts=api.extractCandidates(original);
 for(const invalid of [{...facts,adults:3},{...facts,nights:5},{...facts,startDates:['2026-02-30']},{...facts,rooms:[{adults:4,childAges:[18]}]},{...facts,startDates:['2026-11-09','2026-11-09']}])assert.throws(()=>api.validateFacts(invalid));
 const ctx=context();await assert.rejects(api.create._handler(ctx,{originalMessage:'x'.repeat(8001),requestId}),/8000/);assert.equal(ctx.rows.has('intakes'),false);
});
