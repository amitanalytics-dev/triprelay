export type HotelSearchRequest={requestId:string;optionIds:string[];stopIndex:number;city:string;hotelTier:string;hotelCodes:string[];
  checkIn:string;checkOut:string;nationality:string;rooms:{adults:number;childAges:number[]}[];refundableOnly:boolean};
export function buildHotelSearchPlan(facts:unknown,customer:unknown,settings:unknown):{requests:HotelSearchRequest[];optionCount:number;requiredChecks:string[]};
