// BookLeaf royalty policy, encoded as plain functions. These facts are computed in code and handed to
// the AI as context. LLMs are unreliable at date arithmetic, so the model is never asked to work out
// a payout date itself.

export const PAYOUT_THRESHOLD_INR = 1000;
const PAYOUT_WINDOW_DAYS = 45;

const toISODate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Royalties are calculated per calendar quarter and paid within 45 days of the quarter ending.
 * Returns the date the next payout is due by, plus the most recent quarter whose payout deadline has passed.
 */
export function payoutSchedule(today: Date = new Date()) {
  const todayISO = toISODate(today);
  const year = today.getUTCFullYear();
  // Quarter ends and their payout deadlines from two years back to next year.
  // Day 0 of a month is the last day of the previous month, so (month 3, day 0) is 31 March.
  const quarters: { end: string; deadline: string }[] = [];
  for (let y = year - 2; y <= year + 1; y++) {
    for (const nextMonth of [3, 6, 9, 12]) {
      const end = new Date(Date.UTC(y, nextMonth, 0));
      quarters.push({ end: toISODate(end), deadline: toISODate(new Date(end.getTime() + PAYOUT_WINDOW_DAYS * 86_400_000)) });
    }
  }
  const next = quarters.find((q) => q.deadline >= todayISO)!;
  const lastPassed = quarters.filter((q) => q.deadline < todayISO).at(-1)!;
  return { nextPayoutBy: next.deadline, lastPassedDeadline: lastPassed.deadline, lastPassedQuarterEnd: lastPassed.end };
}

interface RoyaltyBook {
  royaltyPending: number;
  lastRoyaltyPayoutDate: string | null;
}

/** Author-level payout status: the ₹1,000 threshold applies to the author's accumulated total, not per book. */
export function royaltySummary(books: RoyaltyBook[], today: Date = new Date()) {
  const totalPending = books.reduce((sum, b) => sum + b.royaltyPending, 0);
  const meetsThreshold = totalPending >= PAYOUT_THRESHOLD_INR;
  const { nextPayoutBy, lastPassedDeadline, lastPassedQuarterEnd } = payoutSchedule(today);

  const payoutDates = books.map((b) => b.lastRoyaltyPayoutDate).filter((d): d is string => Boolean(d)).sort();
  const lastPayoutDate = payoutDates.at(-1) ?? null;

  // The payout for the last closed quarter should have landed between that quarter's end and its
  // deadline. If the author has an eligible balance and nothing was paid in or after that window,
  // flag it. This is a signal for staff to check, not proof: pending can include current-quarter sales.
  const possiblyOverdue = meetsThreshold && (lastPayoutDate === null || lastPayoutDate <= lastPassedQuarterEnd);

  return { totalPending, meetsThreshold, threshold: PAYOUT_THRESHOLD_INR, nextPayoutBy, lastPayoutDate, lastPassedDeadline, possiblyOverdue };
}

export type RoyaltySummary = ReturnType<typeof royaltySummary>;
