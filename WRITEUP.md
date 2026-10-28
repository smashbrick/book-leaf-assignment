# Write-up

## What I focused on
The brief says the core ticket flow and the AI matter most, so I built that first and kept everything else small:

**author raises a ticket → AI classifies it → admin sees it in the queue → AI drafts a reply → admin edits and sends → author sees it live.**

For the AI, my goal was replies that sound like BookLeaf and use real numbers, not generic text. So the draft prompt gets BookLeaf's tone guidelines, the knowledge-base section for that type of ticket, and the author's actual book and royalty data. Things LLMs get wrong, like working out the next payout date, I calculate in code and pass in as facts. The admin always reviews the draft before it's sent.

I also made sure the app still works when the AI doesn't. Tickets are saved before the AI runs. If it fails, the ticket shows as "Unclassified" near the top of the queue and the admin writes the reply themselves.

## Trade-offs
- **One app instead of separate frontend and backend deploys.** Express serves the React build. Simpler to deploy and test, with no CORS.
- **Plain SQL instead of an ORM.** Less magic, and the schema is easy to read in one file.
- **The AI job runs inside the server process, not a queue.** Fine for this size. Tickets still waiting are picked up again after a restart.
- **Drafts are made when an admin opens a ticket, then saved,** instead of for every ticket upfront. You only pay for drafts that are used.
- **Free Gemini model through the OpenAI-compatible API.** It costs nothing for the demo, and switching providers is a config change.
- **Skipped:** real file uploads, author follow-up replies, email notifications.

## Turning it into a production system
1. **Measure the AI.** Test the prompts on real past tickets and track how often admins change the AI's category or priority (already stored) and how much they edit drafts.
2. **Give the AI better data.** With access to payout history and production timelines, replies could say "paid on 12 Feb" instead of "[CHECK]".
3. **Make it sturdier.** A job queue for AI calls, Redis for live updates across several servers, real attachments, and email notifications.
4. **Fewer tickets in the first place.** Suggest answers on the "Get help" form before a ticket is created. The payout note on My Books already does this for the most common question.
5. **Two-way conversations** so authors can reply on a ticket, and SLA tracking for the team.
