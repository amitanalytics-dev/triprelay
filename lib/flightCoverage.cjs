'use strict';
function validateFlightCoverage(request,fares){
  const validReference=value=>typeof value==='string' && value.length>0 && value.length<=2000 && value===value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
  if(!request || !Array.isArray(request.segments) || !request.segments.length || !Array.isArray(fares) || !fares.length || fares.length>6 ||
    new Set(fares.map(fare=>fare.resultGroup)).size!==fares.length || fares.some(fare=>!validReference(fare.resultIndex) ||
      !Number.isInteger(fare.resultGroup) || fare.resultGroup<0 || fare.resultGroup>100 || !Array.isArray(fare.segments) || !fare.segments.length ||
      fare.segments.some(segment=>!segment || typeof segment.departure!=='string' || typeof segment.arrival!=='string')))throw Error('Select one saved fare per required result group with complete flight segments.');
  const segments=[...fares].sort((a,b)=>a.segments[0].departure.localeCompare(b.segments[0].departure)).flatMap(fare=>fare.segments);
  let cursor=0;
  for(const leg of request.segments){
    const first=segments[cursor];
    if(!first || first.origin!==leg.origin || first.departure.slice(0,10)!==leg.departureDate)throw Error('Selected fares must cover each confirmed flight leg and departure date.');
    let airport=leg.origin,arrived=false;
    while(cursor<segments.length){
      const segment=segments[cursor++];
      if(segment.origin!==airport || !/^[A-Z]{3}$/.test(segment.destination) || !segment.departure || !segment.arrival ||
        !Number.isFinite(Date.parse(segment.departure)) || !Number.isFinite(Date.parse(segment.arrival)))throw Error('Flight connections and actual schedule evidence must be complete.');
      airport=segment.destination;
      if(airport===leg.destination){arrived=true;break;}
    }
    if(!arrived)throw Error('A required flight destination is missing.');
  }
  if(cursor!==segments.length)throw Error('The selection includes flight legs outside the confirmed request.');
  return true;
}
function matchFlightFare(selected,result,request){
  if(!result || result.source!=='TBO' || result.traceId!==selected.traceId || result.fare?.resultIndex!==selected.fare.resultIndex ||
    result.fare.resultGroup!==selected.fare.resultGroup)throw Error('Fare recheck references must match the exact saved selection.');
  if(!Number.isFinite(result.fare.supplierTotal) || result.fare.supplierTotal<=0 || !/^[A-Z]{3}$/.test(result.fare.currency) || !Array.isArray(result.fare.segments))throw Error('Fresh fare amount, currency and schedule are required.');
  const pax=result.fareEvidence?.passengerBreakdown;
  if(!Array.isArray(pax) || !pax.length || pax.some(row=>![1,2,3].includes(row.passengerType) || !Number.isSafeInteger(row.passengerCount) || row.passengerCount<0))throw Error('Verify the whole passenger group in the rechecked fare.');
  for(const [type,count] of [[1,request.adults],[2,request.children],[3,request.infants]])if(pax.filter(row=>row.passengerType===type).reduce((sum,row)=>sum+row.passengerCount,0)!==count)throw Error('The rechecked fare must price the whole confirmed passenger group.');
  const key=segments=>JSON.stringify(segments.map(s=>[s.origin,s.destination,s.departure,s.arrival,s.airline,s.flightNumber]));
  if(key(result.fare.segments)!==key(selected.fare.segments))throw Error('Rechecked flights changed: select and confirm a fresh complete route.');
  return {priceChanged:result.fare.supplierTotal!==selected.fare.supplierTotal || result.fare.currency!==selected.fare.currency,
    supplierReportedPriceChanged:result.priceChanged??null,quoteReady:false};
}
function matchFlightTerms(selected,result){
  if(!result || result.source!=='TBO' || result.traceId!==selected.traceId || result.resultIndex!==selected.fare.resultIndex ||
    result.termsAvailable!==true || !Array.isArray(result.rules) || !result.rules.some(rule=>rule.detail?.trim() || rule.restriction?.trim()))throw Error('Fresh matching flight cancellation/terms evidence is required.');
  return true;
}
module.exports={validateFlightCoverage,matchFlightFare,matchFlightTerms};
