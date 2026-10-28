// BookLeaf royalty policy, encoded as plain functions. These facts are computed in code and handed to
// the AI as context. LLMs are unreliable at date arithmetic, so the model is never asked to work out
// a payout date itself.

export const PAYOUT_THRESHOLD_INR = 1000;
const PAYOUT_WINDOW_DAYS = 45;

const toISODate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Royalties are calculated per calendar quarter and paid within 45 days of the quarter ending.
 * Returns the date the next payout is due by, and the most recent payout deadline that has passed.
 */
export function payoutSchedule(today: Date = new Date()) {
  const todayISO = toISODate(today);
  const year = today.getUTCFullYear();
  // Payout deadlines for every quarter from two years back to next year. Day 0 of a month is the
  // last day of the previous month, so month index 3 with day 0 is 31 March.
  const deadlines: string[] = [];
  for (let y = year - 2; y <= year + 1; y++) {
    for (const lastMonth of [3, 6, 9, 12]) {
      const quarterEnd = new Date(Date.UTC(y, lastMonth, 0));
      deadlines.push(toISODate(new Date(quarterEnd.getTime() + PAYOUT_WINDOW_DAYS * 86_400_000)));
    }
  }
  const nextPayoutBy = deadlines.find((d) => d >= todayISO)!;
  const lastPassedDeadline = deadlines.filter((d) => d < todayISO).at(-1)!;
  return { nextPayoutBy, lastPassedDeadline };
}

interface RoyaltyBook {
  royaltyPending: number;
  lastRoyaltyPayoutDate: string | null;
  publicationDate: string | null;
}

/** Author-level payout status: the ₹1,000 threshold applies to the author's accumulated total, not per book. */
export function royaltySummary(books: RoyaltyBook[], today: Date = new Date()) {
  const totalPending = books.reduce((sum, b) => sum + b.royaltyPending, 0);
  const meetsThreshold = totalPending >= PAYOUT_THRESHOLD_INR;
  const { nextPayoutBy, lastPassedDeadline } = payoutSchedule(today);

  const payoutDates = books.map((b) => b.lastRoyaltyPayoutDate).filter((d): d is string => Boolean(d)).sort();
  const lastPayoutDate = payoutDates.at(-1) ?? null;

  // A payout deadline passed while the author had an eligible balance and nothing was paid since.
  // This is a signal for staff to check, not proof. Pending can include sales from the current quarter.
  const possiblyOverdue = meetsThreshold && (lastPayoutDate === null || lastPayoutDate < lastPassedDeadline);

  return { totalPending, meetsThreshold, threshold: PAYOUT_THRESHOLD_INR, nextPayoutBy, lastPayoutDate, lastPassedDeadline, possiblyOverdue };
}

export type RoyaltySummary = ReturnType<typeof royaltySummary>;
