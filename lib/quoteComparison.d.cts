export function compareReviewedChoices(optionIds: string[], assessments: unknown[], now: number): {
  complete: boolean; lowestOptionIds: string[]; finalClientPriceMinor: number | null; validUntil: number | null;
};
