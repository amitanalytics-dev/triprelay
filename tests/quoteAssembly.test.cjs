const test = require('node:test');
const assert = require('node:assert/strict');
const { assembleAgentQuote } = require('../lib/quoteAssembly.cjs');
const now = 1800000000000;
test('known minimum selling price blocks lower quotes without silently changing margins',()=>{
  const q=quote();q.components[0].minimumClientPriceMinor=12101;
  assert.throws(()=>assembleAgentQuote(q,now),/minimum selling/);
  q.components[0].minimumClientPriceMinor=12100;
  const result=assembleAgentQuote(q,now);assert.equal(result.finalClientPriceMinor,12100);
  assert.equal(JSON.stringify(result).includes('minimumClientPriceMinor'),false);
  for(const invalid of [NaN,-1,1.5]){q.components[0].minimumClientPriceMinor=invalid;assert.throws(()=>assembleAgentQuote(q,now),/not ready/);}
});
function quote() {
  return { versionId: 'v1', briefRevision: 1, currentBriefRevision: 1,
    agentMarkupBps: 1000, requiredComponentIds: ['private-hotel'], unresolvedFacts: [],
    components: [{ id: 'private-hotel', kind: 'hotel', mode: 'live', available: true,
      checkedAt: now - 1000, validUntil: now + 1000, supplierCostMinor: 10000,
      supplierName: 'PRIVATE_SUPPLIER', secret: 'PRIVATE_SECRET', currency: 'INR',
      compulsoryFeesConfirmed: true, termsConfirmed: true }],
    review: { status: 'approved', versionId: 'v1', briefRevision: 1, reviewedAt: now,
      authorized: true } };
}
test('approved quote applies operator then saved agent markup and hides supplier facts', () => {
  const result = assembleAgentQuote(quote(), now);
  assert.equal(result.finalClientPriceMinor, 12100);
  assert.equal(result.operatorSellingPriceMinor, 11000);
  assert.equal(result.items[0].description, 'Hotel stay');
  for (const privateText of ['PRIVATE', 'private-hotel', 'supplierCostMinor', 'supplierName', 'secret']) {
    assert.equal(JSON.stringify(result).includes(privateText), false);
  }
});
test('expired or unapproved quote cannot produce an agent price artifact', () => {
  const q = quote(); q.review.status = 'pending';
  assert.throws(() => assembleAgentQuote(q, now), /not ready/);
  assert.throws(() => assembleAgentQuote(quote(), now + 1000), /not ready/);
});
test('each item uses precise rounding and displayed items sum to final total', () => {
  const q = quote(); q.components[0].supplierCostMinor = 5; q.agentMarkupBps = 2500;
  q.components.push({ ...q.components[0], id: 'private-flight', kind: 'flight' });
  q.requiredComponentIds.push('private-flight');
  const result = assembleAgentQuote(q, now);
  assert.equal(result.finalClientPriceMinor, 16);
  assert.equal(result.items.reduce((sum, item) => sum + item.finalClientPriceMinor, 0), 16);
});
test('visa and unknown component kinds cannot be quietly included in V1', () => {
  for (const kind of ['visa', 'booking', undefined]) {
    const q = quote(); q.components[0].kind = kind;
    assert.throws(() => assembleAgentQuote(q, now), /component/);
  }
});
test('missing saved markup, currency conversion and total overflow are rejected', () => {
  const missing = quote(); delete missing.agentMarkupBps;
  assert.throws(() => assembleAgentQuote(missing, now), /markup/);
  const usd = quote(); usd.components[0].currency = 'USD';
  assert.throws(() => assembleAgentQuote(usd, now), /INR/);
  const huge = quote(); huge.components[0].supplierCostMinor = Number.MAX_SAFE_INTEGER;
  assert.throws(() => assembleAgentQuote(huge, now), /safe integer/);
});
