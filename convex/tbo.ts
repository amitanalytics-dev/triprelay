"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { array, finite, flightToken, object, post, readiness, requireReady, string } from "./tboTransport";

const hotelRate = v.object({ hotelCode: v.string(), bookingCode: v.string(), roomNames: v.array(v.string()),
  supplierTotal: v.number(), currency: v.string(), inclusion: v.string(), refundable: v.union(v.boolean(), v.null()),
  conditions: v.array(v.string()), recommendedSellingRate: v.union(v.number(), v.null()),
  fareEvidence: v.object({ totalFare:v.number(),totalTax:v.union(v.number(),v.null()),
    extraGuestCharges:v.union(v.number(),v.null()),reportedNetCost:v.union(v.number(),v.null()),
    reportedNetAmount:v.union(v.number(),v.null()),reportedNetTax:v.union(v.number(),v.null()),
    serviceFee:v.union(v.number(),v.null()),agentCommission:v.union(v.number(),v.null()),
    taxBreakup:v.array(v.object({taxType:v.union(v.number(),v.string(),v.null()),taxableAmount:v.union(v.number(),v.null()),
      taxPercentage:v.union(v.number(),v.null()),taxAmount:v.union(v.number(),v.null())})),
    totalFareExcludesTdsTcs:v.literal(true),netCostBasisVerified:v.literal(false),gstTreatmentVerified:v.literal(false),
    calculation:v.literal("supplier_fields_preserved_not_added_together") }),
  mealType:v.string(),withTransfers:v.union(v.boolean(),v.null()),lastCancellationDeadline:v.string(),
  supplements: v.array(v.object({ description: v.string(), amount: v.union(v.number(), v.null()), currency: v.string(), type: v.string() })),
  cancellationPolicies: v.array(v.object({ fromDate: v.string(), chargeType: v.string(), amount: v.union(v.number(), v.null()) })),
  compulsoryFeesConfirmed: v.literal(false) });
const flightRate = v.object({ resultIndex: v.string(), resultGroup: v.number(), supplierTotal: v.number(),
  currency: v.string(), isLcc: v.union(v.boolean(), v.null()), segments: v.array(v.object({
    origin: v.string(), destination: v.string(), airline: v.string(), flightNumber: v.string(),
    departure: v.string(), arrival: v.string(), baggage: v.string(), cabinBaggage: v.string(),
  })), compulsoryFeesConfirmed: v.literal(false) });
const nullableAmount = v.union(v.number(), v.null());
const nullableFlag = v.union(v.boolean(), v.null());
const moneyBreakdown=v.union(v.array(v.object({label:v.string(),amount:nullableAmount})),v.null());
const fareEvidence = v.object({
  baseFare: nullableAmount, tax: nullableAmount, yqTax: nullableAmount,
  otherCharges: nullableAmount, serviceFee: nullableAmount,
  additionalTransactionFeeOffered: nullableAmount,
  additionalTransactionFeePublished: nullableAmount,
  publishedFare: nullableAmount, offeredFare: nullableAmount,
  discount:nullableAmount,commissionEarned:nullableAmount,plbEarned:nullableAmount,incentiveEarned:nullableAmount,
  tdsOnCommission:nullableAmount,tdsOnPlb:nullableAmount,tdsOnIncentive:nullableAmount,paymentGatewayCharge:nullableAmount,
  totalBaggageCharges:nullableAmount,totalMealCharges:nullableAmount,totalSeatCharges:nullableAmount,totalSpecialServiceCharges:nullableAmount,
  taxBreakup:moneyBreakdown,chargeBreakup:moneyBreakdown,
  passengerBreakdown: v.array(v.object({ currency: v.union(v.string(), v.null()),
    passengerType: nullableAmount, passengerCount: nullableAmount,
    baseFare: nullableAmount, tax: nullableAmount, yqTax: nullableAmount,
    additionalTransactionFeeOffered: nullableAmount,
    additionalTransactionFeePublished: nullableAmount,paymentGatewayCharge:nullableAmount,
    supplierReissueCharges:nullableAmount,taxBreakup:moneyBreakdown })),
  netCostBasisVerified:v.literal(false),gstTreatmentVerified:v.literal(false),
  calculation: v.literal("supplier_fields_preserved_not_added_together"),
});
const fareRule = v.object({ origin: v.string(), destination: v.string(), airline: v.string(),
  fareBasisCode: v.string(), detail: v.string(), restriction: v.string() });
function flag(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function reference(value: string, label: string) {
  if (!value || value.length > 2000 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Use a valid ${label} from the supplier flight search.`);
  }
}
function breakdown(value:unknown){
  if(value===undefined || value===null)return null;
  if(!Array.isArray(value) || value.length>100)throw new Error("Supplier money breakdown exceeds the supported limit or format.");
  return value.map(entry=>{
    const row=object(entry),label=string(row.key);
    if(!label.trim() || label.length>100 || /[\u0000-\u001f\u007f]/.test(label))throw new Error("Supplier money breakdown has an invalid label.");
    return {label,amount:finite(row.value)};
  });
}
function evidence(value: unknown) {
  const result = object(value), fare = object(result.Fare);
  return {
    baseFare: finite(fare.BaseFare), tax: finite(fare.Tax), yqTax: finite(fare.YQTax),
    otherCharges: finite(fare.OtherCharges), serviceFee: finite(fare.ServiceFee),
    additionalTransactionFeeOffered: finite(fare.AdditionalTxnFeeOfrd),
    additionalTransactionFeePublished: finite(fare.AdditionalTxnFeePub),
    publishedFare: finite(fare.PublishedFare), offeredFare: finite(fare.OfferedFare),
    discount:finite(fare.Discount),commissionEarned:finite(fare.CommissionEarned),plbEarned:finite(fare.PLBEarned),
    incentiveEarned:finite(fare.IncentiveEarned),tdsOnCommission:finite(fare.TdsOnCommission),
    tdsOnPlb:finite(fare.TdsOnPLB),tdsOnIncentive:finite(fare.TdsOnIncentive),paymentGatewayCharge:finite(fare.PGCharge),
    totalBaggageCharges:finite(fare.TotalBaggageCharges),totalMealCharges:finite(fare.TotalMealCharges),
    totalSeatCharges:finite(fare.TotalSeatCharges),totalSpecialServiceCharges:finite(fare.TotalSpecialServiceCharges),
    taxBreakup:breakdown(fare.TaxBreakup),chargeBreakup:breakdown(fare.ChargeBU),
    passengerBreakdown: array(result.FareBreakdown).map((entry) => {
      const row = object(entry);
      return { currency: string(row.Currency) || null,
        passengerType: finite(row.PassengerType), passengerCount: finite(row.PassengerCount),
        baseFare: finite(row.BaseFare), tax: finite(row.Tax), yqTax: finite(row.YQTax),
        additionalTransactionFeeOffered: finite(row.AdditionalTxnFeeOfrd),
        additionalTransactionFeePublished: finite(row.AdditionalTxnFeePub),paymentGatewayCharge:finite(row.PGCharge),
        supplierReissueCharges:finite(row.SupplierReissueCharges),taxBreakup:breakdown(row.TaxBreakUp) };
    }), calculation: "supplier_fields_preserved_not_added_together" as const,
    netCostBasisVerified:false as const,gstTreatmentVerified:false as const,
  };
}
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use a valid YYYY-MM-DD travel date.");
  const result = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new Error("Use a valid travel date.");
  return result.getTime();
}
function dates(start: string, end: string) {
  const first = date(start), last = date(end);
  if (last <= first || last - first > 90 * 86_400_000) throw new Error("Choose 1–90 hotel nights.");
  if (first < Math.floor(Date.now() / 86_400_000) * 86_400_000) throw new Error("Choose upcoming travel dates.");
}
function count(value: number, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error("Invalid traveller count.");
}
function currency(value: unknown) {
  const code = string(value);
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("TBO returned no supported currency; price cannot be quoted.");
  return code;
}
function floor(value: unknown) {
  if (typeof value === "number") {
    const amount=finite(value);
    if(amount===null)throw new Error("TBO returned an invalid selling-price floor.");
    return amount;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const plain = value.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(plain)) throw new Error("TBO returned an unreadable selling-price floor.");
  const amount = finite(Number(plain));
  if (amount === null) throw new Error("TBO returned an invalid selling-price floor.");
  return amount;
}
function hotelResponse(response: Record<string, unknown>) {
  const status = object(response.Status);
  if (status.Code !== 200 && status.Code !== 201) throw new Error("TBO hotel search or recheck was rejected.");
  return array(response.HotelResult).flatMap((entry) => {
    const hotel = object(entry), code = string(hotel.HotelCode), unit = currency(hotel.Currency);
    return array(hotel.Rooms).map((entry) => {
      const room = object(entry), total = finite(room.TotalFare), bookingCode = string(room.BookingCode);
      if (total === null || !code || !bookingCode) throw new Error("TBO returned an incomplete hotel price.");
      return { hotelCode: code, bookingCode, roomNames: array(room.Name).map(string), supplierTotal: total,
        fareEvidence:{totalFare:total,totalTax:finite(room.TotalTax),extraGuestCharges:finite(room.ExtraGuestCharges),
          reportedNetCost:finite(room.NetCost),reportedNetAmount:finite(room.NetAmount),reportedNetTax:finite(room.NetTax),
          serviceFee:finite(room.ServiceFee),agentCommission:finite(room.AgentCommission),
          taxBreakup:array(room.TaxBreakup).map(entry=>{const tax=object(entry);return {
            taxType:typeof tax.TaxType==="string"?tax.TaxType:finite(tax.TaxType),taxableAmount:finite(tax.TaxableAmount),
            taxPercentage:finite(tax.TaxPercentage),taxAmount:finite(tax.TaxAmount)};}),
          totalFareExcludesTdsTcs:true as const,netCostBasisVerified:false as const,
          gstTreatmentVerified:false as const,calculation:"supplier_fields_preserved_not_added_together" as const},
        mealType:string(room.MealType),withTransfers:flag(room.WithTransfers),lastCancellationDeadline:string(room.LastCancellationDeadline),
        currency: unit, inclusion: string(room.Inclusion),
        refundable: typeof room.IsRefundable === "boolean" ? room.IsRefundable : null,
        conditions: array(hotel.RateConditions).map(string), recommendedSellingRate: floor(room.RecommendedSellingRate),
        supplements: array(room.Supplements).flatMap(group=>Array.isArray(group)?group:[group]).map((entry) => {
          const supplement = object(entry);
          return { description: string(supplement.Description), amount: finite(supplement.Price),
            currency: string(supplement.Currency), type: string(supplement.Type) };
        }),
        cancellationPolicies: array(room.CancelPolicies).map((entry) => {
          const policy = object(entry);
          return { fromDate: string(policy.FromDate), chargeType: string(policy.ChargeType), amount: finite(policy.CancellationCharge) };
        }), compulsoryFeesConfirmed: false as const };
    });
  });
}
function flightResponse(response: Record<string, unknown>) {
  const inner = object(response.Response);
  if (inner.ResponseStatus !== 1) throw new Error("TBO flight search or recheck was rejected; retry with a fresh search.");
  return inner;
}
function mapFlight(value: unknown, group: number) {
  const fare = object(value), amount = object(fare.Fare);
  const total = finite(amount.OfferedFare), index = string(fare.ResultIndex);
  if (total === null || !index) throw new Error("TBO returned an incomplete flight price.");
  return { resultIndex: index, resultGroup: group, supplierTotal: total, currency: currency(amount.Currency),
    isLcc: typeof fare.IsLCC === "boolean" ? fare.IsLCC : null,
    segments: array(fare.Segments).flatMap((leg) => array(leg).map((entry) => {
      const segment = object(entry), origin = object(segment.Origin), destination = object(segment.Destination), airline = object(segment.Airline);
      return { origin: string(object(origin.Airport).AirportCode), destination: string(object(destination.Airport).AirportCode),
        airline: string(airline.AirlineCode), flightNumber: string(airline.FlightNumber),
        departure: string(origin.DepTime), arrival: string(destination.ArrTime),
        baggage: string(segment.Baggage), cabinBaggage: string(segment.CabinBaggage) };
    })), compulsoryFeesConfirmed: false as const };
}

export const connectionReadiness = internalAction({
  args: {}, returns: v.object({ hotels: v.object({ ready: v.boolean(), missing: v.array(v.string()), transport: v.literal("existing_fixed_ip_proxy"), liveVerified: v.literal(false) }),
    flights: v.object({ ready: v.boolean(), missing: v.array(v.string()), transport: v.literal("existing_fixed_ip_proxy"), liveVerified: v.literal(false) }) }),
  handler: async () => ({ hotels: readiness("hotels"), flights: readiness("flights") }),
});
// Checks existing flight authentication only. Never returns the token or
// claims that hotel access, flight availability or complete pricing works.
export const verifyFlightAccess = internalAction({
  args: {}, returns: v.object({state:v.union(v.literal("blocked"),v.literal("authenticated"),v.literal("failed")),
    missing:v.array(v.string()),checkedAt:v.number(),pricingVerified:v.literal(false)}),
  handler:async()=>{
    const connection=readiness("flights");
    if(!connection.ready)return {state:"blocked" as const,missing:connection.missing,checkedAt:Date.now(),pricingVerified:false as const};
    try{
      const token=await flightToken();
      if(typeof token!=="string" || !token.trim())throw new Error("Supplier authentication was not confirmed.");
      return {state:"authenticated" as const,missing:[],checkedAt:Date.now(),pricingVerified:false as const};
    }catch{return {state:"failed" as const,missing:[],checkedAt:Date.now(),pricingVerified:false as const};}
  },
});

export const searchHotels = internalAction({
  args: { hotelCodes: v.array(v.string()), checkIn: v.string(), checkOut: v.string(), nationality: v.string(),
    rooms: v.array(v.object({ adults: v.number(), childAges: v.array(v.number()) })), refundableOnly: v.boolean() },
  returns: v.object({ rates: v.array(hotelRate), checkedAt: v.number(), source: v.literal("TBO"), priceBasis: v.literal("supplier_bookable_unit_full_stay") }),
  handler: async (_ctx, args) => {
    requireReady("hotels"); dates(args.checkIn, args.checkOut);
    if (args.hotelCodes.length < 1 || args.hotelCodes.length > 100 || args.hotelCodes.some((code) => !/^\d{1,16}$/.test(code))) throw new Error("Choose 1–100 valid supplier hotel codes.");
    if (!/^[A-Z]{2}$/.test(args.nationality)) throw new Error("Use a two-letter guest nationality.");
    if (!args.rooms.length || args.rooms.length > 10) throw new Error("Choose 1–10 rooms.");
    const rooms = args.rooms.map((room) => {
      count(room.adults, 1, 6); count(room.childAges.length, 0, 4);
      room.childAges.forEach((age) => count(age, 0, 17));
      return { Adults: room.adults, Children: room.childAges.length, ChildrenAges: room.childAges };
    });
    const response = await post("hotelSearch", { CheckIn: args.checkIn, CheckOut: args.checkOut,
      HotelCodes: args.hotelCodes.join(","), GuestNationality: args.nationality, NoOfRooms: rooms.length, PaxRooms: rooms,
      ResponseTime: Math.round(5 + (args.hotelCodes.length - 1) * 18 / 99), IsDetailedResponse: true,
      Filters: { Refundable: args.refundableOnly, MealType: "All" } });
    return { rates: hotelResponse(response), checkedAt: Date.now(), source: "TBO" as const, priceBasis: "supplier_bookable_unit_full_stay" as const };
  },
});

export const recheckHotel = internalAction({
  args: { bookingCode: v.string() },
  returns: v.object({ rates: v.array(hotelRate), checkedAt: v.number(), rateChanged: nullableFlag, source: v.literal("TBO") }),
  handler: async (_ctx, args) => {
    if (!args.bookingCode || args.bookingCode.length > 8000) throw new Error("Use a valid supplier booking code from the search.");
    const response = await post("hotelRecheck", { BookingCode: args.bookingCode });
    return { rates: hotelResponse(response), checkedAt: Date.now(), rateChanged: flag(response.RateChanged), source: "TBO" as const };
  },
});

export const searchFlights = internalAction({
  args: { adults: v.number(), children: v.number(), infants: v.number(), directOnly: v.boolean(),
    journeyType: v.union(v.literal(1), v.literal(2), v.literal(3)),
    segments: v.array(v.object({ origin: v.string(), destination: v.string(), departureDate: v.string(), cabinClass: v.number() })) },
  returns: v.object({ rates: v.array(flightRate), traceId: v.string(), checkedAt: v.number(), source: v.literal("TBO"), priceBasis: v.literal("supplier_offered_fare_for_passenger_group") }),
  handler: async (_ctx, args) => {
    requireReady("flights"); count(args.adults, 1, 9); count(args.children, 0, 8); count(args.infants, 0, args.adults);
    if (args.adults + args.children + args.infants > 9) throw new Error("Flight search supports at most nine travellers including infants.");
    if (!args.segments.length || args.segments.length > 6 || (args.journeyType === 1 && args.segments.length !== 1) || (args.journeyType === 2 && args.segments.length !== 2)) throw new Error("Flight segments do not match the journey type.");
    let previous = 0;
    const segments = args.segments.map((segment) => {
      if (!/^[A-Z]{3}$/.test(segment.origin) || !/^[A-Z]{3}$/.test(segment.destination) || segment.origin === segment.destination) throw new Error("Use different three-letter departure and arrival airport codes.");
      const departure = date(segment.departureDate);
      if (departure < Math.floor(Date.now() / 86_400_000) * 86_400_000 || departure < previous) throw new Error("Choose upcoming flight dates in travel order.");
      previous = departure; count(segment.cabinClass, 1, 6);
      return { Origin: segment.origin, Destination: segment.destination, FlightCabinClass: segment.cabinClass,
        PreferredDepartureTime: `${segment.departureDate}T00:00:00`, PreferredArrivalTime: `${segment.departureDate}T00:00:00` };
    });
    const token = await flightToken();
    const response = flightResponse(await post("flightSearch", { TokenId: token, EndUserIp: process.env.TBO_END_USER_IP,
      AdultCount: args.adults, ChildCount: args.children, InfantCount: args.infants,
      DirectFlight: args.directOnly, JourneyType: args.journeyType, PreferredAirlines: null, Segments: segments }));
    const traceId = string(response.TraceId);
    if (!traceId) throw new Error("TBO returned no flight search reference.");
    return { rates: array(response.Results).flatMap((group, index) => array(group).map((fare) => mapFlight(fare, index))),
      traceId, checkedAt: Date.now(), source: "TBO" as const, priceBasis: "supplier_offered_fare_for_passenger_group" as const };
  },
});

export const recheckFlight = internalAction({
  args: { traceId: v.string(), resultIndex: v.string(), resultGroup: v.number() },
  returns: v.object({ fare: flightRate, traceId: v.string(), checkedAt: v.number(),
    priceChanged: nullableFlag, source: v.literal("TBO"),
    priceBasis: v.literal("supplier_offered_fare_for_passenger_group"),
    fareEvidence,
    requirements: v.object({ gstDetailsMandatory: nullableFlag,
      passportRequiredAtBooking: nullableFlag, passportFullDetailsRequiredAtBooking: nullableFlag,
      passportRequiredAtTicketing: nullableFlag, panRequiredAtBooking: nullableFlag, panRequiredAtTicketing: nullableFlag }),
  }),
  handler: async (_ctx, args) => {
    reference(args.traceId, "search reference"); reference(args.resultIndex, "result reference");
    count(args.resultGroup, 0, 100);
    const token = await flightToken();
    const response = flightResponse(await post("flightRecheck", {
      EndUserIp: process.env.TBO_END_USER_IP, TokenId: token,
      TraceId: args.traceId, ResultIndex: args.resultIndex,
    }));
    const result = object(response.Results), traceId = string(response.TraceId);
    if (!traceId || traceId !== args.traceId || string(result.ResultIndex) !== args.resultIndex) {
      throw new Error("TBO returned a different flight reference; run a fresh search before quoting.");
    }
    const requirement = (name: string) => flag(result[name] ?? response[name]);
    return { fare: mapFlight(result, args.resultGroup), traceId, checkedAt: Date.now(),
      priceChanged: flag(response.IsPriceChanged), source: "TBO" as const,
      priceBasis: "supplier_offered_fare_for_passenger_group" as const,
      fareEvidence: evidence(result),
      requirements: { gstDetailsMandatory: requirement("IsGSTMandatory"),
        passportRequiredAtBooking: requirement("IsPassportRequiredAtBook"),
        passportFullDetailsRequiredAtBooking: requirement("IsPassportFullDetailRequiredAtBook"),
        passportRequiredAtTicketing: requirement("IsPassportRequiredAtTicket"),
        panRequiredAtBooking: requirement("IsPanRequiredAtBook"), panRequiredAtTicketing: requirement("IsPanRequiredAtTicket") },
    };
  },
});

export const flightTerms = internalAction({
  args: { traceId: v.string(), resultIndex: v.string() },
  returns: v.object({ traceId: v.string(), resultIndex: v.string(), rules: v.array(fareRule),
    checkedAt: v.number(), source: v.literal("TBO"), termsAvailable: v.boolean(),
    interpretation: v.literal("supplier_text_requires_review") }),
  handler: async (_ctx, args) => {
    reference(args.traceId, "search reference"); reference(args.resultIndex, "result reference");
    const token = await flightToken();
    const response = flightResponse(await post("flightRules", {
      EndUserIp: process.env.TBO_END_USER_IP, TokenId: token,
      TraceId: args.traceId, ResultIndex: args.resultIndex,
    }));
    if (response.TraceId !== undefined && string(response.TraceId) !== args.traceId) {
      throw new Error("TBO returned terms for a different search; run a fresh search.");
    }
    const rules = array(response.FareRules).map((entry) => {
      const rule = object(entry);
      return { origin: string(rule.Origin), destination: string(rule.Destination), airline: string(rule.Airline),
        fareBasisCode: string(rule.FareBasisCode), detail: string(rule.FareRuleDetail), restriction: string(rule.FareRestriction) };
    });
    return { traceId: args.traceId, resultIndex: args.resultIndex, rules, checkedAt: Date.now(), source: "TBO" as const,
      termsAvailable: rules.some((rule) => Boolean(rule.detail.trim() || rule.restriction.trim())),
      interpretation: "supplier_text_requires_review" as const };
  },
});
