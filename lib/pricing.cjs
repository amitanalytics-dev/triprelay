'use strict';

// Money is expressed in integer minor units (for example, paise).
// Percentages use basis points: 100 basis points = 1%.
// Each layer rounds its markup half up to the nearest minor unit.
const DENOMINATOR = 10000n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function validateInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function applyMarkup(amount, markupBps) {
  const margin = (BigInt(amount) * BigInt(markupBps) + DENOMINATOR / 2n) / DENOMINATOR;
  const sellingPrice = BigInt(amount) + margin;
  if (sellingPrice > MAX_SAFE) throw new RangeError('Calculated price exceeds the safe integer range');
  return { margin: Number(margin), sellingPrice: Number(sellingPrice) };
}

function calculatePricing({ supplierCostMinor, operatorMarkupBps = 1000, agentMarkupBps = 1000 } = {}) {
  validateInteger(supplierCostMinor, 'supplierCostMinor');
  validateInteger(operatorMarkupBps, 'operatorMarkupBps');
  validateInteger(agentMarkupBps, 'agentMarkupBps');
  const operator = applyMarkup(supplierCostMinor, operatorMarkupBps);
  const agent = applyMarkup(operator.sellingPrice, agentMarkupBps);
  return {
    supplierCostMinor,
    operatorMarkupBps,
    operatorMarginMinor: operator.margin,
    operatorSellingPriceMinor: operator.sellingPrice,
    agentMarkupBps,
    agentMarginMinor: agent.margin,
    finalClientPriceMinor: agent.sellingPrice,
  };
}

// Explicit projection: never send the private calculation directly to an agent.
function toAgentQuote(privatePricing) {
  return {
    operatorSellingPriceMinor: privatePricing.operatorSellingPriceMinor,
    agentMarkupBps: privatePricing.agentMarkupBps,
    agentMarginMinor: privatePricing.agentMarginMinor,
    finalClientPriceMinor: privatePricing.finalClientPriceMinor,
  };
}

module.exports = { calculatePricing, toAgentQuote };
