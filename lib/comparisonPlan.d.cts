export interface ComparisonFacts {destination?: string; adults?: number; nights?: number; departureCity?: string;
  startDates:string[];hotelTiers:string[];transportOptions:string[];meals:string[];
  routeStops:{city:string;nights?:number}[];rooms:{adults:number;childAges:number[]}[];}
export interface ComparisonOption {optionId:string;startDate:string;endDate:string;hotelTier:string;transport:string;
  adults:number;departureCity:string;rooms:{adults:number;childAges:number[]}[];meals:string[];
  stops:{city:string;nights:number;arrivalDate:string;departureDate:string}[];}
export function buildComparisonPlan(facts:ComparisonFacts):{options:ComparisonOption[];requiredChecks:string[]};
