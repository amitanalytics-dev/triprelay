import { ConvexError } from "convex/values";

export function message(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  return error instanceof Error
    ? error.message.replace(/^.*\[CONVEX[^\]]*\]\s*/, "").split("\n")[0]
    : "Something went wrong. Please try again.";
}
