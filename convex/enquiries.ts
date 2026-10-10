import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v, type Infer } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { enquiryFields, enquiryInputFields, enquiryRevisionFields, outcome } from "./schema";
import { recordMetric } from "./metrics";

const enquiry = v.object({
  _id: v.id("enquiries"),
  _creationTime: v.number(),
  ...enquiryFields,
});
async function ownAgent(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Please sign in to see your enquiries.");
  const agent = await ctx.db
    .query("agents")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!agent)
    throw new ConvexError(
      "Save your business details before creating an enquiry.",
    );
  return agent;
}
function checkedText(
  value: string,
  name: string,
  maximum: number,
  required = false,
) {
  const cleaned = value.trim();
  if ((required && !cleaned) || cleaned.length > maximum) {
    throw new ConvexError(
      `${name} ${required ? "is required and " : ""}must be at most ${maximum} characters.`,
    );
  }
  return cleaned;
}
function checkedDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new ConvexError("Use a valid travel date.");
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new ConvexError("Use a valid travel date.");
  return date.getTime();
}

const enquiryInput = v.object(enquiryInputFields);
type EnquiryInput = Infer<typeof enquiryInput>;

function validateBrief(args: EnquiryInput) {
  const start = checkedDate(args.startDate),
    end = checkedDate(args.endDate);
  const today = Date.now() - (Date.now() % 86_400_000);
  if (
    start < today ||
    end <= start ||
    end - start > 90 * 86_400_000 ||
    start > today + 730 * 86_400_000
  ) {
    throw new ConvexError(
      "Choose upcoming dates, with a trip of 1–90 nights within the next two years.",
    );
  }
  if (
    !Number.isInteger(args.adults) ||
    args.adults < 1 ||
    args.adults > 30 ||
    !Number.isInteger(args.children) ||
    args.children < 0 ||
    args.children > 20 ||
    args.adults + args.children > 30
  ) {
    throw new ConvexError(
      "Enter 1–30 travellers, including at least one adult.",
    );
  }
  if (
    args.childAges.length !== args.children ||
    args.childAges.some(
      (age) => !Number.isInteger(age) || age < 0 || age > 17,
    )
  ) {
    throw new ConvexError("Enter one age between 0 and 17 for each child.");
  }
  if (
    !Number.isFinite(args.budgetInr) ||
    args.budgetInr <= 0 ||
    args.budgetInr > 100_000_000
  ) {
    throw new ConvexError(
      "Enter a total trip budget greater than zero and at most ₹10 crore.",
    );
  }
  return {
    ...args,
    clientName: checkedText(args.clientName, "Client name", 100, true),
    clientContact: checkedText(
      args.clientContact,
      "Client contact",
      254,
      true,
    ),
    departureCity: checkedText(
      args.departureCity,
      "Departure city",
      100,
      true,
    ),
    interests: checkedText(args.interests, "Interests", 2000),
    foodPreferences: checkedText(
      args.foodPreferences,
      "Food preferences",
      1000,
    ),
    specialRequirements: checkedText(
      args.specialRequirements,
      "Special requirements",
      3000,
    ),
    ...(args.rawEnquiry !== undefined
      ? { rawEnquiry: checkedText(args.rawEnquiry, "Original enquiry", 6000) }
      : {}),
  };
}

export const create = mutation({
  args: enquiryInputFields,
  returns: v.object({
    enquiryId: v.id("enquiries"),
    status: v.literal("awaiting_supplier"),
  }),
  handler: async (ctx, args) => {
    const agent = await ownAgent(ctx);
    if (args.destination !== "Vietnam") {
      throw new ConvexError("The first release accepts new Vietnam enquiries only.");
    }
    const clean = validateBrief(args);
    const now = Date.now();
    const enquiryId = await ctx.db.insert("enquiries", {
      ...clean,
      agentId: agent._id,
      status: "awaiting_supplier",
      outcome: "pending",
      revisionNumber: 1,
      createdAt: now,
      updatedAt: now,
    });
    await recordMetric(ctx, agent.userId, "brief_saved");
    return { enquiryId, status: "awaiting_supplier" as const };
  },
});

export const listMine = query({
  args: {},
  returns: v.array(enquiry),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!agent) return [];
    return await ctx.db
      .query("enquiries")
      .withIndex("by_agent_created", (q) => q.eq("agentId", agent._id))
      .order("desc")
      .take(50);
  },
});

export const getMine = query({
  args: { enquiryId: v.id("enquiries") },
  returns: v.union(enquiry, v.null()),
  handler: async (ctx, args) => {
    const agent = await ownAgent(ctx);
    const record = await ctx.db.get(args.enquiryId);
    return record?.agentId === agent._id ? record : null;
  },
});

export const updateBrief = mutation({
  args: {
    enquiryId: v.id("enquiries"),
    expectedUpdatedAt: v.number(),
    ...enquiryInputFields,
  },
  returns: v.object({ enquiryId: v.id("enquiries"), revisionNumber: v.number() }),
  handler: async (ctx, args) => {
    const agent = await ownAgent(ctx);
    const { enquiryId, expectedUpdatedAt, ...input } = args;
    const record = await ctx.db.get(enquiryId);
    if (!record || record.agentId !== agent._id) throw new ConvexError("Enquiry not found.");
    if (!Number.isSafeInteger(expectedUpdatedAt) || expectedUpdatedAt !== record.updatedAt) {
      throw new ConvexError("This enquiry changed while you were editing. Reload its latest details before saving.");
    }
    if (input.destination !== record.destination) {
      throw new ConvexError("Keep this saved enquiry's original country. Create a new Vietnam enquiry for another trip.");
    }
    const clean = validateBrief(input);
    const currentRevision = record.revisionNumber ?? 1;
    if (!Number.isSafeInteger(currentRevision) || currentRevision < 1) {
      throw new ConvexError("This enquiry's saved revision could not be read.");
    }
    const now = Math.max(Date.now(), record.updatedAt + 1);
    const { _id: _enquiryId, _creationTime: _created, ...previous } = record;
    await ctx.db.insert("enquiryRevisions", {
      enquiryId, agentId: agent._id, revisionNumber: currentRevision, savedAt: now,
      snapshot: { ...previous, revisionNumber: currentRevision },
    });
    const revisionNumber = currentRevision + 1;
    await ctx.db.patch(enquiryId, {
      ...clean,
      // Omitted optional original text clears the prior value on a full replacement.
      rawEnquiry: clean.rawEnquiry,
      revisionNumber, updatedAt: now,
    });
    await recordMetric(ctx, agent.userId, "brief_revised");
    return { enquiryId, revisionNumber };
  },
});

export const listRevisions = query({
  args: { enquiryId: v.id("enquiries") },
  returns: v.array(v.object({ _id: v.id("enquiryRevisions"), _creationTime: v.number(), ...enquiryRevisionFields })),
  handler: async (ctx, args) => {
    const agent = await ownAgent(ctx);
    const record = await ctx.db.get(args.enquiryId);
    if (!record || record.agentId !== agent._id) throw new ConvexError("Enquiry not found.");
    return await ctx.db.query("enquiryRevisions")
      .withIndex("by_enquiry_created", (q) => q.eq("enquiryId", args.enquiryId))
      .order("desc").take(20);
  },
});

export const updateOutcome = mutation({
  args: { enquiryId: v.id("enquiries"), outcome },
  returns: v.object({ updated: v.literal(true) }),
  handler: async (ctx, args) => {
    const agent = await ownAgent(ctx);
    const record = await ctx.db.get(args.enquiryId);
    if (!record || record.agentId !== agent._id)
      throw new ConvexError("Enquiry not found.");
    await ctx.db.patch(record._id, {
      outcome: args.outcome,
      updatedAt: Math.max(Date.now(), record.updatedAt + 1),
    });
    return { updated: true as const };
  },
});
