// BookLeaf's royalty policy as plain functions. These numbers are worked out in code and given to
// the AI as facts, because LLMs are unreliable at date arithmetic.

export const PAYOUT_THRESHOLD_INR = 1000;
const PAYOUT_WINDOW_DAYS = 45;

/**
 * Royalties are calculated per quarter and paid within 45 days of the quarter ending.
 * Returns the date the next payout is due by (YYYY-MM-DD). Assumes calendar quarters.
 */
export function nextPayoutDate(today: Date = new Date()): string {
  const todayISO = today.toISOString().slice(0, 10);
  // Deadlines for every quarter of last year, this year and next year.
  // Day 0 of a month is the last day of the previous month, so (month 3, day 0) is 31 March.
  const deadlines: string[] = [];
  for (let y = today.getUTCFullYear() - 1; y <= today.getUTCFullYear() + 1; y++) {
    for (const month of [3, 6, 9, 12]) {
      const quarterEnd = new Date(Date.UTC(y, month, 0));
      deadlines.push(new Date(quarterEnd.getTime() + PAYOUT_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10));
    }
  }
  return deadlines.find((d) => d >= todayISO)!;
}

/** The ₹1,000 minimum applies to the author's accumulated total across all their books. */
export function royaltySummary(books: { royaltyPending: number; lastRoyaltyPayoutDate: string | null }[], today?: Date) {
  const totalPending = books.reduce((sum, b) => sum + b.royaltyPending, 0);
  const lastPayoutDate =
    books
      .map((b) => b.lastRoyaltyPayoutDate)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null;
  return {
    totalPending,
    threshold: PAYOUT_THRESHOLD_INR,
    meetsThreshold: totalPending >= PAYOUT_THRESHOLD_INR,
    nextPayoutBy: nextPayoutDate(today),
    lastPayoutDate,
  };
}

export type RoyaltySummary = ReturnType<typeof royaltySummary>;
