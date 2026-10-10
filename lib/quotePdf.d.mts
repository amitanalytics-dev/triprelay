export function renderQuotePdf(result: { ready: boolean; quoteVersionId: string; option: string; quote: null | {
  branding: { businessName: string; contactName: string; contactEmail: string; contactPhone: string };
  comparisonChoice?:{startDate:string;endDate:string;hotelTier:string;transport:string;adults:number;rooms:unknown[];meals:string[]};
  prices: { currency: string; finalClientPriceMinor: number; pricesCheckedAt: number; validUntil: number;
    items: { description: string; finalClientPriceMinor: number }[] };
  days: { date: string; title: string; activities: string[] }[];
  inclusions: string[]; exclusions: string[]; cancellationTerms: string[];
}}, options?: { logoBytes?: Uint8Array; logoType?: string }): Promise<Uint8Array>;
