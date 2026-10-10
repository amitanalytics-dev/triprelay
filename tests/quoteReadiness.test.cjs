const test = require('node:test');
const assert = require('node:assert/strict');
const { checkQuoteReadiness } = require('../lib/quoteReadiness.cjs');

const now = 1800000000000;
function candidate() {
  return {
    versionId: 'quote-v1', briefRevision: 2, currentBriefRevision: 2,
    requiredComponentIds: ['hotel', 'flight'], unresolvedFacts: [],
    components: ['hotel', 'flight'].map(id => ({ id, mode: 'live', available: true,
      checkedAt: now - 1000, validUntil: now + 1000, currency: 'INR',
      supplierCostMinor: 10000, compulsoryFeesConfirmed: true, termsConfirmed: true })),
    review: { status: 'approved', versionId: 'quote-v1', briefRevision: 2,
      reviewedAt: now - 500, authorized: true },
  };
}
test('complete fresh live components with matching authorized review pass', () => {
  assert.deepEqual(checkQuoteReadiness(candidate(), now), { ready: true, reasons: [] });
});
test('missing package component blocks release', () => {
  const q = candidate(); q.components.pop();
  assert.equal(checkQuoteReadiness(q, now).ready, false);
});
test('mock, unavailable, unchecked fees and unchecked terms each block release', () => {
  for (const change of [{ mode: 'mock' }, { available: false },
    { compulsoryFeesConfirmed: false }, { termsConfirmed: false }]) {
    const q = candidate(); Object.assign(q.components[0], change);
    assert.equal(checkQuoteReadiness(q, now).ready, false);
  }
});
test('expired, future and missing supplier freshness evidence block release', () => {
  for (const change of [{ validUntil: now }, { checkedAt: now + 1 },
    { checkedAt: undefined }, { validUntil: undefined }, { validUntil: NaN }]) {
    const q = candidate(); Object.assign(q.components[0], change);
    assert.equal(checkQuoteReadiness(q, now).ready, false);
  }
});
test('changed brief and unresolved facts block release', () => {
  const q = candidate(); q.currentBriefRevision = 3;
  assert.equal(checkQuoteReadiness(q, now).ready, false);
  const unresolved = candidate(); unresolved.unresolvedFacts = ['Transfer price missing'];
  assert.equal(checkQuoteReadiness(unresolved, now).ready, false);
});
test('missing, unauthorized, wrong-version and old review block release', () => {
  for (const change of [null, { authorized: false }, { status: 'pending' },
    { versionId: 'quote-v0' }, { briefRevision: 1 }, { reviewedAt: now - 2000 }]) {
    const q = candidate(); q.review = change === null ? null : { ...q.review, ...change };
    assert.equal(checkQuoteReadiness(q, now).ready, false);
  }
});
test('mixed currencies and malformed money never pass as a quote', () => {
  for (const change of [{ currency: 'USD' }, { currency: '' },
    { supplierCostMinor: -1 }, { supplierCostMinor: 1.5 },
    { supplierCostMinor: Number.MAX_SAFE_INTEGER + 1 }]) {
    const q = candidate(); Object.assign(q.components[0], change);
    assert.equal(checkQuoteReadiness(q, now).ready, false);
  }
});
test('empty requirements, duplicate and unexpected components block release', () => {
  const empty = candidate(); empty.requiredComponentIds = [];
  assert.equal(checkQuoteReadiness(empty, now).ready, false);
  const duplicate = candidate(); duplicate.components.push({ ...duplicate.components[0] });
  assert.equal(checkQuoteReadiness(duplicate, now).ready, false);
  const unexpected = candidate(); unexpected.components.push({ ...unexpected.components[0], id: 'visa' });
  assert.equal(checkQuoteReadiness(unexpected, now).ready, false);
});
test('malformed input fails closed without private supplier facts in reasons', () => {
  for (const q of [undefined, null, {}, { components: null }, []]) {
    assert.equal(checkQuoteReadiness(q, now).ready, false);
  }
  const q = candidate(); q.components[0].supplierName = 'PRIVATE'; q.components[0].mode = 'mock';
  assert.equal(JSON.stringify(checkQuoteReadiness(q, now)).includes('PRIVATE'), false);
});
