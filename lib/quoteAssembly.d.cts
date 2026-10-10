export type AgentPrices = {
  currency: "INR"; agentMarkupBps: number;
  items: { description: string; operatorSellingPriceMinor: number; agentMarkupBps: number; agentMarginMinor: number; finalClientPriceMinor: number }[];
  operatorSellingPriceMinor: number; agentMarginMinor: number; finalClientPriceMinor: number;
  pricesCheckedAt: number; validUntil: number;
};
export function assembleAgentQuote(candidate: unknown, now: number): AgentPrices;
