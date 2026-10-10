import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

export const upload = action({
  args: { bytes: v.bytes(), contentType: v.string() },
  returns: v.object({ logoStorageId: v.id("_storage") }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in to upload your logo.");
    const bytes = new Uint8Array(args.bytes);
    if (!bytes.length || bytes.length > 500_000) throw new ConvexError("Choose a logo smaller than 500 KB.");
    const png = [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = new TextDecoder().decode(bytes.slice(0,4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8,12)) === "WEBP";
    const valid = (args.contentType === "image/png" && png) || (args.contentType === "image/jpeg" && jpeg) || (args.contentType === "image/webp" && webp);
    if (!valid) throw new ConvexError("Choose a PNG, JPEG or WebP image.");
    const storageId = await ctx.storage.store(new Blob([args.bytes], { type: args.contentType }));
    try {
      await ctx.runMutation(internal.logos.attach, { userId, storageId });
    } catch (error) {
      await ctx.storage.delete(storageId);
      throw error;
    }
    return { logoStorageId: storageId };
  },
});

export const attach = internalMutation({
  args: { userId: v.id("users"), storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const agent = await ctx.db.query("agents").withIndex("by_user", q => q.eq("userId", args.userId)).unique();
    if (!agent) throw new ConvexError("Save your business details before uploading a logo.");
    await ctx.db.patch(agent._id, { logoStorageId: args.storageId, updatedAt: Date.now() });
    return null;
  },
});

export const getMineUrl = query({
  args: {}, returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const agent = await ctx.db.query("agents").withIndex("by_user", q => q.eq("userId", userId)).unique();
    return agent?.logoStorageId ? await ctx.storage.getUrl(agent.logoStorageId) : null;
  },
});
