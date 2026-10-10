import { getFunctionName } from "convex/server";
import { renderQuotePdf } from "../lib/quotePdf.mjs";
const scenario = new URLSearchParams(location.search).get("scenario");
const logoCanvas = document.createElement("canvas"); logoCanvas.width=160; logoCanvas.height=60;
const logoContext=logoCanvas.getContext("2d")!; logoContext.fillStyle="#0d6e64";logoContext.fillRect(0,0,160,60);
logoContext.fillStyle="#fff";logoContext.font="20px sans-serif";logoContext.fillText("SAMPLE LOGO",8,38);
const logoUrl=logoCanvas.toDataURL("image/webp");
const deadline = Date.now() + (scenario === "expiry" ? 1500 : 60000);
const branding = { businessName: "Test agency — sample data", contactName: "Test reviewer", contactEmail: "test@triprelay.invalid", contactPhone: "0000000000",
  ...(scenario === "logo-webp" ? {logoStorageId:"sample-logo"} : {}) };
const days = [{ date: "2026-11-09", title: "Test arrival plan", activities: ["Suggested transfer"] }, { date: "2026-11-10", title: "Test departure plan", activities: ["Suggested return"] }];
const prices = { currency: "INR", items: [{ description: "Hotel stay", finalClientPriceMinor: 12100 }],
  finalClientPriceMinor: 12100, pricesCheckedAt: Date.now() - 1000, validUntil: deadline };
const comparisonChoice={optionId:"2026-11-09/4-star/private",startDate:"2026-11-09",endDate:"2026-11-10",hotelTier:"4-star",transport:"private",adults:4,
  rooms:[{adults:2,childAges:[]},{adults:2,childAges:[]}],meals:["breakfast"],departureCity:"Ahmedabad",
  stops:[{city:"Hanoi",nights:1,arrivalDate:"2026-11-09",departureDate:"2026-11-10"}]};
const version = { _id: "test-version", option: scenario==="review-lowest"?"lowest":"balanced", briefRevision: 1, branding, days,
  ...(["review-lowest","review-source-stale","review-source-loading"].includes(scenario ?? "")?{intakeId:"sample-intake"}:{}),
  inclusions: ["Test hotel stay"], exclusions: ["Visa services"], cancellationTerms: ["Sample cancellation terms; not a real offer"],
  components: [{ id: "hotel", kind: "hotel", mode: "live", available: true, checkedAt: Date.now() - 1000,
    validUntil: deadline, currency: "INR", supplierCostMinor: 10000, minimumClientPriceMinor:12100, costBasis: "verified_net", gstIncluded: true,
    compulsoryFeesConfirmed: true, supplierReference: "SYNTHETIC-PRIVATE-REFERENCE", description: "Sample hotel component", terms: "Sample supplier terms" }] };
export function useQuery(reference: unknown,args:unknown) {
  if(args==="skip")return undefined;
  switch (getFunctionName(reference as never)) {
    case "supplierRuns:queue": return [{intakeId:"sample-intake",agencyName:branding.businessName,revisionNumber:1,status:"complete_brief"},
      {intakeId:"other-intake",agencyName:"Second sample agency",revisionNumber:2,status:"needs_details"}];
    case "supplierRuns:brief":
    case "supplierRuns:details": {
      if(getFunctionName(reference as never)==="supplierRuns:brief" && scenario==="review-source-loading")return undefined;
      const other=(args as {intakeId:string}).intakeId==="other-intake",stale=scenario==="review-source-stale";
      const saved={state:"ready",attempt:1,startedAt:Date.now()-5000,finishedAt:Date.now()-1000,reason:""},missing={state:"not_started",attempt:null,startedAt:null,finishedAt:null,reason:""};
      return {originalMessage:other?"SAMPLE second enquiry: dates still unknown.":"SAMPLE private client limit: vegetarian meals; maximum INR 80,000.\nOriginally three adults, corrected to four.",
        revisionNumber:stale||other?2:1,factsConfirmed:!other,quoteReady:false,hotelOffset:(args as {hotelOffset?:number}).hotelOffset??0,flightOffset:(args as {flightOffset?:number}).flightOffset??0,hotelCount:other?0:12,flightCount:other?0:2,
        facts:{destination:"Vietnam",adults:4,nights:1,departureCity:"Ahmedabad",startDates:other?[]:["2026-11-09"],hotelTiers:["4-star"],transportOptions:["private"],meals:["breakfast"],
          routeStops:[{city:"Hanoi",nights:1}],rooms:[{adults:2,childAges:[]},{adults:2,childAges:[]}]},supplierFacts:{leadNationality:"India",flights:"include",flightRequest:"SAMPLE return flight request"},
        hotels:other?[]:[{label:((args as {hotelOffset?:number}).hotelOffset??0)>0?"2026-11-10 to 2026-11-11 · Da Nang · 5-star":"2026-11-09 to 2026-11-10 · Hanoi · 4-star",current:!stale,search:stale?{...saved,state:"stale",reason:"The saved enquiry changed."}:saved,recheck:missing,parts:[]}],
        flights:other?[]:[{label:"2026-11-09 to 2026-11-10 · Ahmedabad to Hanoi",current:!stale,search:saved,recheck:{...saved,state:"failed",reason:"The supplier price or terms check failed."},
          parts:[{slot:0,stage:"fare",check:saved},{slot:0,stage:"terms",check:{...missing,state:"failed",reason:"Fresh matching terms are missing."}}]}]};
    }
    case "quotes:listMine": return [{ quoteVersionId: "test-version", option: "balanced", createdAt: Date.now(), briefRevision: 1, decision: "approved" }];
    case "quotes:getMine": return scenario === "blocked" ? { quoteVersionId: "test-version", option: "balanced", ready: false,
      reasons: ["Confirm all compulsory fees."], quote: null } : { quoteVersionId: "test-version", option: "balanced", ready: true,
      reasons: [], quote: { branding, days, prices,comparisonChoice, inclusions: version.inclusions, exclusions: version.exclusions, cancellationTerms: version.cancellationTerms } };
    case "quotes:reviewQueue": return [{ quoteVersionId: "test-version", option: "balanced", briefRevision: 1, decision: "pending", agencyName: branding.businessName }];
    case "quotes:getMineLogoUrl": return scenario === "logo-webp" ? logoUrl : null;
    case "quotes:reviewDetails": return { version, decision: "pending", note: "", prices: scenario === "review-blocked" ? null : prices,
      ...(scenario==="review-lowest"?{comparison:{current:true,validUntil:deadline,choices:[{choice:comparisonChoice,finalClientPriceMinor:12100},
        {choice:{...comparisonChoice,optionId:"2026-11-09/5-star/shared",hotelTier:"5-star",transport:"shared"},finalClientPriceMinor:15000}]}}:{}),
      reasons: scenario === "review-blocked" ? ["Confirm all compulsory fees."] : scenario === "review-source-stale" ? ["The current brief changed. Prepare a new quote version."] : [] };
    default: throw new Error("Unexpected test query");
  }
}
export function useMutation() {
  return async (args: unknown) => { (window as unknown as { testDecision: unknown }).testDecision = args; return "synthetic-decision"; };
}
export function useAction() {
  return async (args: {convertedWebpLogo?: ArrayBuffer}) => {
    if (scenario === "download-failure") throw new Error("Sample PDF preparation failed. Please retry.");
    if(scenario === "logo-webp") {
      if(!args.convertedWebpLogo)throw new Error("Converted logo missing");
      (window as unknown as {testLogoConverted:boolean}).testLogoConverted=[137,80,78,71,13,10,26,10].every((value,index)=>new Uint8Array(args.convertedWebpLogo!)[index]===value);
    }
    const bytes = await renderQuotePdf({ ready:true, quoteVersionId:"test-version", option:"balanced",
      quote:{branding,days,prices,comparisonChoice,inclusions:version.inclusions,exclusions:version.exclusions,cancellationTerms:version.cancellationTerms} },
      args.convertedWebpLogo ? {logoBytes:new Uint8Array(args.convertedWebpLogo),logoType:"image/png"} : {});
    return Uint8Array.from(bytes).buffer;
  };
}
