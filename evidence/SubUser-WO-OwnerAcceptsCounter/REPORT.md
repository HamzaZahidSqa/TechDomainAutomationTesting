# Sub-user creates the work order → can the customer owner accept Tech Domain's counter offer? (2026-10-16)

Spec: `tests/subuser-wo-owner-accepts-counter.spec.js` · Run: `run-1016101707` · Customer 103/104: owner 638 "Customer Owner", sub-user 639 "Subuser Tdtest"

## Verdict: YES. The owner sees the sub-user's work order and its proposal, gets the notification, and accepts it from the UI; the counter rates are applied.

| # | Step | Result |
|---|---|---|
| A1 | Sub-user 639 creates WO 1088 (#11082), 45/5/50 + Travel 30 | PENDING_APPROVAL, createdBy 639 ✔ |
| A2 | Owner opens it | API detail 200; listed on the customer board (status filter / search) ✔ (spec check failed only because the unfiltered list is capped at 100 rows) |
| A3 | Tech Domain counter 60/4/65 + Tools 20 | 201 ✔ |
| A4 | Owner reads the counter (`GET offers/customer/counter/1088`) | 200 PENDING 60/4/65 ✔ (sub-user also 200) |
| A5 | Notifications | owner AND sub-user both get COUNTER "istkhar Hussain has sent you a proposal." ✔ |
| A6 | Owner UI: detail header "Submitted · Proposal Received", Proposals tab shows CURRENT 225 / PROPOSED 240 with Accept | ✔ (02) |
| A7 | Owner clicks Accept → confirm → toast "Proposal Accepted"; card "accepted by Customer Owner" | ✔ (03–05) |
| A8 | Counter ASSIGNED; WO rates 60/4/65, expenses Travel 30 + Tools 20 = 290; owner Payment tab shows 60.00 + Ladder hire | ✔ (06) |
| A9 | Sub-user (creator) proposals page afterwards | shows "Accepted … by Customer Owner" ✔ (07) |

## Reverse case (info): owner creates WO 1090, sub-user tries to accept
- Sub-user can open the WO detail (200) but `GET offers/customer/counter/1090` → **403 "You do not have access to this counter offer."**; proposals page shows no card (08); API accept → **403 "Only the customer can respond to this proposal."** So a sub-user cannot act on proposals for work orders they did not create. Consistent with the chat rule (sub-user only involved in WOs they created).

Evidence: `evidence/SubUser-WO-OwnerAcceptsCounter/run-1016101707/` (results.json, summary.txt, screenshots 01–08). Test data: WO 1088 (#11082) counter accepted, still PENDING_APPROVAL; WO 1090 counter 2499 still PENDING.
