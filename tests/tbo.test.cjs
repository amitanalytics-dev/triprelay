const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const path = require('node:path');

// Exercise the actual action handlers without network access or credentials.
// Registration is replaced only to expose handlers; transport is the test seam.
function actions(response, ready = true, options = {}) {
  const calls = [];
  let authenticationCalls=0;
  const transport = {
    array: value => Array.isArray(value) ? value : [],
    object: value => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid object'); return value; },
    finite: value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null,
    string: value => typeof value === 'string' ? value : '',
    requireReady: () => { if (!ready) throw Error('Connection unavailable'); },
    readiness: () => ({ready,missing:ready?[]:['TBO_PROXY_URL'],transport:'existing_fixed_ip_proxy',liveVerified:false}),
    flightToken: async () => { authenticationCalls++;if (options.authenticationFailure)throw Error('PRIVATE token/password/network text');if (!ready) throw Error('Connection unavailable'); return options.emptyToken?'':'synthetic-token'; },
    post: async (method, payload) => { calls.push({ method, payload }); return response; },
  };
  const source = fs.readFileSync(path.join(__dirname, '../convex/tbo.ts'), 'utf8');
  const names = [...source.matchAll(/export const (\w+) = internalAction/g)].map(match => match[1]);
  const compiled = stripTypeScriptTypes(source)
    .replace(/import \{([^}]+)\} from "([^"]+)";/g, 'const {$1} = require("$2");')
    .replace(/export const /g, 'const ') + '\nObject.assign(exports, {' + names.join(',') + '});';
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (name === './tboTransport') return transport;
    if (name === './_generated/server') return { internalAction: definition => definition };
    if (name === 'convex/values') return require('convex/values');
    throw Error('Unexpected import');
  }, Date, process: { env: { TBO_END_USER_IP: '192.0.2.1' } } });
  return { api: exports, calls, get authenticationCalls(){return authenticationCalls;} };
}
function flightArgs() {
  return { adults: 2, children: 0, infants: 0, directOnly: false, journeyType: 1,
    segments: [{ origin: 'BOM', destination: 'HAN', departureDate: '2099-12-25', cabinClass: 2 }] };
}
const fare = () => ({ ResultIndex: 'synthetic-index', IsLCC: false,
  Fare: { OfferedFare: 10000, Currency: 'INR' }, Segments: [] });

test('flight search sends correct passenger and route fields and retains private recheck references', async () => {
  const { api, calls } = actions({ Response: { ResponseStatus: 1, TraceId: 'synthetic-trace', Results: [[fare()]] } });
  const result = await api.searchFlights.handler({}, flightArgs());
  assert.equal(calls[0].method, 'flightSearch');
  assert.equal(calls[0].payload.AdultCount, 2);
  assert.equal(calls[0].payload.Segments[0].Destination, 'HAN');
  assert.equal(result.traceId, 'synthetic-trace');
  assert.equal(result.rates[0].compulsoryFeesConfirmed, false);
});
test('missing connection and invalid trip inputs prevent supplier requests', async () => {
  const blocked = actions({}, false);
  await assert.rejects(() => blocked.api.searchFlights.handler({}, flightArgs()), /unavailable/);
  assert.equal(blocked.calls.length, 0);
  const invalid = actions({});
  await assert.rejects(() => invalid.api.searchFlights.handler({}, { ...flightArgs(), adults: 0 }), /traveller/);
  const wrongDate = flightArgs(); wrongDate.segments[0].departureDate = '2099-02-30';
  await assert.rejects(() => invalid.api.searchFlights.handler({}, wrongDate), /date/);
  assert.equal(invalid.calls.length, 0);
});
test('flight group limit includes infants before any supplier request',async()=>{
  const {api,calls}=actions({});
  await assert.rejects(()=>api.searchFlights.handler({}, {...flightArgs(),adults:8,children:0,infants:2}),/nine travellers including infants/);
  assert.equal(calls.length,0);
});
test('failed supplier response or missing flight search reference cannot become a rate', async () => {
  for (const response of [{ Response: { ResponseStatus: 5 } },
    { Response: { ResponseStatus: 1, Results: [[fare()]] } }]) {
    const { api } = actions(response);
    await assert.rejects(() => api.searchFlights.handler({}, flightArgs()));
  }
});
test('flight recheck rejects mismatched references and preserves price-change uncertainty', async () => {
  const response = { Response: { ResponseStatus: 1, TraceId: 'synthetic-trace', Results: fare() } };
  const { api } = actions(response);
  const result = await api.recheckFlight.handler({}, { traceId: 'synthetic-trace', resultIndex: 'synthetic-index', resultGroup: 0 });
  assert.equal(result.priceChanged, null);
  assert.equal(result.fare.compulsoryFeesConfirmed, false);
  await assert.rejects(() => api.recheckFlight.handler({}, { traceId: 'wrong', resultIndex: 'synthetic-index', resultGroup: 0 }), /different/);
});
test('empty flight terms remain unavailable and wrong-search terms are rejected', async () => {
  const { api } = actions({ Response: { ResponseStatus: 1, TraceId: 'synthetic-trace', FareRules: [] } });
  const result = await api.flightTerms.handler({}, { traceId: 'synthetic-trace', resultIndex: 'synthetic-index' });
  assert.equal(result.termsAvailable, false);
  await assert.rejects(() => api.flightTerms.handler({}, { traceId: 'wrong', resultIndex: 'synthetic-index' }), /different/);
});
test('hotel search maps occupancy and never assumes compulsory fees are complete', async () => {
  const { api, calls } = actions({ Status: { Code: 200 }, HotelResult: [{ HotelCode: '123', Currency: 'INR',
    Rooms: [{ BookingCode: 'synthetic-booking-code', Name: ['Room'], TotalFare: 10000 }] }] });
  const result = await api.searchHotels.handler({}, { hotelCodes: ['123'], checkIn: '2099-12-25', checkOut: '2099-12-28',
    nationality: 'IN', rooms: [{ adults: 2, childAges: [7] }], refundableOnly: false });
  assert.equal(calls[0].payload.PaxRooms[0].Children, 1);
  assert.equal(calls[0].payload.NoOfRooms, 1);
  assert.equal(result.rates[0].refundable, null);
  assert.equal(result.rates[0].compulsoryFeesConfirmed, false);
});
test('hotel rates without currency or bookable price are rejected', async () => {
  for (const hotel of [{ HotelCode: '123', Rooms: [{ TotalFare: 100, BookingCode: 'code' }] },
    { HotelCode: '123', Currency: 'INR', Rooms: [{ BookingCode: 'code' }] }]) {
    const { api } = actions({ Status: { Code: 200 }, HotelResult: [hotel] });
    await assert.rejects(() => api.recheckHotel.handler({}, { bookingCode: 'synthetic' }));
  }
});
test('hotel evidence preserves taxes, source amounts, meal scope and flat/nested supplements without claiming NET or GST',async()=>{
  for(const nested of [false,true]){
    const supplement={Description:'SAMPLE local charge',Price:25,Currency:'INR',Type:'AtProperty'};
    const {api}=actions({Status:{Code:200},HotelResult:[{HotelCode:'123',Currency:'INR',Rooms:[{
      BookingCode:'synthetic',Name:['Sample'],TotalFare:1000,TotalTax:100,NetCost:900,ExtraGuestCharges:50,
      RecommendedSellingRate:'1,210.00',MealType:'Breakfast_For_2',WithTransfers:false,
      Supplements:nested?[[supplement]]:[supplement]}]}]});
    const result=await api.recheckHotel.handler({}, {bookingCode:'synthetic'}),rate=result.rates[0];
    assert.equal(rate.supplierTotal,1000);assert.equal(rate.fareEvidence.reportedNetCost,900);
    assert.equal(rate.fareEvidence.totalTax,100);assert.equal(rate.fareEvidence.extraGuestCharges,50);
    assert.equal(rate.fareEvidence.netCostBasisVerified,false);assert.equal(rate.fareEvidence.gstTreatmentVerified,false);
    assert.equal(rate.fareEvidence.totalFareExcludesTdsTcs,true);assert.equal(rate.recommendedSellingRate,1210);
    assert.equal(rate.supplements.length,1);assert.equal(rate.supplements[0].amount,25);
    assert.equal(rate.mealType,'Breakfast_For_2');assert.equal(rate.withTransfers,false);
    assert.equal(rate.compulsoryFeesConfirmed,false);
  }
});
test('invalid reported minimum selling rate never disappears as an absent floor',async()=>{
  for(const floor of [NaN,-1,'not a price']){
    const {api}=actions({Status:{Code:200},HotelResult:[{HotelCode:'123',Currency:'INR',Rooms:[{BookingCode:'synthetic',TotalFare:1000,RecommendedSellingRate:floor}]}]});
    await assert.rejects(()=>api.recheckHotel.handler({}, {bookingCode:'synthetic'}),/selling-price floor/);
  }
});
test('hotel recheck preserves reported NET/tax evidence and never interprets a missing change flag as unchanged',async()=>{
  const response={Status:{Code:200},HotelResult:[{HotelCode:'123',Currency:'INR',Rooms:[{BookingCode:'synthetic',TotalFare:1000,TotalTax:200,
    NetAmount:975.55,NetTax:175.55,ServiceFee:12.34,AgentCommission:40,LastCancellationDeadline:'14-11-2099 23:59:59',
    TaxBreakup:[{TaxType:4,TaxableAmount:1000,TaxPercentage:5,TaxAmount:50}]}]}]};
  const {api}=actions(response),result=await api.recheckHotel.handler({}, {bookingCode:'synthetic'}),rate=result.rates[0];
  assert.equal(result.rateChanged,null);assert.equal(rate.supplierTotal,1000);assert.equal(rate.fareEvidence.reportedNetAmount,975.55);
  assert.equal(rate.fareEvidence.reportedNetTax,175.55);assert.equal(rate.fareEvidence.taxBreakup[0].taxAmount,50);
  assert.equal(rate.fareEvidence.serviceFee,12.34);assert.equal(rate.fareEvidence.agentCommission,40);
  assert.equal(rate.fareEvidence.netCostBasisVerified,false);assert.equal(rate.fareEvidence.gstTreatmentVerified,false);
  assert.equal(rate.lastCancellationDeadline,'14-11-2099 23:59:59');
  for(const flag of [true,false]){response.RateChanged=flag;assert.equal((await api.recheckHotel.handler({}, {bookingCode:'synthetic'})).rateChanged,flag);}
});
test('flight access probe blocks missing settings before authentication and never returns a token or price claim',async()=>{
  const missing=actions({},false),blocked=await missing.api.verifyFlightAccess.handler({});
  assert.equal(blocked.state,'blocked');assert.equal(missing.authenticationCalls,0);assert.equal(missing.calls.length,0);
  const connected=actions({}),result=await connected.api.verifyFlightAccess.handler({});
  assert.equal(result.state,'authenticated');assert.equal(connected.authenticationCalls,1);assert.equal(connected.calls.length,0);assert.equal(result.pricingVerified,false);
  assert.equal(JSON.stringify(result).includes('synthetic-token'),false);
});
test('failed or empty supplier authentication is a safe failure without retry or credential output',async()=>{
  for(const options of [{authenticationFailure:true},{emptyToken:true}]){
    const s=actions({},true,options),result=await s.api.verifyFlightAccess.handler({});assert.equal(result.state,'failed');assert.equal(result.pricingVerified,false);
    assert.equal(s.authenticationCalls,1);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(s.calls.length,0);
  }
});
