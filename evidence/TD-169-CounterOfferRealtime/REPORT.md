# TD-169 – Counter offer notifications do not update in real time (only update after reload)

Ticket: https://techdomain.atlassian.net/browse/TD-169 (Feature, Medium, labels Backend/Bug, status QA In Progress, created 2026-10-16 04:34 UTC)
Environment: https://dev.techdomain.com.au (frontend bundle `main.2a8246fe`, newer than this morning's `main.9c79992f`), API https://api.dev.techdomain.com.au/api
Spec: `tests/td-169-counter-offer-realtime-notifications.spec.js` · Run `run-1016110039` (2026-10-16 11:00–11:06 UTC)
Accounts: Tech Domain user 27 "istkhar Hussain" (company 9), customer owner 638 "Customer Owner" (Customer Company 10090955, entity 104)

## Verdict: **PARTIAL PASS**

| Part of the expected result | Result |
|---|---|
| Counter offer **notification** (bell badge + panel) appears in real time, no reload | **PASS** for all 5 events, on both sides (badge updates within ~1 s, socket `notification` frame received) |
| Related **work order state** (sub-status badge, Proposals tab, banner, Edit/Withdraw buttons) updates automatically | **FAIL** – never updates while the page is open; correct only after reload (send, withdraw, accept, decline) |

The notification half of the ticket could not be reproduced on the current dev build. The work-order-state half is still broken: the open page is never told that the counter offer changed. Note the frontend bundle changed between 10:30 UTC and this run, so the notification fix may have been deployed before the test.

## Method

One side kept a browser page open on the work order detail (never reloaded, nothing clicked). The other side performed the counter-offer action through the API. For 40 s the open page was polled every second for the bell badge count (`.MuiBadge-badge` next to the bell icon), the header sub-status, the tabs and the counter banner, while every socket.io frame and every HTTP request of the page were recorded. Then the bell was clicked ("appears on click?") and finally the page was reloaded ("appears after reload?"). Server truth: `GET /notifications/others` diff per receiver.

| # | Open page | Action (other side, API) | WO |
|---|---|---|---|
| E1 | customer | Tech Domain sends counter (`POST offers/customer/counter`, id 2505) | 1096 (#11090) |
| E2 | customer | Tech Domain edits counter (`PATCH offers/customer/counter/2505`) | 1096 |
| E3 | customer | Tech Domain withdraws (`POST offers/customer/counter/withdraw/2505`) | 1096 |
| E4 | Tech Domain | customer accepts (`POST offers/customer/counter/accept/<id>`) | 1097 (#11091) |
| E5 | Tech Domain | customer declines (`POST offers/customer/counter/decline/<id>`) | 1098 (#11092) |

## Results per event

| Event | Server notification created | Socket `notification` frame at | Bell badge (no reload) | Panel on bell click | Work order state (no reload, 40 s) | State after reload |
|---|---|---|---|---|---|---|
| E1 send | COUNTER "istkhar Hussain has sent you a proposal." | +0.2 s | 54 → 55 at +1.0 s **PASS** | shown | header still "Submitted", no Proposal Received badge, no Proposals tab **FAIL** | "Submitted → Proposal Received", Proposals tab present |
| E2 edit | COUNTER "…has updated their proposal." | +1.1 s | 55 → 56 at +1.1 s **PASS** | shown | badge already present from reload (edit keeps it) – n/a | unchanged, correct |
| E3 withdraw | WITHDRAW "…has withdrawn their proposal." | +0.2 s | 56 → 57 at +1.1 s **PASS** | shown | "Proposal Received" badge still shown **FAIL** | badge removed; Proposals tab still visible (see observation) |
| E4 customer accepts | WORK_ORDER_UPDATED "Customer Owner has accepted your counter offer." | +0.3 s | 7 → 8 immediately **PASS** | shown | still "Counter Sent", banner "Counter Offer Sent / Awaiting the customer's response", Edit/Withdraw buttons still shown **FAIL** | "Counter Accepted", green banner "Counter Offer Accepted … The customer rates have been updated.", Edit/Withdraw gone |
| E5 customer declines | WORK_ORDER_UPDATED "Customer Owner has declined your counter offer." | +1.2 s | 8 → 9 immediately **PASS** | shown | still "Counter Sent" + "Counter Offer Sent" banner **FAIL** | "Counter Declined", banner "Counter Offer Declined" |

During every 40 s watch the page made **no HTTP request** at all (no refetch of `workOrders/:id` or `offers/customer/counter/:id`) and received **no work-order socket frame** – only the `notification` frame (plus `messageDelivered`). The bell is updated because the header's socket handler writes the incoming `notification` straight into the react-query cache (`otherNotifications`); nothing in the work order detail page listens for counter-offer changes.

## Root cause (frontend, from the dev bundle)

* `notification` socket event → handled in the header (`setQueryData(["otherNotifications", userId])`, badge +1). This is why the bell works in real time.
* The only `workOrder:update:<id>` listener (`subscribeWorkOrder`) is in the engineer job-detail context. The Tech Domain and customer work order detail pages do not subscribe to work order updates and do not invalidate `workOrders/:id` / `offers/customer/counter/:id` when a COUNTER / WITHDRAW / WORK_ORDER_UPDATED notification arrives.
* Expected fix: on a counter-related `notification` for the currently open work order (or on a `workOrder:update:<id>` event emitted by the backend for counter actions), invalidate the work order detail + counter queries so the badge, Proposals tab, banner and action buttons refresh without a reload.

## Observations (not in the ticket)

1. After the withdraw and a reload, the customer still sees the **Proposals** tab (the counter record is WITHDRAWN; the badge is gone). Probably intended as history, worth confirming.
2. Tech Domain accept/decline notifications are typed `WORK_ORDER_UPDATED` (customer ones are `COUNTER` / `WITHDRAW`); the title is the work order title ("WO-11091: …") and the link goes to the work order details.
3. Opening the bell panel issued no request – the panel shows the socket-fed cache, so "appears only on click" was not observed on this build.

## Evidence

`run-1016110039/`: `results.json` (per-event timelines, socket frames, requests), `summary.txt`, screenshots `TD-169_CounterOfferRealtime_01…18`:
01 customer baseline · 02 E1 after 40 s no reload (badge 55, header unchanged) · 03 E1 bell clicked · 04 E1 after reload (Proposal Received + Proposals tab) · 05–07 E2 · 08–10 E3 (badge stays until reload) · 11 Tech Domain baseline WO2 · 12 E4 after 40 s no reload (badge 8, still "Counter Sent") · 13 bell · 14 after reload ("Counter Accepted") · 15 baseline WO3 · 16–18 E5.

Test data left on dev: WO 1096 (#11090, counter withdrawn), WO 1097 (#11091, counter accepted, rates 60/4/65 + tools 20), WO 1098 (#11092, counter declined); all PENDING_APPROVAL.

Re-run: `npx playwright test tests/td-169-counter-offer-realtime-notifications.spec.js --reporter=line --trace off` (`WATCH_MS` to change the 40 s watch).
