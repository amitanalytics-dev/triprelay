import {v} from "convex/values";
export const hotelMapping=v.object({stopIndex:v.number(),city:v.string(),hotelTier:v.string(),hotelCodes:v.array(v.string()),confirmationNote:v.string()});
export const hotelSearchSettings=v.object({confirmedNationalityLabel:v.string(),nationalityCode:v.string(),confirmationNote:v.string(),refundableOnly:v.boolean(),mappings:v.array(hotelMapping)});
export const hotelSearchRequest=v.object({requestId:v.string(),optionIds:v.array(v.string()),stopIndex:v.number(),city:v.string(),hotelTier:v.string(),hotelCodes:v.array(v.string()),
  checkIn:v.string(),checkOut:v.string(),nationality:v.string(),rooms:v.array(v.object({adults:v.number(),childAges:v.array(v.number())})),refundableOnly:v.boolean()});
export const hotelSearchState=v.union(v.literal("running"),v.literal("ready"),v.literal("failed"),v.literal("stale"));
