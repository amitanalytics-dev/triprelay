const test=require('node:test');const assert=require('node:assert/strict');
const {buildComparisonPlan}=require('../lib/comparisonPlan.cjs');
const facts=()=>({destination:'Vietnam',adults:4,nights:6,departureCity:'Ahmedabad',
  startDates:['2026-11-09','2026-11-10','2026-11-11','2026-11-12'],hotelTiers:['4-star','5-star'],
  transportOptions:['private','shared'],meals:['breakfast','lunch','dinner'],
  routeStops:[{city:'Hanoi',nights:2},{city:'Ha Long',nights:1},{city:'Da Nang',nights:3}],
  rooms:[{adults:2,childAges:[]},{adults:2,childAges:[]}]});
test('all 16 Vietnam combinations retain confirmed dates, stays, occupancy and meals',()=>{
  const input=facts(),before=JSON.stringify(input),plan=buildComparisonPlan(input);
  assert.equal(plan.options.length,16);assert.equal(new Set(plan.options.map(option=>option.optionId)).size,16);
  assert.deepEqual([...new Set(plan.options.map(option=>option.endDate))],['2026-11-15','2026-11-16','2026-11-17','2026-11-18']);
  assert.deepEqual(plan.options[0].stops,[{city:'Hanoi',nights:2,arrivalDate:'2026-11-09',departureDate:'2026-11-11'},
    {city:'Ha Long',nights:1,arrivalDate:'2026-11-11',departureDate:'2026-11-12'},
    {city:'Da Nang',nights:3,arrivalDate:'2026-11-12',departureDate:'2026-11-15'}]);
  for(const option of plan.options){assert.deepEqual(option.rooms,input.rooms);assert.deepEqual(option.meals,input.meals);}
  assert.equal(JSON.stringify(input),before);
  for(const field of ['airportCode','nationality','supplierCostMinor','available','lowestPrice'])assert.equal(JSON.stringify(plan.options).includes(field),false);
});
test('missing facts, duplicate choices, impossible dates and inconsistent stays cannot prepare requests',()=>{
  for(const change of [{adults:undefined},{departureCity:''},{hotelTiers:[]},{startDates:['2026-02-30']},
    {startDates:['2026-11-09','2026-11-09']},{routeStops:[{city:'Hanoi',nights:5}]},
    {rooms:[{adults:3,childAges:[]}]}])assert.throws(()=>buildComparisonPlan({...facts(),...change}),/Confirm/);
});
test('month/year boundaries and zero-night stops are preserved without inventing a stay',()=>{
  const plan=buildComparisonPlan({...facts(),startDates:['2026-12-29'],routeStops:[{city:'Hanoi',nights:2},{city:'Ha Long',nights:0},{city:'Da Nang',nights:4}]});
  assert.equal(plan.options[0].endDate,'2027-01-04');
  assert.equal(plan.options[0].stops[1].arrivalDate,plan.options[0].stops[1].departureDate);
});
