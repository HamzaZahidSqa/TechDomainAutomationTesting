# TD-122 – Fix chat bubbles username (vendor company name shown for all)

Ticket: https://techdomain.atlassian.net/browse/TD-122 (Feature/Bug, Medium, labels Bug/Production/hotfix, QA In Progress)
Environment: https://dev.techdomain.com.au (bundle main.af2f4820.js) / https://api.dev.techdomain.com.au/api
Spec: `tests/td-122-chat-bubble-username.spec.js` · Run: `run-1013053118` (2026-10-13)

## Verdict: **PASS** – every chat bubble is labelled with the sender's user name; the vendor company name appears only as the conversation title / sidebar row, never on a bubble.

Setup: WO 981 (#10975, Tech Domain company 9, customer entity 104) ASSIGNED to vendor engineer 611 "Demo Worker" of vendor 79 "Demo Field Services 0925" (owner 609 "Demo CompanyOwner"). Tech Domain user 27 "istkhar Hussain".
Threads: Tech Domain ↔ vendor owner (room 1800) and vendor owner ↔ vendor worker. Each party sent one tagged message, then every view was read.

| View | Thread | Counterpart bubble label | Own bubble | Company name on any bubble? | Result |
|---|---|---|---|---|---|
| Tech Domain user | vendor thread (`?engineerId=609`) | **Demo CompanyOwner** | no label | no | PASS |
| Vendor owner | "Tech Domain" thread | **istkhar Hussain** | no label | no | PASS |
| Vendor owner | "Demo Worker" thread | **Demo Worker** | no label | no | PASS |
| Vendor worker | own thread | **Demo CompanyOwner** | no label | no | PASS |

Conversation titles still show the company (by design): Tech Domain view header/sidebar "Demo Field Services 0925" (participant type COMPANY), vendor worker header "Demo Field Services 0925".
API: `GET /chats/1800` message `sender` objects carry only id/firstName/lastName/profilePicture (no company), which is what the bubble renders (`firstName lastName`).

## Observations (not part of this ticket)
- The assigned vendor worker (611) is not a participant of the Tech Domain ↔ vendor room; the worker only chats with the vendor owner, who relays to Tech Domain.
- The Tech Domain ↔ vendor room lists TD users 473, 263, 476, 640 and vendor owner 609 as participants; user 27 (who is chatting) is not in the list returned by `/inbox/1800`.

## Evidence
`evidence/TD-122-ChatBubbleUsername/run-1013053118/` – results.json, summary.txt, screenshots 01 Tech Domain view, 02 vendor owner (Tech Domain thread), 03 vendor owner (worker thread), 04 vendor worker view.
Test data left on dev: WO 981 ASSIGNED to 611 (created for the customer-notification check, then assigned for this test); tagged chat messages `TD122-*` in rooms 1800 and the vendor-internal room.
