const test=require('node:test'),assert=require('node:assert/strict');
const {validateFlightCoverage,matchFlightFare,matchFlightTerms}=require('../lib/flightCoverage.cjs');
const request={adults:4,children:0,infants:0,segments:[{origin:'AMD',destination:'HAN',departureDate:'2026-11-09'},{origin:'DAD',destination:'AMD',departureDate:'2026-11-15'}]};
const segment=(origin,destination,date)=>({origin,destination,departure:date+'T10:00:00',arrival:date+'T14:00:00',airline:'XY',flightNumber:'1'});
const out={resultIndex:'out',resultGroup:0,supplierTotal:100,currency:'INR',segments:[segment('AMD','HAN','2026-11-09')]};
const back={...out,resultIndex:'back',resultGroup:1,segments:[segment('DAD','AMD','2026-11-15')]};
const selected={traceId:'trace',fare:out};
const result=()=>({source:'TBO',traceId:'trace',fare:structuredClone(out),fareEvidence:{passengerBreakdown:[{passengerType:1,passengerCount:4}]}});
test('separate fare groups cover the full outward and return journey',()=>assert.equal(validateFlightCoverage(request,[back,out]),true));
test('a combined fare can include a connecting flight and return',()=>assert.equal(validateFlightCoverage(request,[{...out,segments:[segment('AMD','DEL','2026-11-09'),segment('DEL','HAN','2026-11-09'),...back.segments]}]),true));
test('missing return, duplicate groups, wrong dates and extra legs fail',()=>{
 for(const fares of [[out],[out,{...back,resultGroup:0}],[{...out,segments:[segment('AMD','HAN','2026-11-10')]},back],[out,{...back,segments:[...back.segments,segment('AMD','BOM','2026-11-16')]}]])assert.throws(()=>validateFlightCoverage(request,fares));
});
test('recheck requires exact references, passenger counts and schedule',()=>{
 assert.equal(matchFlightFare(selected,result(),request).quoteReady,false);
 for(const change of [r=>r.traceId='other',r=>r.fare.resultGroup=1,r=>r.fareEvidence.passengerBreakdown[0].passengerCount=1,r=>r.fare.segments[0].flightNumber='2',r=>r.fare.supplierTotal=0]){const r=result();change(r);assert.throws(()=>matchFlightFare(selected,r,request));}
});
test('changed total is separate from absent supplier change flag',()=>{const r=result();r.fare.supplierTotal=120;assert.deepEqual(matchFlightFare(selected,r,request),{priceChanged:true,supplierReportedPriceChanged:null,quoteReady:false});});
test('terms must be nonempty and match the selected supplier reference',()=>{
 const r={source:'TBO',traceId:'trace',resultIndex:'out',termsAvailable:true,rules:[{detail:'Cancellation terms require review'}]};
 assert.equal(matchFlightTerms(selected,r),true);assert.throws(()=>matchFlightTerms(selected,{...r,rules:[]}));assert.throws(()=>matchFlightTerms(selected,{...r,resultIndex:'other'}));
});
