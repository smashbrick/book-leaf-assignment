import type { TicketCategory } from "../modules/tickets/ticket.constants.js";

/**
 * The BookLeaf Knowledge Base from the assignment brief, split into sections so each AI call
 * gets only the policy that's relevant to the ticket's category (see sectionsFor()).
 * Wording is kept close to the source so drafts quote real policy, not paraphrase.
 */
export const KB = {
  companyOverview: `## Company Overview
- BookLeaf Publishing is a self-publishing company operating in India and the US.
- Publishing packages: Standard Free (no upfront cost) and Bestseller Breakthrough (premium, paid package with marketing and distribution add-ons).
- BookLeaf handles cover design, typesetting, ISBN assignment, printing, distribution, and royalty management for authors.
- In-house printing facility and warehouse are in Delhi. Print partners include Repro India and Epitome Books.`,

  royalty: `## Royalty Policy
- 80/20 royalty split: 80% of the net profit per book goes to the author, 20% to BookLeaf.
- Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart), and shipping charges.
- Royalties are calculated quarterly and paid within 45 days of the quarter ending.
- Minimum payout threshold: ₹1,000. If accumulated royalties are below this, they roll over to the next quarter.
- Payouts are made via bank transfer to the account linked in the author's dashboard.
- Authors can view a detailed royalty breakdown in their dashboard, showing sales figures per platform.`,

  isbn: `## ISBN Policy
- Every book published through BookLeaf receives a unique ISBN assigned by BookLeaf.
- ISBNs are registered under BookLeaf's publisher imprint. An author who wants an ISBN under their own imprint must obtain it independently.
- An ISBN error (duplicate, wrong book linked) is treated as a high-priority issue and escalated to the production team.
- Metadata updates (e.g. book description) can be submitted through the dashboard or by emailing the BookLeaf team; changes typically reflect on platforms within 3–5 business days.`,

  printing: `## Printing & Quality
- In-house printing handles most orders. Overflow or specific format requirements go to Repro India or Epitome Books.
- Standard print turnaround: 5–7 business days from order confirmation.
- For quality issues (misprints, binding defects, color inconsistency), BookLeaf arranges a free reprint after verification. The author may need to share photos of the defective copy.`,

  distribution: `## Distribution & Availability
- Books are listed on Amazon India, Flipkart, Amazon US, Amazon UK, and the BookLeaf Store.
- New listings typically go live within 7–10 business days after publication is complete.
- A book showing as unavailable on a platform usually indicates a stock sync issue. BookLeaf's team can trigger a re-sync within 24–48 hours.`,

  production: `## Production Stages
- Stages: Manuscript Received → Editing (if opted) → Cover Design → Typesetting → Proofreading → ISBN Assignment → Printing → Distribution Setup → Published & Live.
- Authors are updated at each stage via email. Delays typically happen at Cover Design (waiting for author approval) and Proofreading (revision rounds).`,
} as const;

export const TONE_GUIDELINES = `## Communication Tone Guidelines
- Always empathetic and professional. Authors are partners, not customers to be managed.
- Acknowledge the author's concern before jumping to solutions.
- Be specific: include actual numbers, dates, and statuses wherever possible rather than vague reassurances.
- If something is BookLeaf's fault (delayed royalties, ISBN error), own it directly. No corporate deflection.
- If the issue requires escalation or investigation, give a clear timeline ("Our team will look into this and get back to you within 48 hours") rather than open-ended promises.
- Always end with a clear next step for the author and/or the BookLeaf team.`;

/** The brief's "Sample Query → Response" table, used as per-category guidance for drafts. */
export const RESPONSE_EXAMPLES: Record<TicketCategory, { query: string; guidance: string }[]> = {
  royalty_payments: [
    {
      query: "I published my book 4 months ago and still haven't received any royalty. What's going on?",
      guidance:
        "Acknowledge the frustration. Explain the quarterly royalty cycle and 45-day payout window. Check if their bank details are linked. Provide the specific next payout date. If the payment is genuinely overdue, escalate with a 48-hour resolution timeline.",
    },
    {
      query: "My royalty amount seems too low. I sold 200 copies but only received ₹3,000.",
      guidance:
        "Explain the net profit calculation: MRP minus printing, platform commission, and shipping. Offer to share a detailed line-by-line royalty breakdown. Don't be defensive. Offer transparency.",
    },
  ],
  isbn_metadata: [
    {
      query: "My book is showing a different ISBN on Amazon than what's on the physical copy.",
      guidance:
        "Treat as high priority. Acknowledge this is a serious data issue. Confirm you are escalating to the production team immediately. Provide a 48-hour resolution timeline.",
    },
  ],
  printing_quality: [
    {
      query: "I received my author copies and the print quality is terrible. The images are blurry and pages are misaligned.",
      guidance:
        "Apologise sincerely. Ask the author to share photos of the defective copies. Confirm that BookLeaf will arrange a free reprint once verified. Provide a timeline of 5–7 business days for the reprint.",
    },
  ],
  distribution_availability: [
    {
      query: "My book is published but it's showing as \"Currently Unavailable\" on Amazon.",
      guidance:
        "Explain that this is typically a stock sync issue. Confirm you're triggering a re-sync with the distribution team. Set expectation: 24–48 hours for it to go live again.",
    },
  ],
  book_status_production: [
    {
      query: "It's been 3 weeks and my book is still in typesetting. When will it be done?",
      guidance:
        "Check the actual production status. If it's delayed, be honest about why (e.g., waiting on author approval for proofs). Provide a specific updated timeline. Don't blame the author even if the delay is on their side. Frame it collaboratively.",
    },
  ],
  general_inquiry: [
    {
      query: "Can I update the description of my book on Amazon after it's already live?",
      guidance:
        "Yes, metadata updates can be submitted through the dashboard or by emailing the BookLeaf team. Changes typically reflect on platforms within 3–5 business days.",
    },
  ],
};

/**
 * Which knowledge-base sections a draft needs for a given category. This is the main token
 * saving on drafts: a royalty question doesn't need printing or ISBN policy.
 * General inquiries can be about anything, so they get the whole KB (still under ~1.5k tokens).
 */
export function sectionsFor(category: TicketCategory): string[] {
  switch (category) {
    case "royalty_payments":
      return [KB.royalty];
    case "isbn_metadata":
      return [KB.isbn, KB.distribution];
    case "printing_quality":
      return [KB.printing];
    case "distribution_availability":
      return [KB.distribution];
    case "book_status_production":
      return [KB.production, KB.distribution];
    case "general_inquiry":
      return [KB.royalty, KB.isbn, KB.printing, KB.distribution, KB.production];
  }
}
