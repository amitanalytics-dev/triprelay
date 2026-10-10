'use strict';
const {buildComparisonPlan}=require('./comparisonPlan.cjs');
function buildFlightSearchPlan(facts,customer,settings){
  const choices=buildComparisonPlan(facts).options;
  if(!customer?.leadNationality?.trim() || customer.flights!=='include' || !customer.flightRequest?.trim() ||
    (facts.rooms.some(room=>room.childAges.length) && customer.childAgesAtTravelConfirmed!==true))throw Error('Confirm included flights, the complete customer flight request and travel ages first.');
  if(!settings || settings.confirmedFlightRequest!==customer.flightRequest || !settings.confirmationNote?.trim() ||
    settings.confirmationNote.length>2000 || !Array.isArray(settings.routes) || settings.routes.length!==facts.startDates.length)throw Error('Record explicitly confirmed routing for every requested start date.');
  const people=facts.adults+facts.rooms.reduce((sum,room)=>sum+room.childAges.length,0);
  const cities=[facts.departureCity.trim(),...facts.routeStops.map(stop=>stop.city.trim())],used=new Set(),requests=[];
  for(const route of settings.routes){
    const options=choices.filter(choice=>choice.startDate===route.startDate),choice=options[0];
    if(!choice || used.has(route.startDate) || !route.confirmationNote?.trim() || route.confirmationNote.length>2000 ||
      ![route.adults,route.children,route.infants].every(value=>Number.isInteger(value) && value>=0) || route.adults<facts.adults ||
      route.adults+route.children+route.infants!==people || people>9 || route.infants>route.adults || typeof route.directOnly!=='boolean' ||
      ![1,2,3].includes(route.journeyType) || !Array.isArray(route.segments) || !route.segments.length || route.segments.length>6 ||
      (route.journeyType===1 && route.segments.length!==1) || (route.journeyType===2 && route.segments.length!==2))throw Error('Confirm complete route and supplier passenger categories for the same traveller group (at most nine people including infants).');
    let previous=choice.startDate;
    for(const segment of route.segments){
      if(!cities.includes(segment.originCity) || !cities.includes(segment.destinationCity) ||
        !/^[A-Z]{3}$/.test(segment.origin) || !/^[A-Z]{3}$/.test(segment.destination) || segment.origin===segment.destination ||
        !Number.isInteger(segment.cabinClass) || segment.cabinClass<1 || segment.cabinClass>6 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(segment.departureDate) || segment.departureDate<previous || segment.departureDate>choice.endDate ||
        !Number.isFinite(Date.parse(segment.departureDate+'T00:00:00Z')) || new Date(segment.departureDate+'T00:00:00Z').toISOString().slice(0,10)!==segment.departureDate)throw Error('Use explicitly mapped airports and valid flight dates within the confirmed trip in travel order.');
      previous=segment.departureDate;
    }
    if(route.journeyType===2 && (route.segments[0].origin!==route.segments[1].destination || route.segments[0].destination!==route.segments[1].origin))throw Error('An open-jaw route needs the supplier multi-stop search, not a reversed-airport return search.');
    used.add(route.startDate);
    requests.push({requestId:route.startDate,optionIds:options.map(option=>option.optionId),startDate:choice.startDate,endDate:choice.endDate,
      adults:route.adults,children:route.children,infants:route.infants,directOnly:route.directOnly,journeyType:route.journeyType,
      segments:route.segments.map(segment=>({...segment}))});
  }
  if(new TextEncoder().encode(JSON.stringify({settings,requests})).byteLength>100000)throw Error('Flight preparation exceeds the bounded plan size.');
  return {requests,optionCount:choices.length,requiredChecks:[
    'Passenger categories and airport mappings are explicit operator confirmations, not inferred from room ages or city names.',
    'Raw search fares are private evidence: select complete required result groups, then recheck exact trace/result references and terms.',
    'Verify actual flight times against the client routing and hotel dates, complete NET/GST/fee/freshness facts and baggage/cancellation terms.',
    'Retain every hotel/transport alternative and obtain authorized human review before delivering a quote.',
  ]};
}
module.exports={buildFlightSearchPlan};
