const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePricing, toAgentQuote } = require('../lib/pricing.cjs');

test('confirmed defaults apply both 10% margins in sequence', () => {
  assert.equal(calculatePricing({ supplierCostMinor: 1000000 }).finalClientPriceMinor, 1210000);
});

test('defaults to 10% operator markup then applies agent markup to selling price', () => {
  const result = calculatePricing({ supplierCostMinor: 10000, agentMarkupBps: 2000 });
  assert.deepEqual(result, { supplierCostMinor: 10000, operatorMarkupBps: 1000, operatorMarginMinor: 1000, operatorSellingPriceMinor: 11000, agentMarkupBps: 2000, agentMarginMinor: 2200, finalClientPriceMinor: 13200 });
});

test('rounds half up separately at each pricing layer', () => {
  const result = calculatePricing({ supplierCostMinor: 5, operatorMarkupBps: 1000, agentMarkupBps: 2500 });
  assert.equal(result.operatorSellingPriceMinor, 6);
  assert.equal(result.finalClientPriceMinor, 8);
});

test('zero cost and zero markups remain zero', () => {
  assert.equal(calculatePricing({ supplierCostMinor: 0, operatorMarkupBps: 0, agentMarkupBps: 0 }).finalClientPriceMinor, 0);
});

test('percentages above 100% are supported without arbitrary business caps', () => {
  assert.equal(calculatePricing({ supplierCostMinor: 100, operatorMarkupBps: 20000, agentMarkupBps: 10000 }).finalClientPriceMinor, 600);
});

test('rejects missing, negative, fractional, unsafe and nonnumeric inputs', () => {
  for (const value of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '100', null]) {
    assert.throws(() => calculatePricing({ supplierCostMinor: value }), /safe integer/);
  }
  for (const key of ['operatorMarkupBps', 'agentMarkupBps']) {
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '10', null]) {
      assert.throws(() => calculatePricing({ supplierCostMinor: 100, [key]: value }), /safe integer/);
    }
  }
});

test('rejects monetary results exceeding safe integer range', () => {
  assert.throws(() => calculatePricing({ supplierCostMinor: Number.MAX_SAFE_INTEGER }), /exceeds/);
  assert.throws(() => calculatePricing({ supplierCostMinor: Number.MAX_SAFE_INTEGER, operatorMarkupBps: 0, agentMarkupBps: 1 }), /exceeds/);
});

test('uses exact arithmetic for large safe amounts', () => {
  const amount = 8000000000000001;
  const result = calculatePricing({ supplierCostMinor: amount, operatorMarkupBps: 1, agentMarkupBps: 0 });
  assert.equal(result.operatorMarginMinor, 800000000000);
  assert.equal(result.operatorSellingPriceMinor, 8000800000000001);
});

test('agent projection explicitly allowlists fields and never leaks supplier information', () => {
  const privateResult = { ...calculatePricing({ supplierCostMinor: 10000, agentMarkupBps: 2000 }), supplierName: 'Private supplier', secret: 'private' };
  const quote = toAgentQuote(privateResult);
  assert.deepEqual(quote, { operatorSellingPriceMinor: 11000, agentMarkupBps: 2000, agentMarginMinor: 2200, finalClientPriceMinor: 13200 });
  for (const key of ['supplierCostMinor', 'operatorMarginMinor', 'operatorMarkupBps', 'supplierName', 'secret']) assert.equal(Object.hasOwn(quote, key), false);
});
