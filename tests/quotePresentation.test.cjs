const test = require('node:test');
const assert = require('node:assert/strict');
const { money, checkedTime } = require('../lib/quotePresentation.mjs');
test('invalid source price and time stay readable instead of crashing review', () => {
  for (const minor of [NaN, Infinity, -1, 1.5]) assert.equal(money(minor), 'Unverified price');
  for (const currency of ['', null, 'inr']) assert.equal(money(100, currency), 'Unverified price');
  for (const value of [NaN, Infinity, -1, 8640000000000001]) assert.equal(checkedTime(value), 'Check time missing');
});
test('paise are formatted as rupees and supplier check times use India time', () => {
  assert.equal(money(12100), '₹121.00');
  assert.match(checkedTime(Date.UTC(2026, 9, 10, 0, 0)), /5:30.*IST/);
});
