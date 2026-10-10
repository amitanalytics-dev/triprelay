import { ConvexError, v, type Infer } from "convex/values";
import { internalQuery, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { foundationStep } from "./schema";

const IST_OFFSET_MS = 330 * 60_000;
const SUMMARY_LIMIT = 9_999;

/** India calendar day; timestamps themselves remain Unix milliseconds. */
function indiaDay(occurredAt: number) {
  return new Date(occurredAt + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Called only inside a successfully authorised mutation's transaction.
 * Email is consulted in memory solely to exclude disposable test accounts.
 * No names, contacts, user IDs or photos enter the metric row.
 */
export async function recordMetric(
  ctx: MutationCtx,
  userId: Id<"users">,
  step: Infer<typeof foundationStep>,
) {
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError("Please sign in again before saving.");
  const email = user.email?.trim().toLowerCase();
  // Missing identity evidence is excluded too; it must not inflate pilot counts.
  const isTest = !email || email.endsWith(".invalid");
  const occurredAt = Date.now();
  await ctx.db.insert("foundationEvents", { step, occurredAt, day: indiaDay(occurredAt), isTest });
}

export const dailySummary = internalQuery({
  args: { day: v.string() },
  returns: v.object({
    day: v.string(),
    timeZone: v.literal("Asia/Kolkata"),
    counts: v.object({ profile_saved: v.number(), brief_saved: v.number(), brief_revised: v.number() }),
    eventCount: v.number(),
    countBasis: v.literal("events_not_distinct_users"),
    limit: v.number(),
    truncated: v.boolean(),
    excludesTestAccounts: v.literal(true),
  }),
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.day)) throw new ConvexError("Use a valid YYYY-MM-DD day.");
    const parsed = new Date(`${args.day}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== args.day) {
      throw new ConvexError("Use a valid calendar day.");
    }
    const today = indiaDay(Date.now());
    if (args.day > today) throw new ConvexError("Choose today or an earlier day.");
    const rows = await ctx.db.query("foundationEvents")
      .withIndex("by_day_test_time", (q) => q.eq("day", args.day).eq("isTest", false))
      .order("asc").take(SUMMARY_LIMIT + 1);
    const counts = { profile_saved: 0, brief_saved: 0, brief_revised: 0 };
    const included = rows.slice(0, SUMMARY_LIMIT);
    for (const row of included) counts[row.step] += 1;
    return { day: args.day, timeZone: "Asia/Kolkata" as const, counts,
      eventCount: included.length, countBasis: "events_not_distinct_users" as const,
      limit: SUMMARY_LIMIT, truncated: rows.length > SUMMARY_LIMIT, excludesTestAccounts: true as const };
  },
});
