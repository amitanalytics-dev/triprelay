'use strict';

// Internal evidence only. `authorized` must be established by the server's
// reviewer identity check, never accepted from a browser request. Freshness
// deadlines must come from supplier facts or an explicitly approved policy.
function checkQuoteReadiness(candidate, now) {
  const reasons = new Set();
  const block = reason => reasons.add(reason);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const timestamp = value => Number.isSafeInteger(value) && value >= 0;
  const revision = value => Number.isSafeInteger(value) && value >= 1;
  const identifier = value => typeof value === 'string' && value.trim().length > 0;
  const result = () => ({ ready: reasons.size === 0, reasons: [...reasons] });
  if (!record(candidate) || !timestamp(now)) {
    block('Quote evidence is incomplete.'); return result();
  }
  if (!identifier(candidate.versionId) || !revision(candidate.briefRevision) ||
    !revision(candidate.currentBriefRevision) || candidate.briefRevision !== candidate.currentBriefRevision) {
    block('The quote must match the current trip brief.');
  }
  if (candidate.comparisonValidUntil !== undefined &&
    (!timestamp(candidate.comparisonValidUntil) || candidate.comparisonValidUntil <= now)) {
    block('Recheck expired or missing comparison prices and availability.');
  }
  const required = candidate.requiredComponentIds;
  const components = candidate.components;
  if (!Array.isArray(required) || required.length === 0 || !required.every(identifier) ||
    new Set(required).size !== required.length || !Array.isArray(components) || components.length === 0) {
    block('Confirm every required trip component.'); return result();
  }
  if (!Array.isArray(candidate.unresolvedFacts) || candidate.unresolvedFacts.length) {
    block('Resolve the missing or unverified trip facts.');
  }
  const seen = new Set();
  const currencies = new Set();
  let newestCheck = 0;
  for (const component of components) {
    if (!record(component) || !identifier(component.id)) {
      block('Trip component evidence is incomplete.'); continue;
    }
    if (seen.has(component.id) || !required.includes(component.id)) {
      block('Trip components must match the confirmed scope without duplicates.');
    }
    seen.add(component.id);
    if (component.mode !== 'live' || component.available !== true) {
      block('Every trip component needs verified live availability.');
    }
    if (!timestamp(component.checkedAt) || !timestamp(component.validUntil) ||
      component.checkedAt > now || component.validUntil <= now || component.validUntil <= component.checkedAt) {
      block('Recheck expired or missing supplier prices and availability.');
    } else newestCheck = Math.max(newestCheck, component.checkedAt);
    if (typeof component.currency !== 'string' || !/^[A-Z]{3}$/.test(component.currency) ||
      !Number.isSafeInteger(component.supplierCostMinor) || component.supplierCostMinor < 0) {
      block('Every component needs a valid price and currency.');
    } else currencies.add(component.currency);
    if (component.minimumClientPriceMinor !== undefined &&
      (!Number.isSafeInteger(component.minimumClientPriceMinor) || component.minimumClientPriceMinor < 0)) {
      block('Verify the permitted minimum selling price.');
    }
    if (component.compulsoryFeesConfirmed !== true) block('Confirm all compulsory fees.');
    if (component.termsConfirmed !== true) block('Confirm inclusions, exclusions and cancellation terms.');
  }
  if (required.some(id => !seen.has(id))) block('A required trip component is missing.');
  if (currencies.size !== 1) block('Resolve currency conversion before pricing the quote.');
  const review = candidate.review;
  if (!record(review) || review.authorized !== true || review.status !== 'approved' ||
    review.versionId !== candidate.versionId || review.briefRevision !== candidate.briefRevision ||
    !timestamp(review.reviewedAt) || review.reviewedAt > now || review.reviewedAt < newestCheck) {
    block('An authorized reviewer must approve this exact quote after its latest price check.');
  }
  return result();
}

module.exports = { checkQuoteReadiness };
