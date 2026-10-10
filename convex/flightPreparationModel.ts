import {v} from "convex/values";
export const flightSegment=v.object({originCity:v.string(),destinationCity:v.string(),origin:v.string(),destination:v.string(),departureDate:v.string(),cabinClass:v.number()});
export const flightRouteFields={adults:v.number(),children:v.number(),infants:v.number(),directOnly:v.boolean(),
  journeyType:v.union(v.literal(1),v.literal(2),v.literal(3)),segments:v.array(flightSegment)};
export const flightSearchSettings=v.object({confirmedFlightRequest:v.string(),confirmationNote:v.string(),routes:v.array(v.object({
  ...flightRouteFields,startDate:v.string(),confirmationNote:v.string()}))});
export const flightSearchRequest=v.object({...flightRouteFields,requestId:v.string(),optionIds:v.array(v.string()),startDate:v.string(),endDate:v.string()});
