const DAY = 86400000;
function dateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Confirm valid travel dates.');
  const time = Date.parse(value+'T00:00:00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0,10)!==value) throw Error('Confirm valid travel dates.');
  return time;
}
function distinct(values, allowed, maximum) {
  return Array.isArray(values) && values.length>0 && values.length<=maximum && new Set(values).size===values.length &&
    (!allowed || values.every(value=>allowed.includes(value)));
}
function buildComparisonPlan(facts) {
  if (!facts || facts.destination!=='Vietnam' || !Number.isInteger(facts.adults) || facts.adults<1 || facts.adults>30 ||
    !Number.isInteger(facts.nights) || facts.nights<1 || facts.nights>90 || !facts.departureCity?.trim() ||
    !distinct(facts.startDates,null,8) || !distinct(facts.hotelTiers,['3-star','4-star','5-star'],3) ||
    !distinct(facts.transportOptions,['private','shared'],2) || !distinct(facts.meals,['breakfast','lunch','dinner'],3)) {
    throw Error('Confirm the complete comparison brief before preparing supplier requests.');
  }
  if (!Array.isArray(facts.routeStops) || !facts.routeStops.length || facts.routeStops.length>10 ||
    facts.routeStops.some(stop=>!stop.city?.trim() || !Number.isInteger(stop.nights) || stop.nights<0 || stop.nights>90) ||
    new Set(facts.routeStops.map(stop=>stop.city.trim().toLowerCase())).size!==facts.routeStops.length ||
    facts.routeStops.reduce((sum,stop)=>sum+stop.nights,0)!==facts.nights) throw Error('Confirm the route and nights at every stop.');
  if (!Array.isArray(facts.rooms) || !facts.rooms.length || facts.rooms.length>10 ||
    facts.rooms.some(room=>!Number.isInteger(room.adults) || room.adults<1 || room.adults>6 || !Array.isArray(room.childAges) ||
      room.childAges.length>4 || room.childAges.some(age=>!Number.isInteger(age) || age<0 || age>17)) ||
    facts.rooms.reduce((sum,room)=>sum+room.adults,0)!==facts.adults ||
    facts.rooms.reduce((sum,room)=>sum+room.adults+room.childAges.length,0)>30) throw Error('Confirm the traveller count and room allocation.');
  const options=[];
  for (const startDate of facts.startDates) {
    const start=dateTime(startDate);
    const stops=[];let elapsed=0;
    for (const stop of facts.routeStops) {
      const arrivalDate=new Date(start+elapsed*DAY).toISOString().slice(0,10);
      elapsed+=stop.nights;
      stops.push({city:stop.city.trim(),nights:stop.nights,arrivalDate,
        departureDate:new Date(start+elapsed*DAY).toISOString().slice(0,10)});
    }
    for (const hotelTier of facts.hotelTiers) for (const transport of facts.transportOptions) options.push({
      optionId:startDate+'/'+hotelTier+'/'+transport,startDate,endDate:new Date(start+facts.nights*DAY).toISOString().slice(0,10),
      hotelTier,transport,adults:facts.adults,departureCity:facts.departureCity.trim(),
      rooms:facts.rooms.map(room=>({adults:room.adults,childAges:[...room.childAges]})),
      meals:[...facts.meals],stops:stops.map(stop=>({...stop})),
    });
  }
  // Requirements for actual supplier calls; city names never become inferred
  // airport/hotel codes, nationality, cruise choices, tax facts or live prices.
  return {options,requiredChecks:[
    'Confirm traveller nationality for supplier searches.',
    'Confirm required flights and exact airport routing.',
    'Identify permitted stays and supplier codes for every overnight stop and hotel tier.',
    'Obtain verified private/shared transfer and requested meal costs.',
    'Verify NET cost, GST treatment, compulsory fees, cancellation terms and freshness for every component.',
    'Compare complete fresh options before labelling any option lowest-priced.',
    'Obtain designated human review before releasing a quote.',
  ]};
}
module.exports={buildComparisonPlan};
