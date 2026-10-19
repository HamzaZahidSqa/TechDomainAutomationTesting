# Counter offer edited by Tech Domain BEFORE the customer accepts

Scenario (asked 2026-10-16): customer creates a work order → Tech Domain sends a counter offer → before the customer responds, Tech Domain edits the counter offer → customer accepts. What does the customer see, and which values are applied?
Environment: https://dev.techdomain.com.au · Spec: `tests/counter-offer-edit-before-accept.spec.js` · Run: `run-1016050900` (2026-10-16 05:09 UTC) · WO 1085 (#11079), counter offer id 2491

## Verdict: **PASS** – the edit replaces the pending proposal in place; the customer sees only the edited values, is notified about the update, and acceptance applies the edited values (58/6/62 + Parking 10), not the first version (60/4/65 + Tools 20).

Note: in the TD-111 run of 14 Oct the customer could not read/accept the proposal at all (HTTP 403). That is fixed on dev now: `GET offers/customer/counter/:wo` returns 200 for the customer owner, the Proposals tab appears, and Accept works from the UI.

| # | Step | Result |
|---|---|---|
| 1 | Customer owner 638 creates WO #11079: 45/h, 5 hrs, 50/h additional, Travel 30 (estimate 255) | PENDING_APPROVAL |
| 2 | Tech Domain sends counter v1: 60/h, 4 hrs, 65/h + Tools "Ladder hire" 20 | 201, counter 2491 PENDING |
| 3 | Customer API + Proposals tab show v1 (Proposed 240.00, Ladder hire, Accept/Decline) | screenshot 01 |
| 4 | Tech Domain edits (PATCH offers/customer/counter/2491) to v2: 58/h, 6 hrs, 62/h + Other "Parking" 10 | 200, same id, still PENDING; history = [v1 60/4/65, v2 58/6/62] |
| 5 | Edited proposal no longer carries the v1 expense (Tools 20 replaced by Parking 10) | correct |
| 6 | Customer API shows v2 only, status PENDING "Awaiting your response" | PASS |
| 7 | Customer Proposals tab shows Proposed USD 348.00 (58 × 6), 58.00 / 6 hrs / 62.00, Other Expense (Parking), estimate 255.00 → 388.00; v1 values (60.00, Ladder hire) are gone | screenshot 02 |
| 8 | Customer notifications: "istkhar Hussain has sent you a proposal." then "istkhar Hussain has updated their proposal." (both link to /workOrder/proposals/1085) | screenshot 03 |
| 9 | While pending the work order keeps the original rates (45/5/50, total 255) | PASS |
| 10 | Customer clicks Accept → "Accept Proposal" dialog → Accept → "Proposal Accepted Successfully" | screenshots 04, 05 |
| 11 | Proposal card: "Accepted … by Customer Owner", Current 225.00 / Proposed 348.00 (card collapses to totals) | screenshot 06 |
| 12 | Counter record ASSIGNED, history [PENDING 60/4/65, PENDING 58/6/62, ASSIGNED 58/6/62] | PASS |
| 13 | Work order rates after acceptance: 58/h, 6 hrs, 62/h; expenses Travel 30 + Parking 10 (no Tools 20); labour 348, expenses 40, total 388; sub-status COUNTER_OFFER_ACCEPTED | PASS |
| 14 | Customer Payment tab and Tech Domain Payment tab show 58.00 + Parking, no 60.00 / Ladder hire; Tech Domain banner "Counter Offer Accepted", no Edit/Withdraw buttons | screenshots 07, 08, 09 |

## Observations (not bugs)
- The accepted proposal card collapses to the totals only (no per-rate lines) – the expanded view is available via the chevron.
- The customer's proposal page shows only the latest version; the v1 values are not shown anywhere on the customer side (history is only in the API `offerHistory`).
- API expense type for the UI's "Other" is `OTHER`; an unknown type is rejected with 400 "Each expense needs a valid type, a description and an amount greater than 0."

## Evidence
`evidence/CounterOffer-EditBeforeAccept/run-1016050900/` – results.json, summary.txt, screenshots 01–09 (named `CounterOffer_EditBeforeAccept_NN_<step>.png`).
Earlier run `run-1016050548` (WO 1084, counter 2490) stopped at the edit because of the invalid expense type in the test; WO 1084 is left with a pending v1 counter offer.
