import { describe, expect, it } from "vitest";
import { nextPayoutDate, royaltySummary } from "../src/lib/royalty.js";

// Payout dates are computed in code (not by the AI), so they get exact tests.
const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("nextPayoutDate", () => {
  it("is 45 days after the quarter ends", () => {
    expect(nextPayoutDate(d("2026-10-28"))).toBe("2026-11-14"); // Q3 ends 30 Sep
    expect(nextPayoutDate(d("2026-11-20"))).toBe("2027-02-14"); // Q4 ends 31 Dec
    expect(nextPayoutDate(d("2026-04-10"))).toBe("2026-05-15"); // Q1 ends 31 Mar
  });
});

describe("royaltySummary", () => {
  it("applies the ₹1,000 minimum to the author's total, not per book", () => {
    const s = royaltySummary([
      { royaltyPending: 600, lastRoyaltyPayoutDate: null },
      { royaltyPending: 500, lastRoyaltyPayoutDate: "2025-10-15" },
    ]);
    expect(s).toMatchObject({ totalPending: 1100, meetsThreshold: true, lastPayoutDate: "2025-10-15" });
    expect(royaltySummary([{ royaltyPending: 850, lastRoyaltyPayoutDate: null }]).meetsThreshold).toBe(false);
  });
});
