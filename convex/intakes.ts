import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v, type Infer } from "convex/values";
import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { intakeFacts, intakeQuestion, intakeStatus, intakeSupplierFacts } from "./schema";
import type { Id } from "./_generated/dataModel";
import { buildComparisonPlan } from "../lib/comparisonPlan.cjs";

type Facts=Infer<typeof intakeFacts>;
type SupplierFacts=Infer<typeof intakeSupplierFacts>;
export function supplierQuestion(facts:Facts,supplier:SupplierFacts):{field:string;prompt:string}|null {
  if(!supplier.leadNationality)return {field:"leadNationality",prompt:"What is the lead traveller's nationality?"};
  if(!supplier.flights)return {field:"flights",prompt:"Should the quote include flights?"};
  if(supplier.flights==="include" && !supplier.flightRequest)return {field:"flightRequest",prompt:"Which flight legs must be included? State the cities or airports and any timing requirements for the date alternatives."};
  if(facts.rooms.some(room=>room.childAges.length) && supplier.childAgesAtTravelConfirmed!==true)return {field:"childAgesAtTravelConfirmed",prompt:"Are the saved child ages their ages on the travel dates? Confirm or correct the room details first."};
  return null;
}
export function emptyFacts():Facts{return {startDates:[],hotelTiers:[],transportOptions:[],meals:[],routeStops:[],rooms:[]};}
const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
const amount="(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)";
function numberOf(text:string){return words[text.toLowerCase()]??Number(text);}
/** Candidate hints only; no hint is automatically confirmed. No external/model call. */
export function extractCandidates(original:string):Facts {
  const facts=emptyFacts();
  if(/\bVietnam\b/i.test(original))facts.destination="Vietnam";
  const adults=original.match(new RegExp(`\\b${amount}\\s*adults?\\b`,"i"));if(adults)facts.adults=numberOf(adults[1]);
  const nights=original.match(new RegExp(`\\b${amount}\\s*nights?\\b`,"i"));if(nights)facts.nights=numberOf(nights[1]);
  // Deliberately recognise only explicit day-list + month + year; never infer a year.
  const months=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const monthNames=months.map(m=>`${m}|${m.slice(0,3)}`).join("|");
  const dates=original.match(new RegExp(`\\b(\\d{1,2}(?:(?:\\s*[-–,/]\\s*|\\s+or\\s+|\\s+and\\s+)\\d{1,2})*)\\s+(${monthNames})\\s+(20\\d{2})\\b`,"i"));
  if(dates){const month=months.findIndex(m=>m.toLowerCase().startsWith(dates[2].toLowerCase()))+1,year=Number(dates[3]);const dayTokens=dates[1].match(/\d+/g)??[];
    let days=dayTokens.map(Number);if(dayTokens.length===2&&/[-–]/.test(dates[1])){const [a,b]=days;if(b>=a&&b-a<8)days=Array.from({length:b-a+1},(_,i)=>a+i);else days=[];}
    facts.startDates=days.map(day=>`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`).filter(date=>validDate(date)!==null).slice(0,8);
  }
  for(const tier of [3,4,5])if(new RegExp(`\\b${tier}\\s*[- ]?\\s*star\\b|\\b${tier}\\s*[/]\\s*[345]\\s*[- ]?star\\b|\\b[345]\\s*[/]\\s*${tier}\\s*[- ]?star\\b`,"i").test(original))facts.hotelTiers.push(`${tier}-star` as Facts["hotelTiers"][number]);
  for(const option of ["private","shared"] as const)if(new RegExp(`\\b${option}\\b`,"i").test(original))facts.transportOptions.push(option);
  for(const meal of ["breakfast","lunch","dinner"] as const)if(new RegExp(`\\b${meal}\\b`,"i").test(original))facts.meals.push(meal);
  if(/\ball\s+(?:three|3)\s+meals\b/i.test(original))facts.meals=["breakfast","lunch","dinner"];
  const departure=original.match(/\b(?:depart(?:ure|ing)?\s+(?:city\s+)?(?:from\s+)?|flying\s+from\s+|from\s+)([A-Za-z][A-Za-z -]{1,60}?)(?=[,.;\n]|\s+to\s+|$)/i);
  if(departure)facts.departureCity=departure[1].trim();
  // Only known Vietnam city mentions become candidate stops; order follows their actual occurrence.
  const cityMatches=[...original.matchAll(/\bHanoi\b|\bHa\s?Long\b|\bDa\s?Nang\b|\bHo Chi Minh City\b|\bHoi An\b/gi)];
  for(const match of cityMatches){const city=/^Ha\s?Long$/i.test(match[0])?"Ha Long":/^Da\s?Nang$/i.test(match[0])?"Da Nang":/^Hanoi$/i.test(match[0])?"Hanoi":match[0];if(facts.routeStops.some(s=>s.city.toLowerCase()===city.toLowerCase()))continue;
    const following=original.slice((match.index??0)+match[0].length,(match.index??0)+match[0].length+35);
    const stopNights=following.match(new RegExp(`^[\\s:=(,-]*${amount}\\s+nights?\\b`,"i"));
    facts.routeStops.push({city,...(stopNights?{nights:numberOf(stopNights[1])}:{})});
  }
  const rooms=original.match(new RegExp(`\\b${amount}\\s+rooms?\\s+(?:with\\s+)?${amount}\\s+adults?\\s+(?:each|per room)\\b`,"i"));
  if(rooms){const count=numberOf(rooms[1]),occupancy=numberOf(rooms[2]);if(count<=10&&occupancy<=6)facts.rooms=Array.from({length:count},()=>({adults:occupancy,childAges:[]}));}
  return facts;
}
export function sourceHints(original:string):{field:string;snippet:string}[]{
  const hints:{field:string;snippet:string}[]=[];
  const patterns:[string,RegExp][]=[
    ["destination",/\bVietnam\b/i],
    ["adults",new RegExp(`\\b${amount}\\s*adults?\\b`,"i")],
    ["nights",new RegExp(`\\b${amount}\\s*nights?\\b`,"i")],
    ["startDates",/\b\d{1,2}(?:(?:\s*[-–,/]\s*|\s+or\s+|\s+and\s+)\d{1,2})*\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+20\d{2}\b/i],
    ["hotelTiers",/\b[345]\s*[/]\s*[345]\s*[- ]?star\b|\b[345]\s*[- ]?star\b/gi],
    ["transportOptions",/\b(?:private|shared)\b/gi],
    ["meals",/\b(?:breakfast|lunch|dinner|all\s+(?:three|3)\s+meals)\b/gi],
    ["routeStops",/\b(?:Hanoi|Ha\s?Long|Da\s?Nang|Ho Chi Minh City|Hoi An)\b(?:\s*[:=(,-]?\s*(?:\d{1,2}|one|two|three|four|five|six)\s*nights?\b)?/gi],
    ["rooms",new RegExp(`\\b${amount}\\s+rooms?\\s+(?:with\\s+)?${amount}\\s+adults?\\s+(?:each|per room)\\b`,"i")],
    ["departureCity",/\b(?:departure\s+(?:city\s+)?(?:from\s+)?|departing\s+(?:from\s+)?|flying\s+from\s+|from\s+)[A-Za-z][A-Za-z -]{1,60}?(?=[,.;\n]|\s+to\s+|$)/i],
  ];
  for(const [field,pattern]of patterns){const matches=pattern.global?[...original.matchAll(pattern)]:original.match(pattern)?[original.match(pattern)!]:[];for(const match of matches)hints.push({field,snippet:match[0].slice(0,160)});}
  return hints.slice(0,40);
}
function validDate(date:string):number|null{if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;const time=Date.parse(`${date}T00:00:00Z`);return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===date?time:null;}
function boundedText(value:string,label:string,max:number){const clean=value.trim();if(!clean||clean.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(clean))throw new ConvexError(`${label} must contain 1–${max} characters.`);return clean;}
function count(value:number,label:string,min:number,max:number){if(!Number.isSafeInteger(value)||value<min||value>max)throw new ConvexError(`${label} must be a whole number between ${min} and ${max}.`);}
function canonical(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
  if(value!==null&&typeof value==="object")return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>`${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value)??"null";
}
export function validateFacts(input:Facts):Facts{
  const facts:Facts={...input,startDates:[...input.startDates],hotelTiers:[...input.hotelTiers],transportOptions:[...input.transportOptions],meals:[...input.meals],routeStops:input.routeStops.map(s=>({...s})),rooms:input.rooms.map(r=>({adults:r.adults,childAges:[...r.childAges]}))};
  if(facts.adults!==undefined)count(facts.adults,"Adults",1,30);
  if(facts.nights!==undefined)count(facts.nights,"Nights",1,90);
  if(facts.departureCity!==undefined)facts.departureCity=boundedText(facts.departureCity,"Departure city",100);
  if(facts.startDates.length>8)throw new ConvexError("Keep at most eight date alternatives.");
  const today=Math.floor(Date.now()/86400000)*86400000;
  for(const date of facts.startDates){const time=validDate(date);if(time===null||time<today||time>today+730*86400000)throw new ConvexError("Use upcoming start dates within two years.");}
  for(const [array,max,label] of [[facts.startDates,8,"dates"],[facts.hotelTiers,3,"hotel tiers"],[facts.transportOptions,2,"transport choices"],[facts.meals,3,"meals"]] as const)if(array.length>max||new Set(array).size!==array.length)throw new ConvexError(`Use distinct ${label}.`);
  if(facts.routeStops.length>10)throw new ConvexError("Keep at most ten route stops.");
  for(const stop of facts.routeStops){stop.city=boundedText(stop.city,"Stop city",100);if(stop.nights!==undefined)count(stop.nights,"Stop nights",0,90);}
  if(new Set(facts.routeStops.map(s=>s.city.toLowerCase())).size!==facts.routeStops.length)throw new ConvexError("Keep each route stop once.");
  if(facts.routeStops.length&&facts.routeStops.every(s=>s.nights!==undefined)&&facts.nights!==undefined&&facts.routeStops.reduce((sum,s)=>sum+(s.nights??0),0)!==facts.nights)throw new ConvexError("The nights at each stop must add up to the total trip nights.");
  if(facts.rooms.length>10)throw new ConvexError("Keep at most ten rooms.");
  for(const room of facts.rooms){count(room.adults,"Adults per room",1,6);if(room.childAges.length>4)throw new ConvexError("Keep at most four children per room.");room.childAges.forEach(age=>count(age,"Child age",0,17));}
  if(facts.adults!==undefined&&facts.rooms.length&&facts.rooms.reduce((sum,r)=>sum+r.adults,0)!==facts.adults)throw new ConvexError("Room adults must add up to the trip adult count.");
  if(facts.rooms.reduce((sum,r)=>sum+r.adults+r.childAges.length,0)>30)throw new ConvexError("Keep at most 30 travellers.");
  return facts;
}
export function nextQuestion(facts:Facts,confirmed:boolean):{field:string;prompt:string}|null{
  if(!confirmed)return {field:"confirmation",prompt:"Check the extracted details and confirm or correct them. Missing details will be asked next."};
  if(!facts.destination)return {field:"destination",prompt:"Is this trip to Vietnam?"};
  if(facts.adults===undefined)return {field:"adults",prompt:"How many adults are travelling?"};
  if(facts.nights===undefined)return {field:"nights",prompt:"How many nights is the trip?"};
  if(!facts.startDates.length)return {field:"startDates",prompt:"Which start dates should we compare, including the year?"};
  if(!facts.routeStops.length)return {field:"routeStops",prompt:"Which Vietnam stops should the trip include, in order?"};
  const missingStop=facts.routeStops.find(s=>s.nights===undefined);if(missingStop)return {field:"routeStops",prompt:`How many nights should be spent in ${missingStop.city}?`};
  if(!facts.rooms.length)return {field:"rooms",prompt:"How many rooms, adults and children in each room should we price?"};
  if(!facts.departureCity)return {field:"departureCity",prompt:"Which city will the travellers depart from?"};
  if(!facts.hotelTiers.length)return {field:"hotelTiers",prompt:"Which hotel tiers should we compare?"};
  if(!facts.transportOptions.length)return {field:"transportOptions",prompt:"Should we compare private transport, shared transport, or both?"};
  if(!facts.meals.length)return {field:"meals",prompt:"Which meals must be included: breakfast, lunch and dinner?"};
  return null;
}
async function ownAgent(ctx:QueryCtx|MutationCtx){const userId=await getAuthUserId(ctx);if(!userId)throw new ConvexError("Sign in to save or read an enquiry.");const agent=await ctx.db.query("agents").withIndex("by_user",q=>q.eq("userId",userId)).unique();if(!agent)throw new ConvexError("Save your agency details first.");return agent;}
const response=v.object({intakeId:v.id("intakes"),revisionNumber:v.number(),status:intakeStatus,nextQuestion:v.union(intakeQuestion,v.null())});
export const create=mutation({args:{originalMessage:v.string(),requestId:v.string()},returns:response,handler:async(ctx,args)=>{
  const agent=await ownAgent(ctx);boundedText(args.originalMessage,"Original English enquiry",8000);
  if(args.originalMessage.length>8000)throw new ConvexError("Original English enquiry must be at most 8000 characters.");
  const originalMessage=args.originalMessage;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.requestId))throw new ConvexError("Use a new valid enquiry request ID.");
  const old=await ctx.db.query("intakes").withIndex("by_agent_request",q=>q.eq("agentId",agent._id).eq("requestId",args.requestId)).unique();
  if(old){if(old.originalMessage!==originalMessage)throw new ConvexError("This request ID belongs to another message.");return {intakeId:old._id,revisionNumber:old.revisionNumber,status:old.status,nextQuestion:nextQuestion(old.facts,old.factsConfirmed)};}
  const candidates=extractCandidates(originalMessage),facts=emptyFacts(),now=Date.now();
  const intakeId=await ctx.db.insert("intakes",{agentId:agent._id,requestId:args.requestId,originalMessage,candidates,sourceHints:sourceHints(originalMessage),facts,factsConfirmed:false,status:"needs_confirmation",revisionNumber:1,createdAt:now,updatedAt:now});
  return {intakeId,revisionNumber:1,status:"needs_confirmation" as const,nextQuestion:nextQuestion(facts,false)};
}});
export const getMine=query({args:{intakeId:v.id("intakes")},returns:v.union(v.object({_id:v.id("intakes"),originalMessage:v.string(),candidates:intakeFacts,sourceHints:v.array(v.object({field:v.string(),snippet:v.string()})),facts:intakeFacts,factsConfirmed:v.boolean(),status:intakeStatus,revisionNumber:v.number(),createdAt:v.number(),updatedAt:v.number(),nextQuestion:v.union(intakeQuestion,v.null()),supplierFacts:intakeSupplierFacts,nextSupplierQuestion:v.union(intakeQuestion,v.null())}),v.null()),handler:async(ctx,{intakeId})=>{
  const agent=await ownAgent(ctx),record=await ctx.db.get(intakeId);if(!record||record.agentId!==agent._id)return null;
  return {_id:record._id,originalMessage:record.originalMessage,candidates:record.candidates,sourceHints:record.sourceHints??[],facts:record.facts,factsConfirmed:record.factsConfirmed,status:record.status,revisionNumber:record.revisionNumber,createdAt:record.createdAt,updatedAt:record.updatedAt,nextQuestion:nextQuestion(record.facts,record.factsConfirmed),supplierFacts:record.supplierFacts??{},nextSupplierQuestion:record.status==="complete_brief"?supplierQuestion(record.facts,record.supplierFacts??{}):null};
}});
export const listMine=query({args:{},returns:v.array(v.object({_id:v.id("intakes"),status:intakeStatus,revisionNumber:v.number(),createdAt:v.number(),updatedAt:v.number()})),handler:async(ctx)=>{const agent=await ownAgent(ctx);const records=await ctx.db.query("intakes").withIndex("by_agent_created",q=>q.eq("agentId",agent._id)).order("desc").take(20);return records.map(r=>({_id:r._id,status:r.status,revisionNumber:r.revisionNumber,createdAt:r.createdAt,updatedAt:r.updatedAt}));}});
export const confirmFacts=mutation({args:{intakeId:v.id("intakes"),expectedRevisionNumber:v.number(),facts:intakeFacts},returns:response,handler:async(ctx,args)=>{
  const agent=await ownAgent(ctx),record=await ctx.db.get(args.intakeId);if(!record||record.agentId!==agent._id)throw new ConvexError("This enquiry is not available.");
  const facts=validateFacts(args.facts);
  if(!Number.isSafeInteger(args.expectedRevisionNumber)||args.expectedRevisionNumber!==record.revisionNumber){
    // A transport retry of the exact previously confirmed facts is safe and creates no new revision.
    if(args.expectedRevisionNumber===record.revisionNumber-1&&record.factsConfirmed&&canonical(facts)===canonical(record.facts))return {intakeId:record._id,revisionNumber:record.revisionNumber,status:record.status,nextQuestion:nextQuestion(record.facts,true)};
    throw new ConvexError("This enquiry changed. Reload its latest details before confirming.");
  }
  const question=nextQuestion(facts,true),status=question?"needs_details" as const:"complete_brief" as const,revisionNumber=record.revisionNumber+1;
  await ctx.db.insert("intakeRevisions",{intakeId:record._id,agentId:record.agentId,revisionNumber:record.revisionNumber,
    facts:record.facts,factsConfirmed:record.factsConfirmed,status:record.status,...(record.supplierFacts?{supplierFacts:record.supplierFacts}:{}),savedAt:Date.now()});
  const supplierFacts={...(record.supplierFacts??{})};
  if(JSON.stringify(facts.rooms)!==JSON.stringify(record.facts.rooms))delete supplierFacts.childAgesAtTravelConfirmed;
  if(["startDates","departureCity","routeStops","nights"].some(key=>JSON.stringify(facts[key as keyof Facts])!==JSON.stringify(record.facts[key as keyof Facts])))delete supplierFacts.flightRequest;
  await ctx.db.patch(record._id,{facts,factsConfirmed:true,status,supplierFacts,revisionNumber,updatedAt:Math.max(Date.now(),record.updatedAt+1)});
  return {intakeId:record._id,revisionNumber,status,nextQuestion:question};
}});
export const saveSupplierFacts=mutation({
  args:{intakeId:v.id("intakes"),expectedRevisionNumber:v.number(),supplierFacts:intakeSupplierFacts},
  returns:v.object({revisionNumber:v.number(),nextQuestion:v.union(intakeQuestion,v.null())}),
  handler:async(ctx,args)=>{
    const agent=await ownAgent(ctx),record=await ctx.db.get(args.intakeId);
    if(!record || record.agentId!==agent._id)throw new ConvexError("This enquiry is not available.");
    if(!record.factsConfirmed || record.status!=="complete_brief" || nextQuestion(record.facts,true))throw new ConvexError("Confirm the complete comparison brief first.");
    const supplierFacts={...args.supplierFacts};
    if(supplierFacts.leadNationality!==undefined)supplierFacts.leadNationality=boundedText(supplierFacts.leadNationality,"Lead traveller nationality",100);
    if(supplierFacts.flightRequest!==undefined)supplierFacts.flightRequest=boundedText(supplierFacts.flightRequest,"Required flight legs",2000);
    if(supplierFacts.flights!=="include")delete supplierFacts.flightRequest;
    if(!Number.isSafeInteger(args.expectedRevisionNumber) || args.expectedRevisionNumber!==record.revisionNumber){
      if(args.expectedRevisionNumber===record.revisionNumber-1 && record.supplierFactsRevision===record.revisionNumber && canonical(supplierFacts)===canonical(record.supplierFacts??{}))return {revisionNumber:record.revisionNumber,nextQuestion:supplierQuestion(record.facts,supplierFacts)};
      throw new ConvexError("This enquiry changed. Reload its latest details before saving.");
    }
    if(canonical(supplierFacts)===canonical(record.supplierFacts??{}))return {revisionNumber:record.revisionNumber,nextQuestion:supplierQuestion(record.facts,supplierFacts)};
    await ctx.db.insert("intakeRevisions",{intakeId:record._id,agentId:record.agentId,revisionNumber:record.revisionNumber,
      facts:record.facts,factsConfirmed:record.factsConfirmed,status:record.status,...(record.supplierFacts?{supplierFacts:record.supplierFacts}:{}),savedAt:Date.now()});
    const revisionNumber=record.revisionNumber+1;
    await ctx.db.patch(record._id,{supplierFacts,supplierFactsRevision:revisionNumber,revisionNumber,updatedAt:Math.max(Date.now(),record.updatedAt+1)});
    return {revisionNumber,nextQuestion:supplierQuestion(record.facts,supplierFacts)};
  },
});
export const history=query({args:{intakeId:v.id("intakes")},returns:v.array(v.object({revisionNumber:v.number(),facts:intakeFacts,
  supplierFacts:intakeSupplierFacts,savedAt:v.number()})),handler:async(ctx,args)=>{
  const agent=await ownAgent(ctx),record=await ctx.db.get(args.intakeId);
  if(!record || record.agentId!==agent._id)return [];
  const rows=await ctx.db.query("intakeRevisions").withIndex("by_intake_revision",q=>q.eq("intakeId",record._id)).order("desc").take(20);
  return rows.map(row=>({revisionNumber:row.revisionNumber,facts:row.facts,supplierFacts:row.supplierFacts??{},savedAt:row.savedAt}));
}});
export const comparisonPlan=query({
  args:{intakeId:v.id("intakes")},
  returns:v.union(v.object({revisionNumber:v.number(),requiredChecks:v.array(v.string()),options:v.array(v.object({
    optionId:v.string(),startDate:v.string(),endDate:v.string(),hotelTier:v.string(),transport:v.string(),
    adults:v.number(),departureCity:v.string(),rooms:v.array(v.object({adults:v.number(),childAges:v.array(v.number())})),
    meals:v.array(v.string()),stops:v.array(v.object({city:v.string(),nights:v.number(),arrivalDate:v.string(),departureDate:v.string()})),
  }))}),v.null()),
  handler:async(ctx,args)=>{
    const agent=await ownAgent(ctx),record=await ctx.db.get(args.intakeId);
    if(!record || record.agentId!==agent._id)return null;
    if(!record.factsConfirmed || record.status!=="complete_brief" || nextQuestion(record.facts,true))return null;
    return {revisionNumber:record.revisionNumber,...buildComparisonPlan(record.facts)};
  },
});
