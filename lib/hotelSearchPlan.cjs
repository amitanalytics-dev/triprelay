'use strict';
const { buildComparisonPlan }=require('./comparisonPlan.cjs');
function buildHotelSearchPlan(facts,customer,settings){
  const choices=buildComparisonPlan(facts).options;
  if(!customer?.leadNationality?.trim() || !['include','exclude'].includes(customer.flights) ||
    (customer.flights==='include' && !customer.flightRequest?.trim()) ||
    (facts.rooms.some(room=>room.childAges.length) && customer.childAgesAtTravelConfirmed!==true))throw Error('Confirm customer supplier-search answers first.');
  if(!settings || settings.confirmedNationalityLabel?.trim().toLowerCase()!==customer.leadNationality.trim().toLowerCase() ||
    !/^[A-Z]{2}$/.test(settings.nationalityCode) || !settings.confirmationNote?.trim() || settings.confirmationNote.length>2000 ||
    typeof settings.refundableOnly!=='boolean' || !Array.isArray(settings.mappings))throw Error('Record explicit confirmed supplier nationality and search mappings.');
  const expected=[];
  facts.routeStops.forEach((stop,stopIndex)=>{if(stop.nights>0)for(const hotelTier of facts.hotelTiers)expected.push({stopIndex,city:stop.city.trim(),hotelTier});});
  if(settings.mappings.length!==expected.length)throw Error('Map every overnight stop and requested hotel tier.');
  const used=new Set();
  for(const row of settings.mappings){
    const key=`${row.stopIndex}/${row.hotelTier}`;
    const requirement=expected.find(item=>item.stopIndex===row.stopIndex && item.hotelTier===row.hotelTier);
    if(!requirement || row.city!==requirement.city || used.has(key) || !Array.isArray(row.hotelCodes) || !row.hotelCodes.length || row.hotelCodes.length>100 ||
      new Set(row.hotelCodes).size!==row.hotelCodes.length || row.hotelCodes.some(code=>typeof code!=='string' || !/^\d{1,16}$/.test(code)) ||
      !row.confirmationNote?.trim() || row.confirmationNote.length>2000)throw Error('Use unique explicitly confirmed supplier hotel codes for each exact stop and tier.');
    used.add(key);
  }
  const requests=[];
  for(const choice of choices)for(let stopIndex=0;stopIndex<choice.stops.length;stopIndex++){
    const stop=choice.stops[stopIndex];if(!stop.nights)continue;
    const id=`${choice.startDate}/${choice.hotelTier}/${stopIndex}`;
    const existing=requests.find(request=>request.requestId===id);
    if(existing){existing.optionIds.push(choice.optionId);continue;}
    const mapping=settings.mappings.find(row=>row.stopIndex===stopIndex && row.hotelTier===choice.hotelTier);
    requests.push({requestId:id,optionIds:[choice.optionId],stopIndex,city:stop.city,hotelTier:choice.hotelTier,
      hotelCodes:[...mapping.hotelCodes],checkIn:stop.arrivalDate,checkOut:stop.departureDate,nationality:settings.nationalityCode,
      rooms:choice.rooms.map(room=>({adults:room.adults,childAges:[...room.childAges]})),refundableOnly:settings.refundableOnly});
  }
  if(!requests.length || requests.length>240 || new TextEncoder().encode(JSON.stringify({settings,requests})).byteLength>200000)throw Error('Supplier preparation exceeds the bounded plan size.');
  return {requests,optionCount:choices.length,requiredChecks:[
    'Hotel search responses are private source evidence, not verified NET/GST quote components.',
    'Select and recheck exact bookable hotel units, all fees, meal coverage, cancellation terms and supplier freshness.',
    'Obtain complete priced transport, required flights and every requested meal.',
    'Compare all alternatives and obtain authorized human review before quote delivery.',
  ]};
}
module.exports={buildHotelSearchPlan};
