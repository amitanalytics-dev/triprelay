export type FlightSearchRequest={requestId:string;optionIds:string[];startDate:string;endDate:string;adults:number;children:number;infants:number;
  directOnly:boolean;journeyType:1|2|3;segments:{originCity:string;destinationCity:string;origin:string;destination:string;departureDate:string;cabinClass:number}[]};
export function buildFlightSearchPlan(facts:unknown,customer:unknown,settings:unknown):{requests:FlightSearchRequest[];optionCount:number;requiredChecks:string[]};
