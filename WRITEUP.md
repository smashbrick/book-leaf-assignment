# Write-up

## What I focused on
The brief says the ticket flow and the AI matter most, so I built that first and kept the rest small: an author raises a ticket, the AI classifies it, an admin sees it in the queue, the AI drafts a reply, the admin edits and sends it, and the author sees it without refreshing.

For the AI, I wanted replies that sound like BookLeaf and use the author's real numbers instead of generic text. So the draft prompt gets the tone guidelines, the part of the knowledge base that matches the ticket, and the author's book and royalty data. Things models tend to get wrong, like working out the next payout date, are calculated in code and passed in. An admin always reviews the draft before it goes out.

I also made sure the app keeps working when the AI doesn't. Tickets are saved before the AI runs, and if it fails the ticket shows as "Unclassified" and the admin handles it manually.

## Trade-offs
- One app instead of a separate frontend and backend. It's simpler to run and needs no CORS setup.
- Plain SQL instead of an ORM. Less magic, and the whole schema is in one file.
- The AI classification runs inside the server process rather than a job queue. That's fine at this size, and waiting tickets are picked up again after a restart.
- Drafts are created when an admin opens a ticket and then saved, rather than for every ticket up front, so you only pay for drafts that get used.
- I only used free AI: a local Ollama model by default and Gemini's free tier for testing. Any other provider works by changing config. The downside is that a small local model writes plainer replies than a bigger hosted one.
- I skipped real file uploads and email notifications.

## Taking it to production
1. Measure the AI on real past tickets and keep tracking how often admins change its category or priority (this is already stored).
2. Give the AI better data, like payout history and production timelines, so replies can say "paid on 12 Feb" instead of asking the admin to check.
3. Move the AI calls to a job queue, use Redis so live updates work across several servers, and add real attachments and email notifications.
4. Suggest answers on the "Get help" form so common questions get answered before they become tickets.
5. Add response-time tracking for the team, so slow categories show up early.
