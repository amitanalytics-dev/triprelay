"use node";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { renderQuotePdf } from "../lib/quotePdf.mjs";

export const download = action({
  args: { quoteVersionId: v.id("quoteVersions"), convertedWebpLogo: v.optional(v.bytes()) },
  returns: v.bytes(),
  handler: async (ctx, args): Promise<ArrayBuffer> => {
    // This public query authenticates ownership and checks fresh supplier facts,
    // the current brief and active designated-reviewer approval.
    const result = await ctx.runQuery(api.quotes.getMine, { quoteVersionId: args.quoteVersionId });
    if (!result?.ready || !result.quote) throw new ConvexError("This quote needs fresh complete supplier facts and review before download.");
    const cachedId = await ctx.runQuery(internal.quotes.cachedPdf, { quoteVersionId: args.quoteVersionId });
    if (cachedId) {
      const cached = await ctx.storage.get(cachedId);
      if (!cached) throw new ConvexError("The saved PDF could not be loaded. Please contact the team.");
      await ctx.runMutation(api.quotes.release,{quoteVersionId:args.quoteVersionId});
      return cached.arrayBuffer();
    }
    let logoBytes: Uint8Array | undefined;
    let logoType: string | undefined;
    const logoId = result.quote.branding.logoStorageId;
    if (logoId) {
      const blob = await ctx.storage.get(logoId);
      if (!blob) throw new ConvexError("The saved agency logo could not be loaded. Retry or replace it before downloading.");
      logoType = blob.type;
      if (logoType === "image/webp") {
        // The owner's browser converts its saved WebP logo to PNG. This input
        // can change only that agency's branding, never quote facts or prices.
        if (!args.convertedWebpLogo || args.convertedWebpLogo.byteLength > 2_000_000) throw new ConvexError("Convert the saved logo before downloading this quote.");
        logoBytes = new Uint8Array(args.convertedWebpLogo);
        if (![137,80,78,71,13,10,26,10].every((value,index) => logoBytes![index] === value)) throw new ConvexError("The converted agency logo must be PNG.");
        logoType = "image/png";
      } else {
        if (logoType !== "image/png" && logoType !== "image/jpeg") throw new ConvexError("The saved logo format needs checking.");
        logoBytes = new Uint8Array(await blob.arrayBuffer());
      }
    }
    let bytes: Uint8Array;
    try { bytes = await renderQuotePdf(result, { logoBytes, logoType }); }
    catch { throw new ConvexError("The PDF could not be prepared. Check the agency logo and retry while prices are current."); }
    // Recheck atomically after rendering: edits, expiry, revoked reviewers or
    // correction decisions during generation must prevent delivery.
    await ctx.runMutation(api.quotes.release, { quoteVersionId: args.quoteVersionId });
    const storageId = await ctx.storage.store(new Blob([Uint8Array.from(bytes).buffer],{type:"application/pdf"}));
    try {
      const retained = await ctx.runMutation(internal.quotes.attachPdf,{quoteVersionId:args.quoteVersionId,storageId});
      if (retained !== storageId) {
        await ctx.storage.delete(storageId);
        const existing = await ctx.storage.get(retained);
        if (!existing) throw new ConvexError("The saved PDF could not be loaded. Please retry.");
        bytes = new Uint8Array(await existing.arrayBuffer());
      }
    } catch (error) { await ctx.storage.delete(storageId); throw error; }
    // A final atomic check also covers edits/review changes during file storage.
    await ctx.runMutation(api.quotes.release,{quoteVersionId:args.quoteVersionId});
    return Uint8Array.from(bytes).buffer;
  },
});
