# Customer-side counter-offer (proposal) sub-status before publish

Rule under test (user, 2026-10-16): the counter-offer related sub-status is shown to the customer before the work order is published (detail header + work order listing), the customer gets a notification for it, and as soon as the work order is published the sub-status disappears.

Environment: https://api.dev.techdomain.com.au/api, https://dev.techdomain.com.au (bundle main.9c79992f)
Spec: `tests/counter-offer-substatus-visibility.spec.js` · Run: `run-1016102952` (2026-10-16 10:29–10:36 UTC) · customer owner 638, Tech Domain 27

## Verdict: **PASS** (all paths: accept, decline, withdraw)

| WO | Step | Tech Domain API | Customer API (detail = listing) | Customer UI header badge | Customer listing (Submitted tab) | Customer notification |
|---|---|---|---|---|---|---|
| 1091 #11085 | A0 submitted, no counter | PENDING_APPROVAL / – | PENDING_APPROVAL / – | Submitted | Submitted | – |
| 1091 | A1 Tech Domain sends counter | PENDING_APPROVAL / COUNTER_OFFER_PENDING | **COUNTER_OFFER_PENDING** | Submitted → **Proposal Received** | Submitted → **Proposal Received** | "istkhar Hussain has sent you a proposal." (type COUNTER) |
| 1091 | A2 customer accepts | PENDING_APPROVAL / COUNTER_OFFER_ACCEPTED | **COUNTER_OFFER_ACCEPTED** | Submitted → **Proposal Accepted** | Submitted → **Proposal Accepted** | none (own action) |
| 1091 | A3 Tech Domain publishes | PUBLISHED / null | PUBLISHED / **null** | **Accepted** only | **Accepted** only (Accepted tab) | "Work Order Accepted – WO-11085" |
| 1092 #11086 | B1 counter sent | COUNTER_OFFER_PENDING | COUNTER_OFFER_PENDING | Proposal Received | Proposal Received | "has sent you a proposal." |
| 1092 | B2 customer declines | COUNTER_OFFER_DECLINED | **COUNTER_OFFER_DECLINED** | Submitted → **Proposal Declined** | Submitted → Proposal Declined | none (own action) |
| 1092 | B3 published | PUBLISHED / null | null | Accepted only | Accepted only | "Work Order Accepted – WO-11086" |
| 1093 #11087 | C1 counter sent | COUNTER_OFFER_PENDING | COUNTER_OFFER_PENDING | – (API only) | – (API only) | "has sent you a proposal." |
| 1093 | C2 Tech Domain withdraws | PENDING_APPROVAL / null | **null** (sub-status cleared) | – | – | "istkhar Hussain has withdrawn their proposal." (type WITHDRAW) |
| 1093 | C3 published | PUBLISHED / null | null | – | – | "Work Order Accepted – WO-11087" |

## Observations
- Counter-offer sub-statuses on dev: `COUNTER_OFFER_PENDING` (UI "Proposal Received"), `COUNTER_OFFER_ACCEPTED` ("Proposal Accepted"), `COUNTER_OFFER_DECLINED` ("Proposal Declined"). All three are returned to the customer in `GET /workOrders/:id` and in `GET /workOrders/customer` and rendered as the second badge in the detail header and the Status column of the listing.
- Publishing (`POST /workOrders/:id/approvePublish`) clears `subStatus` to null on both sides; the customer then sees only "Accepted" and the row moves from the Submitted tab to the Accepted tab. The counter record itself keeps its final status (ASSIGNED for an accepted one).
- Withdrawing clears the sub-status immediately (no "Proposal Withdrawn" sub-status), with a WITHDRAW notification to the customer.
- Notifications to the customer: proposal sent, proposal withdrawn, work order published. Accept/decline are the customer's own actions and create no notification for the customer (Tech Domain is the one notified there, not checked in this run).
- Test note: the only automated FAIL in the raw log was a false positive (the work order title contained the word "Counter"); screenshot 06 shows the published row with the Accepted badge only. The spec now excludes the title from that check.

## Evidence
`evidence/CounterOffer-SubStatusVisibility/run-1016102952/` – `results.json`, `summary.txt` and screenshots:
- `01/02` A1 pending: detail "Submitted → Proposal Received", listing row with the same badge.
- `03/04` A2 accepted: "Submitted → Proposal Accepted" in detail + listing.
- `05/06` A3 published: "Accepted" only in detail + listing.
- `07/08` B2 declined: "Submitted → Proposal Declined" in detail + listing; `09/10` B3 published: "Accepted" only.

Test data left on dev: WOs 1091–1093 (#11085–#11087) PUBLISHED, customer 638.
Re-run: `npx playwright test tests/counter-offer-substatus-visibility.spec.js --reporter=line --trace off`
