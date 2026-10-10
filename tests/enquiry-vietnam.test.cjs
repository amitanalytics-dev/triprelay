const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../convex/enquiries.ts'),'utf8')).replace(/^import .*;\r?$/gm,'').replace(/\bexport /g,'');
const v=new Proxy({}, {get:()=>()=>({})});
const define=def=>({_handler:def.handler});
const api=new Function('getAuthUserId','ConvexError','v','mutation','query','enquiryFields','enquiryInputFields','enquiryRevisionFields','outcome','recordMetric',source+'\nreturn {create,updateBrief};')(
 async ctx=>ctx.userId,class extends Error{},v,define,define,{},{},{},{},async ctx=>{ctx.metrics++;});
function input(destination){const start=new Date(Date.now()+10*86400000).toISOString().slice(0,10),end=new Date(Date.now()+13*86400000).toISOString().slice(0,10);return {destination,clientName:'Synthetic test',clientContact:'synthetic@example.invalid',departureCity:'Ahmedabad',startDate:start,endDate:end,adults:2,children:0,childAges:[],budgetInr:100000,hotelStandard:'4-star',flightPreference:'flexible',travelPace:'balanced',interests:'nature',foodPreferences:'vegetarian',specialRequirements:''};}
function context(destination='Thailand'){
 const record={...input(destination),_id:'e1',_creationTime:1,agentId:'a1',status:'awaiting_supplier',outcome:'pending',createdAt:1,updatedAt:2,revisionNumber:1};
 const ctx={userId:'u1',metrics:0,inserts:[],patches:[],db:{query(){return {withIndex(){return this;},async unique(){return {_id:'a1',userId:'u1'};}};},async get(){return record;},async insert(table,value){ctx.inserts.push({table,value});return 'new-id';},async patch(id,value){ctx.patches.push({id,value});Object.assign(record,value);}}};
 return {ctx,record};
}
test('new enquiries accept Vietnam and reject Thailand/Bali before writes or metrics',async()=>{
 for(const country of ['Thailand','Bali']){const {ctx}=context();await assert.rejects(api.create._handler(ctx,input(country)),/Vietnam enquiries only/);assert.equal(ctx.inserts.length,0);assert.equal(ctx.metrics,0);}
 const {ctx}=context();assert.equal((await api.create._handler(ctx,input('Vietnam'))).status,'awaiting_supplier');assert.equal(ctx.inserts[0].value.destination,'Vietnam');assert.equal(ctx.metrics,1);
});
test('historical enquiries remain editable in the original country and preserve revisions',async()=>{
 for(const country of ['Thailand','Bali','Vietnam']){const {ctx,record}=context(country);const result=await api.updateBrief._handler(ctx,{...input(country),interests:'culture',enquiryId:'e1',expectedUpdatedAt:2});assert.equal(result.revisionNumber,2);assert.equal(record.destination,country);assert.equal(record.interests,'culture');assert.equal(ctx.inserts[0].table,'enquiryRevisions');assert.equal(ctx.inserts[0].value.snapshot.destination,country);}
});
test('editing cannot change a saved country or bypass release scope',async()=>{
 for(const [original,next] of [['Thailand','Vietnam'],['Bali','Thailand'],['Vietnam','Bali']]){const {ctx,record}=context(original);await assert.rejects(api.updateBrief._handler(ctx,{...input(next),enquiryId:'e1',expectedUpdatedAt:2}),/original country/);assert.equal(record.destination,original);assert.equal(ctx.inserts.length,0);assert.equal(ctx.patches.length,0);assert.equal(ctx.metrics,0);}
});
