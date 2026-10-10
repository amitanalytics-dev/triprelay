const test = require('node:test');
const assert = require('node:assert/strict');
const { message } = require('../src/errorMessage.ts');

test('shows the stale-edit recovery message from ConvexError data instead of Server Error', async () => {
  const { ConvexError } = await import('convex/values');
  const recovery = 'This enquiry changed in another window. Reopen it before saving your changes.';
  const error = new ConvexError(recovery);
  error.message = '[CONVEX M(enquiries:updateBrief)] Server Error\nUncaught ConvexError';
  assert.match(error.message, /Server Error/);
  assert.equal(message(error), recovery);
});

test('keeps an ordinary local validation error readable', () => {
  assert.equal(message(new Error('The return date must be after the departure date.')),
    'The return date must be after the departure date.');
});

test('unknown errors give the existing retry instruction', () => {
  for (const error of [undefined, null, 'unexpected', { message: 'untrusted value' }]) {
    assert.equal(message(error), 'Something went wrong. Please try again.');
  }
});

test('retains generic Convex error cleanup when data is not a display string', async () => {
  const { ConvexError } = await import('convex/values');
  const error = new ConvexError({ code: 'FAILED' });
  error.message = '[CONVEX M(enquiries:create)] Request failed\nTechnical details';
  assert.equal(message(error), 'Request failed');
});
