const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

// Exercise the actual mutation handlers, with only Convex's runtime/database replaced.
function load() {
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../convex/itineraries.ts'), 'utf8'))
    .replace(/^import .*;\r?$/gm, '').replace(/\bexport /g, '');
  const v = new Proxy({}, { get: () => () => ({}) });
  const define = def => ({ _handler: def.handler });
  return new Function('getAuthUserId','ConvexError','v','mutation','query','internalMutation','internalQuery','internal','itineraryDraft','itinerarySnapshot','itineraryStatus','itineraryFailureStage', source+'\nreturn {start,listMine,claim,finish,expire,snapshotOf,consecutiveDates,indiaDay,requireEnabled,MAX_CALL_INR,validateUnpricedDraft,recoverSaved};')(
    async ctx=>ctx.userId, class extends Error {}, v, define, define, define, define,
    { itineraryAgent:{generate:'generate'}, itineraries:{expire:'expire'} }, {}, {}, {}, {});
}
const api = load();
const base = { _id:'e1',agentId:'a1',updatedAt:11,destination:'Thailand',departureCity:'Ahmedabad',startDate:'2026-12-25',endDate:'2026-12-28',adults:2,children:0,childAges:[],budgetInr:200000,hotelStandard:'4-star',flightPreference:'flexible',travelPace:'balanced',interests:'Beach. Contact Priya at private@example.com 9876543210',foodPreferences:'vegan; private medical details',specialRequirements:'Sensitive medical fact',clientName:'Priya',clientContact:'9876543210',rawEnquiry:'private raw request'};
function context() {
  const rows = new Map([['agents',[{_id:'a1',userId:'u1'}]],['enquiries',[{...base}]]]);
  let sequence = 0;
  const tableRows = name => { if(!rows.has(name))rows.set(name,[]);return rows.get(name); };
  const db = {
    query(name) {let conditions=[];let descending=false;return {
      withIndex(_name,fn){const q={eq(k,v){conditions.push([k,v]);return q;}};fn(q);return this;},
      order(direction){descending=direction==='desc';return this;},
      async take(n){const list=tableRows(name).filter(r=>conditions.every(([k,v])=>r[k]===v));return (descending?[...list].reverse():list).slice(0,n);},
      async unique(){return (await this.take(2))[0]??null;},async first(){return (await this.take(1))[0]??null;}
    };},
    async get(id){for(const list of rows.values()){const found=list.find(r=>r._id===id);if(found)return found;}return null;},
    async insert(name,value){const _id=`${name}${++sequence}`;tableRows(name).push({...value,_id});return _id;},
    async patch(id,value){Object.assign(await this.get(id),value);}
  };
  const scheduled=[];
  return {userId:'u1',db,rows,scheduled,scheduler:{async runAfter(delay,fn,args){scheduled.push({delay,fn,args});}}};
}
function enabled(){process.env.AI_ITINERARIES_ENABLED='true';process.env.AI_PRICING_VERIFIED_AT=new Date().toISOString();delete process.env.CONVEX_INTERNAL_AI_GATEWAY_HOST;}
const request = n=>({enquiryId:'e1',expectedUpdatedAt:11,requestId:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`});
test('maximum call bound fits ₹5; India budget day changes at local midnight',()=>{
  assert.equal(api.MAX_CALL_INR,4.8);
  assert.equal(api.indiaDay(Date.parse('2026-10-07T18:29:59Z')),'2026-10-07');
  assert.equal(api.indiaDay(Date.parse('2026-10-07T18:30:00Z')),'2026-10-08');
});
test('pricing verification expires and disabled mode fails closed',()=>{
  enabled();api.requireEnabled(Date.now());process.env.AI_PRICING_VERIFIED_AT='2020-01-01T00:00:00Z';assert.throws(()=>api.requireEnabled(Date.now()),/pricing/);
  process.env.AI_ITINERARIES_ENABLED='false';assert.throws(()=>api.requireEnabled(Date.now()),/not enabled/);
});
test('snapshot excludes raw/private fields and forwards canonical preferences only',()=>{
  const snapshot=api.snapshotOf(base), serialized=JSON.stringify(snapshot);
  for(const privateValue of ['Priya','private@example.com','9876543210','Sensitive medical','private medical','private raw'])assert.equal(serialized.includes(privateValue),false);
  assert.equal(snapshot.interests,'beach');assert.equal(snapshot.foodPreferences,'vegan');
  assert.equal('clientName' in snapshot,false);assert.equal('rawEnquiry' in snapshot,false);
  assert.match(api.snapshotOf({...base,departureCity:'private@example.com'}).departureCity,/Unverified/);
});
test('date coverage includes arrival and departure, rejects rollover and >90 nights',()=>{
  assert.deepEqual(api.consecutiveDates('2026-12-25','2026-12-28'),['2026-12-25','2026-12-26','2026-12-27','2026-12-28']);
  assert.throws(()=>api.consecutiveDates('2026-02-30','2026-03-03'));
  assert.throws(()=>api.consecutiveDates('2026-01-01','2026-05-01'));
  assert.throws(()=>api.consecutiveDates('2026-12-25','2026-12-25'));
});
test('ownership and stale requests reject before reservation',async()=>{
  enabled();const ctx=context();ctx.userId='other';await assert.rejects(api.start._handler(ctx,request(1)),/not available/);assert.equal(ctx.rows.has('itineraryDailyBudget'),false);
  ctx.userId='u1';await assert.rejects(api.start._handler(ctx,{...request(1),expectedUpdatedAt:10}),/changed/);
});
test('idempotency reserves once; payload reuse and second active request reject',async()=>{
  enabled();const ctx=context(), first=await api.start._handler(ctx,request(1));
  assert.deepEqual(await api.start._handler(ctx,request(1)),first);
  assert.equal(ctx.rows.get('itineraryDailyBudget')[0].runs,1);
  await assert.rejects(api.start._handler(ctx,{...request(1),expectedUpdatedAt:12}),/different brief/);
  await assert.rejects(api.start._handler(ctx,request(2)),/already running/);
  assert.equal(ctx.scheduled.length,2);
});
test('failed and timed-out runs retain reservations; five-agency cap applies',async()=>{
  enabled();const ctx=context();
  for(let i=1;i<=5;i++){const {runId}=await api.start._handler(ctx,request(i));await api.expire._handler(ctx,{runId});}
  assert.equal(ctx.rows.get('itineraryDailyBudget')[0].reservedPaise,2500);
  await assert.rejects(api.start._handler(ctx,request(6)),/five drafts/);
});
test('global cap rejects independently of agency quota',async()=>{
  enabled();const ctx=context();ctx.rows.set('itineraryDailyBudget',[{_id:'budget',day:api.indiaDay(Date.now()),runs:20,reservedPaise:10000}]);
  await assert.rejects(api.start._handler(ctx,request(1)),/₹100/);assert.equal(ctx.rows.get('itineraryDailyBudget')[0].runs,20);
});
test('claim runs once and result becomes stale when brief changed',async()=>{
  enabled();const ctx=context(),{runId}=await api.start._handler(ctx,request(1));assert.ok(await api.claim._handler(ctx,{runId}));assert.equal(await api.claim._handler(ctx,{runId}),null);
  await ctx.db.patch('e1',{updatedAt:12});
  const draft={days:api.consecutiveDates(base.startDate,base.endDate).map(date=>({date,title:'Suggested day',activities:['Suggested walk']})),assumptions:[],unresolvedFacts:['Live prices and human review required']};
  await api.finish._handler(ctx,{runId,draft});assert.equal((await ctx.db.get(runId)).status,'stale');assert.equal(ctx.rows.get('itineraryDailyBudget')[0].reservedPaise,500);
});
test('completion rejects missing or reordered days',async()=>{
  enabled();const ctx=context(),{runId}=await api.start._handler(ctx,request(1));await api.claim._handler(ctx,{runId});
  await assert.rejects(api.finish._handler(ctx,{runId,draft:{days:[{date:base.startDate,title:'day',activities:['walk']}],assumptions:[],unresolvedFacts:[]}}),/dates/);
});
test('queued previous-day and timed-out claims fail without returning model input',async()=>{
  enabled();
  for(const changes of [{day:'2026-01-01'},{createdAt:Date.now()-180001}]){
    const ctx=context(),{runId}=await api.start._handler(ctx,request(1));await ctx.db.patch(runId,changes);
    assert.equal(await api.claim._handler(ctx,{runId}),null);assert.equal((await ctx.db.get(runId)).status,'failed');
    assert.equal(ctx.rows.get('itineraryDailyBudget')[0].reservedPaise,500);
  }
});
test('unpriced validator rejects money, positive availability and supplier identities',()=>{
  const draft=(activity)=>({days:api.consecutiveDates(base.startDate,base.endDate).map(date=>({date,title:'Suggested day',activities:[activity]})),assumptions:[],unresolvedFacts:['Live supplier pricing and human review required.','Flights and hotels are unverified.']});
  for(const claim of ['Rs 500','500 rupees','Hotel costs 500','A price of 500','Hotel available','Rooms confirmed','Flights booked','TBO hotel','Flights unverified; hotel available','Flights unverified and hotel rooms confirmed'])assert.throws(()=>api.validateUnpricedDraft(draft(claim),base.startDate,base.endDate),undefined,claim);
  api.validateUnpricedDraft(draft('Suggested museum walk; availability is unverified'),base.startDate,base.endDate);
  const missing=draft('Suggested walk');missing.unresolvedFacts=[];assert.throws(()=>api.validateUnpricedDraft(missing,base.startDate,base.endDate),/limitations/);
});
test('unresolved availability labels are missing facts; positive claims remain blocked',()=>{
  const draft={days:api.consecutiveDates(base.startDate,base.endDate).map(date=>({date,title:'Suggested day',activities:['Suggested walk']})),assumptions:[],unresolvedFacts:['Flight availability','Hotel booking','Fresh supplier pricing and human review required.']};
  api.validateUnpricedDraft(draft,base.startDate,base.endDate);
  draft.assumptions=['All suggested activities are subject to opening hours and availability.'];
  api.validateUnpricedDraft(draft,base.startDate,base.endDate);
  draft.assumptions=['Activities are subject to opening hours and hotel rooms confirmed.'];
  assert.throws(()=>api.validateUnpricedDraft(draft,base.startDate,base.endDate),/assumptions\[0\]/);
  draft.assumptions=[];
  for(const claim of ['Hotel rooms are available','Rooms confirmed','Availability: yes','Guaranteed hotel booking']){
    draft.unresolvedFacts[0]=claim;
    assert.throws(()=>api.validateUnpricedDraft(draft,base.startDate,base.endDate),/unresolvedFacts\[0\]/);
  }
  draft.unresolvedFacts[0]='Flight availability';draft.days[0].activities=['Hotel availability'];
  assert.throws(()=>api.validateUnpricedDraft(draft,base.startDate,base.endDate),/activities\[0\]/);
});
test('recover original failed run retains reservation and refuses changed brief or thread',async()=>{
  enabled();const ctx=context(),{runId}=await api.start._handler(ctx,request(1));await ctx.db.patch(runId,{threadId:'original-thread'});await api.expire._handler(ctx,{runId});
  const draft={days:api.consecutiveDates(base.startDate,base.endDate).map(date=>({date,title:'Suggested day',activities:['Suggested walk']})),assumptions:[],unresolvedFacts:['Flight availability','Live supplier pricing and human review required']};
  assert.equal(await api.recoverSaved._handler(ctx,{runId,threadId:'other-thread',draft}),false);
  assert.equal(await api.recoverSaved._handler(ctx,{runId,threadId:'original-thread',draft,inputTokens:1000,outputTokens:500}),true);
  assert.equal((await ctx.db.get(runId)).status,'ready');assert.equal(ctx.rows.get('itineraryDailyBudget')[0].reservedPaise,500);
  assert.equal(await api.recoverSaved._handler(ctx,{runId,threadId:'original-thread',draft}),false);
  const ctx2=context(),second=await api.start._handler(ctx2,request(2));await ctx2.db.patch(second.runId,{threadId:'original-thread'});await api.expire._handler(ctx2,{runId:second.runId});await ctx2.db.patch('e1',{updatedAt:12});
  assert.equal(await api.recoverSaved._handler(ctx2,{runId:second.runId,threadId:'original-thread',draft}),false);assert.equal((await ctx2.db.get(second.runId)).status,'stale');
});
