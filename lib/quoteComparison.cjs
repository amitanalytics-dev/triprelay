'use strict';

// Internal, server-computed assessments only. This selects among complete,
// reviewed alternatives; it never authorizes release or creates source facts.
function compareReviewedChoices(optionIds, assessments, now) {
  const blocked = () => ({ complete: false, lowestOptionIds: [], finalClientPriceMinor: null, validUntil: null });
  if (!Number.isSafeInteger(now) || now < 0 || !Array.isArray(optionIds) || !optionIds.length || optionIds.length > 48 ||
    optionIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(optionIds).size !== optionIds.length ||
    !Array.isArray(assessments) || assessments.length !== optionIds.length) return blocked();
  const seen = new Set(); let markup;
  for (const row of assessments) {
    if (!row || !optionIds.includes(row.optionId) || seen.has(row.optionId) || row.ready !== true ||
      row.currency !== 'INR' || !Number.isSafeInteger(row.finalClientPriceMinor) || row.finalClientPriceMinor < 0 ||
      !Number.isSafeInteger(row.agentMarkupBps) || row.agentMarkupBps < 0 ||
      !Number.isSafeInteger(row.validUntil) || row.validUntil <= now) return blocked();
    seen.add(row.optionId);
    if (markup !== undefined && markup !== row.agentMarkupBps) return blocked();
    markup = row.agentMarkupBps;
  }
  const minimum = Math.min(...assessments.map(row => row.finalClientPriceMinor));
  return { complete: true, lowestOptionIds: optionIds.filter(id =>
    assessments.find(row => row.optionId === id).finalClientPriceMinor === minimum),
    finalClientPriceMinor: minimum, validUntil: Math.min(...assessments.map(row => row.validUntil)) };
}
module.exports = { compareReviewedChoices };
