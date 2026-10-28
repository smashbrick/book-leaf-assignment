import { describe, expect, it } from "vitest";
import { payoutSchedule, royaltySummary } from "../src/lib/royalty.js";

// Payout dates are computed in code (not by the LLM), so they get exact tests.

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("payoutSchedule", () => {
  it("is 45 days after the previous quarter ends while that window is still open", () => {
    // Q3 ends 30 Sep → paid by 14 Nov
    expect(payoutSchedule(d("2026-10-28"))).toEqual({ nextPayoutBy: "2026-11-14", lastPassedDeadline: "2026-08-14", lastPassedQuarterEnd: "2026-06-30" });
  });

  it("rolls to the current quarter once the previous window has closed", () => {
    // Q4 ends 31 Dec → paid by 14 Feb
    expect(payoutSchedule(d("2026-11-20")).nextPayoutBy).toBe("2027-02-14");
  });

  it("handles the year boundary", () => {
    expect(payoutSchedule(d("2027-01-05"))).toEqual({ nextPayoutBy: "2027-02-14", lastPassedDeadline: "2026-11-14", lastPassedQuarterEnd: "2026-09-30" });
  });
});

describe("royaltySummary", () => {
  const book = (royaltyPending: number, lastRoyaltyPayoutDate: string | null) => ({ royaltyPending, lastRoyaltyPayoutDate });

  it("applies the ₹1,000 threshold to the author's total, not per book", () => {
    const s = royaltySummary([book(600, null), book(500, null)], d("2026-10-28"));
    expect(s.totalPending).toBe(1100);
    expect(s.meetsThreshold).toBe(true);
  });

  it("never flags a balance under the threshold as overdue (it rolls over)", () => {
    // BK016 in the dataset: ₹850 pending, never paid
    const s = royaltySummary([book(850, null)], d("2026-10-28"));
    expect(s.meetsThreshold).toBe(false);
    expect(s.possiblyOverdue).toBe(false);
  });

  it("flags an eligible balance with no payout since the last deadline", () => {
    expect(royaltySummary([book(2546, null)], d("2026-10-28")).possiblyOverdue).toBe(true);
    // Paid on 10 Aug for Q2 (deadline 14 Aug): on time
    expect(royaltySummary([book(2546, "2026-08-10")], d("2026-10-28")).possiblyOverdue).toBe(false);
    // Last paid in May: the Q2 payout window (1 Jul to 14 Aug) passed with nothing paid
    expect(royaltySummary([book(2546, "2026-05-10")], d("2026-10-28")).possiblyOverdue).toBe(true);
  });
});
