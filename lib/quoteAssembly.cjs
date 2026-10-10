'use strict';
const { calculatePricing, toAgentQuote } = require('./pricing.cjs');
const { checkQuoteReadiness } = require('./quoteReadiness.cjs');

const descriptions = Object.freeze({ hotel: 'Hotel stay', flight: 'Flights',
  transfer: 'Transfers', experience: 'Experiences', insurance: 'Travel insurance' });

// Call only with an owner-scoped, immutable, server-loaded quote revision.
// Review authorization, scope and supplier facts must never come from client input.
function assembleAgentQuote(candidate, now) {
  if (!checkQuoteReadiness(candidate, now).ready) throw new Error('Quote is not ready for release.');
  if (!Number.isSafeInteger(candidate.agentMarkupBps) || candidate.agentMarkupBps < 0) {
    throw new Error('Use the saved or explicitly selected agent markup.');
  }
  const items = candidate.components.map(component => {
    if (!Object.hasOwn(descriptions, component.kind)) throw new Error('Unsupported V1 quote component.');
    if (component.currency !== 'INR') throw new Error('Only verified INR prices can be assembled until currency conversion is implemented.');
    const pricing = calculatePricing({ supplierCostMinor: component.supplierCostMinor,
      agentMarkupBps: candidate.agentMarkupBps });
    if (component.minimumClientPriceMinor !== undefined && pricing.finalClientPriceMinor < component.minimumClientPriceMinor) {
      throw new Error('The final client price is below the permitted minimum selling price.');
    }
    return { description: descriptions[component.kind], ...toAgentQuote(pricing) };
  });
  const total = key => {
    const amount = items.reduce((sum, item) => sum + BigInt(item[key]), 0n);
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Quote total exceeds the safe integer range.');
    return Number(amount);
  };
  // Only generic component descriptions and agent-visible selling prices leave
  // this function. Never spread supplier objects or private quote metadata.
  return { currency: 'INR', items, agentMarkupBps: candidate.agentMarkupBps,
    operatorSellingPriceMinor: total('operatorSellingPriceMinor'),
    agentMarginMinor: total('agentMarginMinor'), finalClientPriceMinor: total('finalClientPriceMinor'),
    pricesCheckedAt: Math.min(...candidate.components.map(component => component.checkedAt)),
    validUntil: Math.min(...candidate.components.map(component => component.validUntil),
      candidate.comparisonValidUntil ?? Number.MAX_SAFE_INTEGER) };
}

module.exports = { assembleAgentQuote };
