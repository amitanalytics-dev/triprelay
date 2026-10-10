const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

// Actual handlers with an in-memory database seam. These checks do not stand
// in for deployed Convex transaction tests or real supplier evidence.
function load(filename, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, '../convex/', filename), 'utf8');
  const names = [...source.matchAll(/export (?:const|function) (\w+)/g)].map(match => match[1]);
  const compiled = stripTypeScriptTypes(source)
    .replace(/import \{([^}]+)\} from "([^"]+)";/g, 'const {$1} = require("$2");')
    .replace(/export const /g, 'const ').replace(/export function /g,'function ') + '\nObject.assign(exports, {' + names.join(',') + '});';
  const exports = {};
  vm.runInNewContext(compiled, { exports, Date, Blob, Uint8Array, require: name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === 'convex/values') return require(name);
    if (name.startsWith('../lib/')) return require(path.join(__dirname, '..', name.slice(3)));
    throw Error('Unexpected import ' + name);
  } });
  return exports;
}
const model = load('quoteModel.ts', {});
const {v}=require('convex/values');
const intakes=load('intakes.ts',{'@convex-dev/auth/server':{getAuthUserId:async ctx=>ctx.userId},
  './_generated/server':{mutation:d=>d,query:d=>d},'./schema':{intakeFacts:v.any(),intakeQuestion:v.any(),intakeStatus:v.any(),intakeSupplierFacts:v.any()}});
const api = load('quotes.ts', {
  '@convex-dev/auth/server': { getAuthUserId: async ctx => ctx.userId },
  './_generated/server': { internalMutation: d => d, internalQuery: d => d, mutation: d => d, query: d => d },
  './quoteModel': model,
  './intakes':intakes,
});
const supplierRuns=load('supplierRuns.ts',{'./quotes':api,'./_generated/server':{query:d=>d},
  './schema':{intakeFacts:v.any(),intakeSupplierFacts:v.any(),intakeStatus:v.any()},
  './hotelPreparation':{getSelectedRate:async ctx=>ctx.hotelSelection??null},
  './flightPreparation':{getSelectedFares:async ctx=>ctx.flightSelection??null}});
function supplierSetup(){
  const s=setup(),now=Date.now();
  s.tables.intakes.push({_id:'intake',agentId:'agency-a',revisionNumber:2,createdAt:now,status:'complete_brief',factsConfirmed:true,
    originalMessage:'SAMPLE private request: vegetarian meals and a budget limit; originally three adults.',
    facts:{adults:4,startDates:['2099-12-25'],hotelTiers:['4-star'],transportOptions:['private'],meals:['breakfast'],routeStops:[{city:'Hanoi',nights:1}],rooms:[{adults:2,childAges:[]},{adults:2,childAges:[]}]},supplierFacts:{leadNationality:'India',flights:'include',flightRequest:'SAMPLE private request'}});
  Object.assign(s.tables,{hotelPreparations:[{_id:'hotel-plan',intakeId:'intake',agentId:'agency-a',briefRevision:2,createdAt:now,requests:[{requestId:'hotel-search',checkIn:'2099-12-25',checkOut:'2099-12-26',city:'Hanoi',hotelTier:'4-star'}]}],
    flightPreparations:[{_id:'flight-plan',intakeId:'intake',agentId:'agency-a',briefRevision:2,createdAt:now,requests:[{requestId:'flight-search',startDate:'2099-12-25',endDate:'2099-12-26',segments:[{originCity:'Ahmedabad',destinationCity:'Hanoi'}]}]}],
    hotelSearchRuns:[{preparationId:'hotel-plan',requestId:'hotel-search',status:'ready',attempt:1,startedAt:now,resultJson:'PRIVATE source price'}],
    hotelRecheckRuns:[{preparationId:'hotel-plan',sourceRequestId:'hotel-search',rateIndex:0,searchAttempt:1,selectedJson:'PRIVATE hotel reference',status:'ready',attempt:1,startedAt:now}],
    flightSearchRuns:[{preparationId:'flight-plan',requestId:'flight-search',status:'ready',attempt:1,startedAt:now,resultJson:'PRIVATE flight price'}],
    flightRecheckRuns:[{_id:'recheck',preparationId:'flight-plan',sourceRequestId:'flight-search',rateIndices:[0],searchAttempt:1,selectedJson:'PRIVATE flight reference',status:'failed',failureCode:'PRIVATE unsafe failure text',startedAt:now}],
    flightRecheckParts:[{runId:'recheck',slot:0,stage:'fare',status:'ready',startedAt:now,resultJson:'PRIVATE fare cost'},{runId:'recheck',slot:0,stage:'terms',status:'failed',startedAt:now}]});
  const ctx={...s.ctx('reviewer'),hotelSelection:{searchAttempt:1,selectedJson:'PRIVATE hotel reference'},flightSelection:{searchAttempt:1,selectedJson:'PRIVATE flight reference'}};
  return {s,ctx};
}
function setup() {
  const now = Date.now();
  const tables = { users: [{ _id: 'reviewer', email: 'reviewer@example.test' }],
    agents: [{ _id: 'agency-a', userId: 'agent-a', businessName: 'Test agency', contactName: 'Test',
      contactEmail: 'agency@example.test', contactPhone: '1234567890', defaultMarkupPercent: 10 }],
    enquiries: [{ _id: 'trip', agentId: 'agency-a', revisionNumber: 1,
      startDate: '2099-12-25', endDate: '2099-12-26', flightPreference: 'no-flights' }],
    quoteVersions: [{ _id: 'version', _creationTime: now, enquiryId: 'trip', agentId: 'agency-a',
      briefRevision: 1, agentMarkupBps: 1000, option: 'balanced', requestId: 'request', createdAt: now,
      requiredComponentIds: ['hotel'], unresolvedFacts: [], branding: { businessName: 'Test agency',
        contactName: 'Test', contactEmail: 'agency@example.test', contactPhone: '1234567890' },
      components: [{ id: 'hotel', kind: 'hotel', mode: 'live', available: true, checkedAt: now - 1000,
        validUntil: now + 60000, currency: 'INR', supplierCostMinor: 10000,
        compulsoryFeesConfirmed: true, termsConfirmed: true, supplierReference: 'PRIVATE_REFERENCE',
        costBasis: 'verified_net', gstIncluded: true,
        description: 'Private room facts', terms: 'Private confirmed terms' }],
      days: [{ date: '2099-12-25', title: 'Arrival', activities: ['Transfer to hotel'] },
        { date: '2099-12-26', title: 'Departure', activities: ['Return transfer'] }],
      inclusions: ['Hotel stay'], exclusions: ['Visa services'], cancellationTerms: ['Verified test cancellation terms'] }],
    quoteReviews: [{ _id: 'review', quoteVersionId: 'version', reviewerUserId: 'reviewer', decision: 'approved',
      note: '', reviewedAt: now - 100 }],
    quoteReviewerGrants: [{ _id: 'grant', userId: 'reviewer', active: true, confirmedAt: now - 10000 }],
    quoteReleases: [], quoteComparisons: [], quoteReviewCounter: [], quoteApprovalCounts: [], quotePdfArtifacts: [],intakes:[] };
  let writes = 0;
  const db = {
    get: async id => Object.values(tables).flat().find(row => row._id === id) ?? null,
    query: table => {
      const conditions = []; let reverse = false;
      const query = {
        withIndex: (name, fn) => { const builder = { eq: (key, value) => { conditions.push([key, value]); return builder; } }; if (fn) fn(builder); return query; },
        order: direction => { reverse = direction === 'desc'; return query; },
        rows: () => { const rows = tables[table].filter(row => conditions.every(([key, value]) => row[key] === value));
          rows.sort((a, b) => (a.reviewedAt ?? a.createdAt ?? 0) - (b.reviewedAt ?? b.createdAt ?? 0)); return reverse ? rows.reverse() : rows; },
        first: async () => query.rows()[0] ?? null,
        take: async n => query.rows().slice(0, n),
        unique: async () => { const rows = query.rows(); assert.ok(rows.length <= 1); return rows[0] ?? null; },
      }; return query;
    },
    insert: async (table, fields) => { const id = table + '-' + (++writes); tables[table].push({ ...fields, _id: id }); return id; },
    patch: async (id, fields) => { const row = await db.get(id); Object.assign(row, fields); },
  };
  return { tables, ctx: userId => ({ userId, db }), writes: () => writes };
}
test('owner receives approved prices and no private supplier fields', async () => {
  const s = setup(); const result = await api.getMine.handler(s.ctx('agent-a'), { quoteVersionId: 'version' });
  assert.equal(result.ready, true); assert.equal(result.quote.prices.finalClientPriceMinor, 12100);
  for (const field of ['PRIVATE_REFERENCE', 'supplierCostMinor', 'supplierReference', 'Private room facts',
    'operatorSellingPriceMinor', 'agentMarkupBps', 'agentMarginMinor']) {
    assert.equal(JSON.stringify(result).includes(field), false);
  }
});
test('anonymous and second-agency access cannot read or release owner quote', async () => {
  const s = setup();
  await assert.rejects(() => api.getMine.handler(s.ctx(null), { quoteVersionId: 'version' }), /sign in/);
  s.tables.agents.push({ _id: 'agency-b', userId: 'agent-b' });
  assert.equal(await api.getMine.handler(s.ctx('agent-b'), { quoteVersionId: 'version' }), null);
  await assert.rejects(() => api.release.handler(s.ctx('agent-b'), { quoteVersionId: 'version' }), /not found/);
  assert.equal(s.writes(), 0);
});
test('ordinary agency cannot inspect private facts or approve its quote', async () => {
  const s = setup();
  await assert.rejects(() => api.inspectForReview.handler(s.ctx('agent-a'), { quoteVersionId: 'version' }), /restricted/);
  await assert.rejects(() => api.decide.handler(s.ctx('agent-a'), { quoteVersionId: 'version', decision: 'approved', note: '' }), /restricted/);
  assert.equal(s.writes(), 0);
});
test('revoked reviewer, changed brief, expired facts and newest rejection block release', async () => {
  for (const change of [s => { s.tables.quoteReviewerGrants[0].active = false; },
    s => { s.tables.enquiries[0].revisionNumber = 2; },
    s => { s.tables.quoteVersions[0].components[0].validUntil = Date.now() - 1; },
    s => { s.tables.quoteReviews.push({ ...s.tables.quoteReviews[0], _id: 'later', decision: 'rejected', reviewedAt: Date.now() }); }]) {
    const s = setup(); change(s);
    const result = await api.getMine.handler(s.ctx('agent-a'), { quoteVersionId: 'version' });
    assert.equal(result.ready, false); assert.equal(result.quote, null);
    await assert.rejects(() => api.release.handler(s.ctx('agent-a'), { quoteVersionId: 'version' }), /approval/);
    assert.equal(s.writes(), 0);
  }
});
test('reviewer approval requires full itinerary and verified complete facts', async () => {
  for (const change of [s => { s.tables.quoteVersions[0].days.pop(); },
    s => { s.tables.quoteVersions[0].components[0].compulsoryFeesConfirmed = false; },
    s => { s.tables.quoteVersions[0].components[0].costBasis = 'unverified'; },
    s => { s.tables.quoteVersions[0].components[0].gstIncluded = false; },
    s => { s.tables.quoteVersions[0].cancellationTerms = []; },
    s => { s.tables.quoteVersions[0].components[0].mode = 'test'; }]) {
    const s = setup(); change(s);
    await assert.rejects(() => api.decide.handler(s.ctx('reviewer'), { quoteVersionId: 'version', decision: 'approved', note: '' }));
    assert.equal(s.writes(), 0);
  }
});
test('release is idempotent and rejects stale facts even after an earlier release', async () => {
  const s = setup();
  const first = await api.release.handler(s.ctx('agent-a'), { quoteVersionId: 'version' });
  assert.equal(await api.release.handler(s.ctx('agent-a'), { quoteVersionId: 'version' }), first);
  assert.equal(s.tables.quoteReleases.length, 1);
  s.tables.quoteVersions[0].components[0].validUntil = Date.now() - 1;
  await assert.rejects(() => api.release.handler(s.ctx('agent-a'), { quoteVersionId: 'version' }), /approval/);
});
test('reviewer assignment rejects a mismatched confirmed sign-in identity', async () => {
  const s = setup();
  await assert.rejects(() => api.setReviewer.handler(s.ctx(null), { userId: 'reviewer', confirmedSignInEmail: 'wrong@example.test', active: true }), /identity/);
  assert.equal(s.writes(), 0);
});
test('distinct approved versions count once and duplicate approvals do not add writes', async () => {
  const s = setup(); s.tables.quoteReviews = [];
  const request = { quoteVersionId: 'version', decision: 'approved', note: '' };
  const first = await api.decide.handler(s.ctx('reviewer'), request);
  assert.equal(s.tables.quoteReviewCounter[0].approvedVersions, 1);
  assert.equal(await api.decide.handler(s.ctx('reviewer'), request), first);
  assert.equal(s.tables.quoteReviews.length, 1);
  const next = { ...s.tables.quoteVersions[0], _id: 'version-two', requestId: 'two' };
  s.tables.quoteVersions.push(next);
  await api.decide.handler(s.ctx('reviewer'), { ...request, quoteVersionId: 'version-two' });
  assert.equal(s.tables.quoteReviewCounter[0].approvedVersions, 2);
  assert.equal(s.tables.quoteApprovalCounts.length, 2);
});
test('quote list is owner-scoped and never includes supplier facts', async () => {
  const s = setup();
  const result = await api.listMine.handler(s.ctx('agent-a'), { enquiryId: 'trip' });
  assert.equal(result.length, 1);
  for (const field of ['components', 'supplierCostMinor', 'PRIVATE_REFERENCE', 'branding']) assert.equal(JSON.stringify(result).includes(field), false);
  s.tables.agents.push({ _id: 'agency-b', userId: 'agent-b' });
  await assert.rejects(() => api.listMine.handler(s.ctx('agent-b'), { enquiryId: 'trip' }), /not found/);
});
test('review queue and assessment require the reviewer role and do not imply approval', async () => {
  const s = setup(); s.tables.quoteReviews = [];
  await assert.rejects(() => api.reviewQueue.handler(s.ctx('agent-a')), /restricted/);
  await assert.rejects(() => api.reviewDetails.handler(s.ctx(null), { quoteVersionId: 'version' }), /restricted/);
  const queue = await api.reviewQueue.handler(s.ctx('reviewer'));
  assert.equal(queue[0].decision, 'pending');
  const details = await api.reviewDetails.handler(s.ctx('reviewer'), { quoteVersionId: 'version' });
  assert.equal(details.decision, 'pending'); assert.equal(details.prices.finalClientPriceMinor, 12100);
  assert.equal(s.tables.quoteReviews.length, 0); assert.equal(s.writes(), 0);
  s.tables.quoteVersions[0].components[0].gstIncluded = false;
  const incomplete = await api.reviewDetails.handler(s.ctx('reviewer'), { quoteVersionId: 'version' });
  assert.equal(incomplete.prices, null); assert.ok(incomplete.reasons.length);
});

test('PDF download rejects non-owners and incomplete quotes before rendering', async () => {
  const s = setup(); let rendered = 0;
  const pdf = load('quotePdf.ts', {
    './_generated/server': { action:d=>d }, './_generated/api': { api:{quotes:{getMine:'get',release:'release'}},internal:{quotes:{cachedPdf:'cached',attachPdf:'attach'}} },
    '../lib/quotePdf.mjs': { renderQuotePdf:async()=>{rendered++;return new Uint8Array([1]);} },
  });
  const ctx = userId => ({ runQuery:(_,args)=>api.getMine.handler(s.ctx(userId),args),
    runMutation:(_,args)=>api.release.handler(s.ctx(userId),args) });
  s.tables.agents.push({_id:'agency-b',userId:'agent-b'});
  await assert.rejects(()=>pdf.download.handler(ctx('agent-b'),{quoteVersionId:'version'}),/supplier facts/);
  s.tables.quoteVersions[0].unresolvedFacts=['Confirm meals'];
  await assert.rejects(()=>pdf.download.handler(ctx('agent-a'),{quoteVersionId:'version'}),/supplier facts/);
  assert.equal(rendered,0); assert.equal(s.tables.quoteReleases.length,0);
});
test('PDF rendering receives only final prices and release rechecks reviewer revocation', async () => {
  const s = setup(); let revoke = false;
  const pdf = load('quotePdf.ts', {
    './_generated/server':{action:d=>d}, './_generated/api':{api:{quotes:{getMine:'get',release:'release'}},internal:{quotes:{cachedPdf:'cached',attachPdf:'attach'}}},
    '../lib/quotePdf.mjs':{renderQuotePdf:async result=>{
      assert.equal(JSON.stringify(result).includes('PRIVATE_REFERENCE'),false);
      assert.equal(JSON.stringify(result).includes('supplierCostMinor'),false);
      assert.equal(result.quote.prices.finalClientPriceMinor,12100);
      if(revoke)s.tables.quoteReviewerGrants[0].active=false;
      return new Uint8Array([37,80,68,70]);
    }},
  });
  const ctx={runQuery:(ref,args)=>ref==='get'?api.getMine.handler(s.ctx('agent-a'),args):api.cachedPdf.handler(s.ctx('agent-a'),args),
    runMutation:(ref,args)=>ref==='release'?api.release.handler(s.ctx('agent-a'),args):api.attachPdf.handler(s.ctx('agent-a'),args),
    storage:{store:async()=> 'stored-pdf',delete:async()=>{},get:async()=>new Blob([new Uint8Array([37,80,68,70])])}};
  revoke=true;
  await assert.rejects(()=>pdf.download.handler(ctx,{quoteVersionId:'version'}),/approval/);
  assert.equal(s.tables.quoteReleases.length,0);
  revoke=false;s.tables.quoteReviewerGrants[0].active=true;
  const bytes=await pdf.download.handler(ctx,{quoteVersionId:'version'});
  assert.equal(bytes.byteLength,4); assert.equal(s.tables.quoteReleases.length,1);
  assert.equal(s.tables.quotePdfArtifacts.length,1);
  assert.equal((await pdf.download.handler(ctx,{quoteVersionId:'version'})).byteLength,4);
  assert.equal(s.tables.quotePdfArtifacts.length,1);
});
test('stored PDF attachment is private, idempotent and still blocked after expiry',async()=>{
  const s=setup();s.tables.agents.push({_id:'agency-b',userId:'agent-b'});
  await assert.rejects(()=>api.attachPdf.handler(s.ctx('agent-b'),{quoteVersionId:'version',storageId:'file'}),/not found/);
  assert.equal(await api.attachPdf.handler(s.ctx('agent-a'),{quoteVersionId:'version',storageId:'file'}),'file');
  assert.equal(await api.attachPdf.handler(s.ctx('agent-a'),{quoteVersionId:'version',storageId:'unused-retry'}),'file');
  assert.equal(s.tables.quotePdfArtifacts.length,1);
  assert.equal(await api.cachedPdf.handler(s.ctx('agent-b'),{quoteVersionId:'version'}),null);
  s.tables.quoteVersions[0].components[0].validUntil=Date.now()-1;
  await assert.rejects(()=>api.attachPdf.handler(s.ctx('agent-a'),{quoteVersionId:'version',storageId:'retry'}),/approval/);
});
test('minimum selling floor blocks approval, release and PDF attachment and stays private when satisfied',async()=>{
  const s=setup();s.tables.quoteVersions[0].components[0].minimumClientPriceMinor=12101;
  assert.equal((await api.getMine.handler(s.ctx('agent-a'),{quoteVersionId:'version'})).ready,false);
  await assert.rejects(()=>api.decide.handler(s.ctx('reviewer'),{quoteVersionId:'version',decision:'approved',note:''}),/minimum selling/);
  await assert.rejects(()=>api.release.handler(s.ctx('agent-a'),{quoteVersionId:'version'}),/minimum selling/);
  await assert.rejects(()=>api.attachPdf.handler(s.ctx('agent-a'),{quoteVersionId:'version',storageId:'file'}),/minimum selling/);
  s.tables.quoteVersions[0].components[0].minimumClientPriceMinor=12100;
  const result=await api.getMine.handler(s.ctx('agent-a'),{quoteVersionId:'version'});
  assert.equal(result.ready,true);assert.equal(JSON.stringify(result).includes('minimumClientPriceMinor'),false);
});
function intakeCase(s){
  s.tables.intakes.push({_id:'intake',agentId:'agency-a',revisionNumber:5,factsConfirmed:true,status:'complete_brief',
    facts:{destination:'Vietnam',adults:4,nights:1,departureCity:'Ahmedabad',startDates:['2099-12-25'],hotelTiers:['4-star','5-star'],
      transportOptions:['private','shared'],meals:['breakfast'],routeStops:[{city:'Hanoi',nights:1}],rooms:[{adults:2,childAges:[]},{adults:2,childAges:[]}]},
    supplierFacts:{leadNationality:'India',flights:'exclude'}});
  const version=s.tables.quoteVersions[0];const {enquiryId,agentId,briefRevision,agentMarkupBps,branding,createdAt,_id,_creationTime,...content}=version;
  const transfer={...content.components[0],id:'transfer',kind:'transfer'};
  return {...content,components:[...content.components,transfer],requiredComponentIds:[...content.requiredComponentIds,'transfer'],
    comparisonCoverage:{stays:[{stopIndex:0,componentIds:['hotel']}],transportComponentIds:['transfer'],meals:[{meal:'breakfast',componentIds:['hotel']}]},
    intakeId:'intake',expectedBriefRevision:5,comparisonOptionId:'2099-12-25/4-star/private'};
}
test('trusted intake quote captures one exact choice and source revision without flattening alternatives',async()=>{
  const s=setup(),request=intakeCase(s);
  const id=await api.saveIntakeVersion.handler(s.ctx(null),request),version=await s.ctx(null).db.get(id);
  assert.equal(version.enquiryId,undefined);assert.equal(version.intakeId,'intake');assert.equal(version.briefRevision,5);
  assert.equal(version.comparisonScope.choice.hotelTier,'4-star');assert.equal(version.comparisonScope.choice.rooms.length,2);
  assert.equal(s.tables.intakes[0].facts.hotelTiers.length,2);assert.equal(s.tables.intakes[0].facts.transportOptions.length,2);
  assert.equal(await api.saveIntakeVersion.handler(s.ctx(null),request),id);
  await assert.rejects(()=>api.saveIntakeVersion.handler(s.ctx(null),{...request,comparisonOptionId:'2099-12-25/5-star/shared'}),/different quote/);
  await assert.rejects(()=>api.saveIntakeVersion.handler(s.ctx(null),{...request,requestId:'other',comparisonOptionId:'not-confirmed'}),/confirmed comparison/);
});
test('intake quote owner projection, approval and PDF release track current intake answers',async()=>{
  const s=setup(),request=intakeCase(s),id=await api.saveIntakeVersion.handler(s.ctx(null),request);
  await api.decide.handler(s.ctx('reviewer'),{quoteVersionId:id,decision:'approved',note:''});
  const ready=await api.getMine.handler(s.ctx('agent-a'),{quoteVersionId:id});assert.equal(ready.ready,true);
  assert.equal(ready.quote.comparisonChoice.transport,'private');assert.equal(JSON.stringify(ready).includes('leadNationality'),false);
  assert.equal(JSON.stringify(ready).includes('PRIVATE_REFERENCE'),false);
  const list=await api.listForIntake.handler(s.ctx('agent-a'),{intakeId:'intake'});assert.equal(list.length,1);assert.match(list[0].comparisonLabel,/4-star/);
  s.tables.agents.push({_id:'agency-b',userId:'agent-b'});
  await assert.rejects(()=>api.listForIntake.handler(s.ctx('agent-b'),{intakeId:'intake'}),/not found/);
  assert.equal(await api.getMine.handler(s.ctx('agent-b'),{quoteVersionId:id}),null);
  s.tables.intakes[0].revisionNumber++;
  assert.equal((await api.getMine.handler(s.ctx('agent-a'),{quoteVersionId:id})).ready,false);
  await assert.rejects(()=>api.release.handler(s.ctx('agent-a'),{quoteVersionId:id}),/approval/);
  await assert.rejects(()=>api.attachPdf.handler(s.ctx('agent-a'),{quoteVersionId:id,storageId:'file'}),/approval/);
});
test('incomplete customer search facts, removed source choices and unproven lowest-price claims stay blocked',async()=>{
  const s=setup(),request=intakeCase(s);s.tables.intakes[0].supplierFacts={};
  await assert.rejects(()=>api.saveIntakeVersion.handler(s.ctx(null),request),/supplier-search/);
  s.tables.intakes[0].supplierFacts={leadNationality:'India',flights:'exclude'};
  const id=await api.saveIntakeVersion.handler(s.ctx(null),request);
  s.tables.intakes[0].facts.hotelTiers=['5-star'];
  assert.equal((await api.getMine.handler(s.ctx('agent-a'),{quoteVersionId:id})).ready,false);
  s.tables.intakes[0].facts.hotelTiers=['4-star','5-star'];
  const lowest=await api.saveIntakeVersion.handler(s.ctx(null),{...request,requestId:'lowest',option:'lowest'});
  await assert.rejects(()=>api.decide.handler(s.ctx('reviewer'),{quoteVersionId:lowest,decision:'approved',note:''}),/comparison pricing/);
  assert.equal(s.tables.quoteApprovalCounts.length,0);
});
test('intake quotes cannot omit priced stays, requested transport or required meals',async()=>{
 for(const coverage of [undefined,{stays:[],transportComponentIds:['transfer'],meals:[{meal:'breakfast',componentIds:['hotel']}]},
   {stays:[{stopIndex:0,componentIds:['hotel']}],transportComponentIds:[],meals:[{meal:'breakfast',componentIds:['hotel']}]},
   {stays:[{stopIndex:0,componentIds:['hotel']}],transportComponentIds:['transfer'],meals:[]}]){
   const s=setup(),request=intakeCase(s),id=await api.saveIntakeVersion.handler(s.ctx(null),{...request,comparisonCoverage:coverage});
   await assert.rejects(()=>api.decide.handler(s.ctx('reviewer'),{quoteVersionId:id,decision:'approved',note:''}),/component coverage/);
   assert.equal(s.tables.quoteApprovalCounts.length,0);
 }
});

test('internal comparison needs every current reviewed alternative and loses completeness when one expires or the brief changes',async()=>{
  const s=setup(),request=intakeCase(s);
  const ids=['2099-12-25/4-star/private','2099-12-25/4-star/shared','2099-12-25/5-star/private','2099-12-25/5-star/shared'];
  assert.equal((await api.assessIntakeComparison.handler(s.ctx(null),{intakeId:'intake'})).complete,false);
  for(let i=0;i<ids.length;i++){
    const components=request.components.map(c=>({...c,supplierCostMinor:i===1?5000:10000}));
    const id=await api.saveIntakeVersion.handler(s.ctx(null),{...request,requestId:`comparison-${i}`,comparisonOptionId:ids[i],components});
    await api.decide.handler(s.ctx('reviewer'),{quoteVersionId:id,decision:'approved',note:''});
    const state=await api.assessIntakeComparison.handler(s.ctx(null),{intakeId:'intake'});
    assert.equal(state.expectedCount,4);assert.equal(state.readyCount,i+1);assert.equal(state.complete,i===3);
  }
  const ready=await api.assessIntakeComparison.handler(s.ctx(null),{intakeId:'intake'});
  assert.deepEqual(Array.from(ready.lowestOptionIds),[ids[1]]);assert.equal(ready.finalClientPriceMinor,12100);
  assert.equal(JSON.stringify(ready).includes('PRIVATE_REFERENCE'),false);
  s.tables.quoteVersions.at(-1).components[0].validUntil=Date.now()-1;
  const expired=await api.assessIntakeComparison.handler(s.ctx(null),{intakeId:'intake'});
  assert.equal(expired.complete,false);assert.equal(expired.finalClientPriceMinor,null);
  s.tables.intakes[0].revisionNumber++;
  assert.equal((await api.assessIntakeComparison.handler(s.ctx(null),{intakeId:'intake'})).readyCount,0);
});
test('comparison check cannot infer completeness from truncated history or missing customer search details',async()=>{
  const s=setup(),request=intakeCase(s);
  await api.saveIntakeVersion.handler(s.ctx(null),request);
  const seed=s.tables.quoteVersions.at(-1);
  for(let i=0;i<200;i++)s.tables.quoteVersions.push({...seed,_id:`history-${i}`});
  const state=await api.assessIntakeComparison.handler(s.ctx(null),{intakeId:'intake'});
  assert.equal(state.complete,false);assert.match(state.reason,/bounded check/);
  s.tables.intakes[0].supplierFacts={};
  assert.match((await api.assessIntakeComparison.handler(s.ctx(null),{intakeId:'intake'})).reason,/customer search/);
});

async function reviewedComparison(){
  const s=setup(),request=intakeCase(s);
  const choices=['2099-12-25/4-star/private','2099-12-25/4-star/shared','2099-12-25/5-star/private','2099-12-25/5-star/shared'];
  for(let i=0;i<choices.length;i++){
    const id=await api.saveIntakeVersion.handler(s.ctx(null),{...request,requestId:`base-${i}`,comparisonOptionId:choices[i],
      components:request.components.map(c=>({...c,supplierCostMinor:i===1?5000:10000}))});
    await api.decide.handler(s.ctx('reviewer'),{quoteVersionId:id,decision:'approved',note:''});
  }
  return {s,request,choices};
}
test('lowest-price version freezes the complete comparison and needs its own review before release',async()=>{
  const {s,request,choices}=await reviewedComparison();
  const args={intakeId:'intake',expectedBriefRevision:5,comparisonOptionId:choices[1],requestId:'lowest-with-proof'};
  await assert.rejects(()=>api.saveLowestIntakeVersion.handler(s.ctx(null),{...args,comparisonOptionId:choices[0]}),/lowest-price choice/);
  const id=await api.saveLowestIntakeVersion.handler(s.ctx(null),args);
  assert.equal(s.tables.quoteComparisons.length,1);assert.equal(s.tables.quoteComparisons[0].versionIds.length,4);
  assert.equal(await api.saveLowestIntakeVersion.handler(s.ctx(null),args),id);
  assert.equal((await api.getMine.handler(s.ctx('agent-a'),{quoteVersionId:id})).ready,false);
  await api.decide.handler(s.ctx('reviewer'),{quoteVersionId:id,decision:'approved',note:'Checked entire comparison'});
  const result=await api.getMine.handler(s.ctx('agent-a'),{quoteVersionId:id});
  assert.equal(result.ready,true);assert.equal(result.quote.prices.finalClientPriceMinor,12100);assert.equal(result.option,'lowest');
  assert.equal(JSON.stringify(result).includes('comparisonEvidenceId'),false);assert.equal(JSON.stringify(result).includes('PRIVATE_REFERENCE'),false);
  await api.release.handler(s.ctx('agent-a'),{quoteVersionId:id});
  assert.equal(s.tables.quoteApprovalCounts.length,5);
  assert.equal((await api.assessIntakeComparison.handler(s.ctx(null),{intakeId:'intake'})).complete,true);
});
test('newer alternative, revoked review, expired comparison, changed source and edited lowest content invalidate delivery',async()=>{
  for(const failure of ['new-version','revoked-review','expired','brief-change','edited-content']){
    const {s,request,choices}=await reviewedComparison();
    const id=await api.saveLowestIntakeVersion.handler(s.ctx(null),{intakeId:'intake',expectedBriefRevision:5,comparisonOptionId:choices[1],requestId:'lowest-proof'});
    await api.decide.handler(s.ctx('reviewer'),{quoteVersionId:id,decision:'approved',note:''});
    const version=await s.ctx(null).db.get(id);
    if(failure==='new-version')await api.saveIntakeVersion.handler(s.ctx(null),{...request,requestId:'new-search',comparisonOptionId:choices[0]});
    if(failure==='revoked-review')s.tables.quoteReviewerGrants[0].active=false;
    if(failure==='expired')s.tables.quoteVersions.find(v=>v._id===s.tables.quoteComparisons[0].versionIds[0]).components[0].validUntil=Date.now()-1;
    if(failure==='brief-change')s.tables.intakes[0].revisionNumber++;
    if(failure==='edited-content')version.inclusions=['A different unverified inclusion'];
    const blocked=await api.getMine.handler(s.ctx('agent-a'),{quoteVersionId:id});assert.equal(blocked.ready,false,failure);
    await assert.rejects(()=>api.release.handler(s.ctx('agent-a'),{quoteVersionId:id}),/approval/);
    await assert.rejects(()=>api.attachPdf.handler(s.ctx('agent-a'),{quoteVersionId:id,storageId:'file'}),/approval/);
  }
});
test('incomplete comparison cannot persist a lowest version or evidence',async()=>{
  const s=setup(),request=intakeCase(s);
  await api.saveIntakeVersion.handler(s.ctx(null),request);
  await assert.rejects(()=>api.saveLowestIntakeVersion.handler(s.ctx(null),{intakeId:'intake',expectedBriefRevision:5,comparisonOptionId:request.comparisonOptionId,requestId:'lowest'}),/Every requested/);
  assert.equal(s.tables.quoteComparisons.length,0);assert.equal(s.tables.quoteVersions.length,2);
});
test('lowest quote and reviewer proof use the earliest comparison expiry, including a different alternative',async()=>{
  const {s,choices}=await reviewedComparison(),deadline=Date.now()+10000;
  const other=s.tables.quoteVersions.find(v=>v.comparisonScope?.choice.optionId===choices[0]);
  other.components[0].validUntil=deadline;
  const id=await api.saveLowestIntakeVersion.handler(s.ctx(null),{intakeId:'intake',expectedBriefRevision:5,comparisonOptionId:choices[1],requestId:'short-comparison'});
  const details=await api.reviewDetails.handler(s.ctx('reviewer'),{quoteVersionId:id});
  assert.equal(details.comparison.current,true);assert.equal(details.comparison.choices.length,4);assert.equal(details.comparison.validUntil,deadline);
  await assert.rejects(()=>api.reviewDetails.handler(s.ctx('agent-a'),{quoteVersionId:id}),/restricted/);
  await api.decide.handler(s.ctx('reviewer'),{quoteVersionId:id,decision:'approved',note:''});
  const quote=await api.getMine.handler(s.ctx('agent-a'),{quoteVersionId:id});assert.equal(quote.quote.prices.validUntil,deadline);
  const releaseId=await api.release.handler(s.ctx('agent-a'),{quoteVersionId:id});
  assert.equal((await s.ctx(null).db.get(releaseId)).prices.validUntil,deadline);
});
test('supplier status and original enquiry are restricted before reads, including revoked reviewer access',async()=>{
  const {s,ctx}=supplierSetup();
  for(const userId of [null,'agent-a','other-user']){
    await assert.rejects(()=>supplierRuns.queue.handler(s.ctx(userId),{}),/restricted/);
    await assert.rejects(()=>supplierRuns.details.handler(s.ctx(userId),{intakeId:'intake'}),/restricted/);
    await assert.rejects(()=>supplierRuns.brief.handler(s.ctx(userId),{intakeId:'intake'}),/restricted/);
  }
  s.tables.quoteReviewerGrants[0].active=false;await assert.rejects(()=>supplierRuns.details.handler(ctx,{intakeId:'intake'}),/restricted/);
});
test('reviewer sees original and corrected facts, safe status-only steps and every fare/terms stage without supplier bodies',async()=>{
  const {s,ctx}=supplierSetup(),result=await supplierRuns.details.handler(ctx,{intakeId:'intake'});
  assert.ok(result.originalMessage.includes('originally three adults'));assert.equal(result.facts.adults,4);assert.equal(result.revisionNumber,2);
  assert.equal(result.hotels[0].recheck.state,'ready');assert.equal(result.flights[0].recheck.state,'failed');assert.equal(result.flights[0].parts.length,2);
  assert.equal(result.flights[0].recheck.reason,'This supplier check needs attention.');assert.equal(result.quoteReady,false);
  assert.equal(JSON.stringify({hotels:result.hotels,flights:result.flights}).includes('PRIVATE'),false);assert.equal(s.writes(),0);
});
test('changed intake, search attempt and selected source prevent saved results appearing current',async()=>{
  for(const change of [(s)=>s.tables.intakes[0].revisionNumber++,(s,ctx)=>ctx.hotelSelection.searchAttempt++,
    (s,ctx)=>ctx.flightSelection.selectedJson='changed']){
    const {s,ctx}=supplierSetup();change(s,ctx);const result=await supplierRuns.details.handler(ctx,{intakeId:'intake'});
    assert.ok(result.hotels[0].recheck.state==='stale' || result.flights[0].recheck.state==='stale');assert.equal(result.quoteReady,false);
  }
});
test('review queue is bounded to the latest 20 and an unprepared source does not invent checks',async()=>{
  const {s,ctx}=supplierSetup();for(let i=0;i<24;i++)s.tables.intakes.push({...s.tables.intakes[0],_id:'extra-'+i,createdAt:Date.now()+i+1});
  const queue=await supplierRuns.queue.handler(ctx,{});assert.equal(queue.length,20);assert.equal(queue[0].intakeId,'extra-23');assert.equal(JSON.stringify(queue).includes('originalMessage'),false);
  s.tables.hotelPreparations=[];s.tables.flightPreparations=[];const result=await supplierRuns.details.handler(ctx,{intakeId:'intake'});assert.equal(result.hotels.length,0);assert.equal(result.flights.length,0);
});
test('saved-check pages bound supplier reads and retain total counts without hiding alternatives',async()=>{
  const {s,ctx}=supplierSetup();
  s.tables.hotelPreparations[0].requests=Array.from({length:24},(_,i)=>({...s.tables.hotelPreparations[0].requests[0],requestId:'hotel-'+i,city:'Stop '+i}));
  s.tables.flightPreparations[0].requests=Array.from({length:4},(_,i)=>({...s.tables.flightPreparations[0].requests[0],requestId:'flight-'+i,startDate:'2099-12-'+(25+i)}));
  const first=await supplierRuns.details.handler(ctx,{intakeId:'intake'});assert.equal(first.hotelCount,24);assert.equal(first.hotels.length,6);assert.equal(first.flightCount,4);assert.equal(first.flights.length,1);
  const second=await supplierRuns.details.handler(ctx,{intakeId:'intake',hotelOffset:6,flightOffset:1});assert.ok(second.hotels[0].label.includes('Stop 6'));assert.equal(second.hotelCount,24);assert.ok(second.flights[0].label.includes('2099-12-26'));
  for(const hotelOffset of [-1,1,1.5,198])await assert.rejects(()=>supplierRuns.details.handler(ctx,{intakeId:'intake',hotelOffset}),/valid saved-check page/);
  const brief=await supplierRuns.brief.handler(ctx,{intakeId:'intake'});assert.equal(brief.originalMessage,s.tables.intakes[0].originalMessage);assert.equal(Object.hasOwn(brief,'hotels'),false);
});
