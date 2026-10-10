import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { profileFields } from "./schema";
import { recordMetric } from "./metrics";

const profile = v.object({
  _id: v.id("agents"),
  _creationTime: v.number(),
  ...profileFields,
});
const profileInput = {
  businessName: v.string(),
  contactName: v.string(),
  contactPhone: v.string(),
  contactEmail: v.string(),
  defaultMarkupPercent: v.number(),
  logoStorageId: v.optional(v.id("_storage")),
};
function text(value: string, name: string, maximum: number) {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maximum) {
    throw new ConvexError(
      `${name} is required and must be at most ${maximum} characters.`,
    );
  }
  return cleaned;
}

export const getMine = query({
  args: {},
  returns: v.union(profile, v.null()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("agents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const saveProfile = mutation({
  args: profileInput,
  returns: v.object({ agentId: v.id("agents") }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId)
      throw new ConvexError("Please sign in to save your business details.");
    if (
      !Number.isFinite(args.defaultMarkupPercent) ||
      args.defaultMarkupPercent < 0 ||
      args.defaultMarkupPercent > 100
    ) {
      throw new ConvexError("Your markup must be between 0% and 100%.");
    }
    const businessName = text(args.businessName, "Business name", 120);
    const contactName = text(args.contactName, "Contact name", 100);
    const contactPhone = text(args.contactPhone, "Phone number", 30);
    const contactEmail = text(args.contactEmail, "Email", 254).toLowerCase();
    if (
      !/^[+\d ()-]{7,30}$/.test(contactPhone) ||
      contactPhone.replace(/\D/g, "").length < 7
    ) {
      throw new ConvexError("Enter a valid contact phone number.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))
      throw new ConvexError("Enter a valid contact email.");
    const existing = await ctx.db
      .query("agents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    // Upload ownership is not established yet; arbitrary storage IDs cannot be attached.
    if (args.logoStorageId && args.logoStorageId !== existing?.logoStorageId) {
      throw new ConvexError("Logo uploads are not connected yet.");
    }
    const fields = {
      userId,
      businessName,
      contactName,
      contactPhone,
      contactEmail,
      defaultMarkupPercent: args.defaultMarkupPercent,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return { agentId: existing._id };
    }
    const agentId = await ctx.db.insert("agents", fields);
    await recordMetric(ctx, userId, "profile_saved");
    return { agentId };
  },
});
