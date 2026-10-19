# TD-111 – Counter offer from Tech Domain side to the customer

Ticket: https://techdomain.atlassian.net/browse/TD-111 (Task, Highest, labels Backend/Feature/Frontend, status Done 2026-10-14 15:33, 2 GitHub PRs still OPEN)
Environment: https://dev.techdomain.com.au (frontend build `main.16fe721c.js`, deployed 2026-10-14 09:59 UTC) · API https://api.dev.techdomain.com.au/api
Spec: `tests/td-111-customer-counter-offer.spec.js` (Playwright, UI-driven, screenshot per step) · Run: `run-1014113201` (2026-10-14 11:32–11:39 UTC)
Report builder: `node scripts/build-td111-report.js` → `run-*/report.html` + `~/Downloads/TD-111-Verification-Report.pdf`

## Verdict: **FAIL – blocked on the customer side**

The Tech Domain half of the feature works (send / edit / withdraw a counter offer, validation, banners, history, notifications to the customer, publish-while-pending warning).
The customer half does **not** work on dev: the customer who created the work order gets **HTTP 403 "You do not have access to this counter offer."** on `GET offers/customer/counter/:wo`, so the web app shows no "Proposals" tab, no header text and no Accept/Decline buttons. Accept/decline return **403 "Only the customer can respond to this proposal."** for the customer, the customer sub-user, Tech Domain and Admin alike – nobody can accept. Because of that, every requirement that depends on acceptance (rates move on with the accepted values, calculations with the accepted expenses, "assigned" view for the other Tech Domain users) could not be verified and is recorded as BLOCKED.

| | Count |
|---|---|
| Checks executed | 92 |
| Pass | 56 |
| Fail | 11 (all but 2 are the same customer-access bug) |
| Blocked (depends on the customer accepting) | 25 |
| Informational observations | 11 |

## Scenarios and results

All work orders were created by customer owner 638 (Customer Company 10090955, parent client 103 / entity 104) via API; everything else was done in the browser.

| Scenario | Work order | Result |
|---|---|---|
| A. Happy path: Tech Domain counters 45/5/50 → 60/4/65 + Tools expense 20, customer accepts, WO continues with accepted rates through publish → assign → complete → calculation | 1051 (#11045) | Tech Domain side PASS (A-01…A-13). Customer side FAIL (A-14…A-18). A-19…A-31 BLOCKED |
| B. Customer declines | 1052 (#11046) | Send PASS. Decline FAIL (403). B-03…B-07 BLOCKED |
| C. Tech Domain edits (55 → 58/6/62 + Parking 10) then withdraws, then counters again | 1053 (#11047) | PASS (C-01…C-12 except customer views C-05/C-10 BLOCKED) |
| D. Three Tech Domain users on one WO (owner 27, team member 640, non-team user 641) | 1054 (#11048) | Tech Domain side PASS; acceptance BLOCKED |
| E. Negative / edge / boundary (UI validation, API rejections, publish while pending) | 1055 (#11049) | 22 PASS, 2 findings (E-01, E-27), customer read FAIL (E-22), E-28 BLOCKED |
| F. FIXED payment type (300 → 350 + travel 40) | 1056 (#11050) | Tech Domain side PASS; acceptance BLOCKED |
| G. Customer notification | all | PASS |

### What works (Tech Domain side)
- "Counter Offer" button appears only for Tech Domain on a customer-created **Submitted** (PENDING_APPROVAL) work order; modal shows current labour, customer expenses and "Estimated Payment"; Send is disabled until something is added.
- Labour "Add" shows old (struck) → new values and recalculates (45×5+30 = 255 → 60×4+30 = 270); adding an expense adds it to the estimate (→ 290). FIXED work orders get a single "Fixed Rate" field.
- Send → `POST offers/customer/counter` (201) → toast "Counter Offer Sent Successfully"; header badge "Submitted → Counter Sent"; banner "Counter Offer Sent – Awaiting the customer's response to the counter offer sent by istkhar Hussain on Oct 14, 2026 at 4:08 PM"; buttons become "Edit Counter Offer" / "Withdraw Counter Offer". Work-order rates stay unchanged while pending.
- Edit → `PATCH offers/customer/counter/:id` → "Counter Offer Updated"; Withdraw → `POST …/withdraw/:id` → "Counter Offer Withdrawn", banner "…keeps its original rates", "Counter Offer" button back; a new counter can be sent afterwards (history keeps every version).
- One counter offer per work order, **shared by the whole Tech Domain team**: user 2 sees Edit/Withdraw (not a second "Counter Offer"), their edit becomes the pending version and is attributed to them ("sent by Teammember Tdtest"); user 1 sees the same. The customer is notified "Teammember Tdtest has updated their proposal." A Tech Domain user with no team sees the same buttons (D-07).
- Validation: rate 0 / negative / empty expense type / empty description / amount 0 → toasts "Please enter Labour Values" / "Please enter Expense Values"; same values as current → nothing added, Send stays disabled; Cancel creates nothing; decimals (60.55, 0.01, 12.50) accepted and shown with 2 decimals.
- API rejections: customer cannot create/withdraw (403), Tech Domain/Admin cannot accept/decline (403), negative rate 400, missing workOrderId 400, unknown id 404 "Proposal not found.", counter on a published WO 404 "not pending approval", unchanged counter 400 "A counter offer must change at least one rate or add an expense."
- Review & Publish while a counter is pending → dialog **"Proposal Pending … published with the customer's current rates and the customer will no longer be able to respond" / "Publish Anyway"**; Cancel keeps everything pending. Publishing keeps the original rates (255) and does not add the proposed expense.
- Customer receives a bell notification for every event: "istkhar Hussain has sent you a proposal." / "has updated their proposal." / "has sent you a new proposal." linking to `/workOrder/proposals/:id?fromCustomerBoard=true`.

## Findings

1. **BLOCKER – customer cannot see, accept or decline the proposal.** `GET offers/customer/counter/:wo` → 403 "You do not have access to this counter offer." for the customer owner who created the WO (user 638), for the customer sub-user 639, for Tech Domain and for Admin; `POST …/accept/:id` and `…/decline/:id` → 403 "Only the customer can respond to this proposal." for everyone. In the UI the customer sees no "Proposals" tab, no "Your provider sent you a proposal…" header, and the notification link lands on the Details tab (screenshots A08, A09, A11, A12, E12). Likely cause: the access check compares the customer record (parent client **103**) with the work order's client entity (**104**, `parentClientId 103`) – every self-signup customer has this parent/entity pair. Side note: the older td36 customer 617 (client 93, no parent) cannot create work orders at all via the API ("Invalid client selected"), so no customer on dev could be found for whom the flow works.
2. **Publishing while a counter is pending silently withdraws it and blames the publisher** (E-27). After "Publish Anyway" (same `approvePublish` API) the counter record becomes WITHDRAWN and the banner reads "Counter Offer Withdrawn – istkhar Hussain withdrew the counter offer on … The work order keeps its original rates." The frontend has a dedicated "Counter Offer Not Answered … before the work order moved on from review" state that is never reached. Low severity, but the text is misleading.
3. **Labour "Add" with all fields empty gives no feedback** (E-01): the click is silently ignored (nothing added, Send disabled), while 0 / negative values do show "Please enter Labour Values". Minor.
4. **No upper bound on rates** (E-10, informational): 999,999.99/h × 1000 h is accepted by the modal (estimate "USD 1000000020.00"). Decide whether a sanity limit is wanted.
5. Observation: the Review & Publish wizard's "Publish" is disabled on a customer-created WO until Tech Domain fills Project, Technology Stacks, Category and Skills (E13 screenshot) – expected, but it means the pending-proposal warning only appears after that.

## Could not be verified (blocked by finding 1)
Rates and expenses moving on with the accepted values; customer/Tech Domain Payment tabs after acceptance; "Counter Offer Accepted … rates have been updated" banner; the other Tech Domain users seeing the WO as accepted/assigned; completion calculation with customer + counter + Tech Domain expenses; FIXED acceptance; decline path; "Not answered" customer card. All of these are coded in the spec and will run automatically once the customer can read the proposal (re-run the spec, no changes needed).

## Evidence
`evidence/TD-111-CustomerCounterOffer/run-1014113201/` – 48 screenshots `TD-111_CounterOffer_NN_<scenario>-<step>.png`, `results.json` (every check with expected/actual), `report.html`; PDF `~/Downloads/TD-111-Verification-Report.pdf`.
Test data left on dev (customer 638): WOs 1051–1056 (#11045–#11050); 1055 published; earlier debugging runs created WOs 990–1050 in the same state (Submitted with a pending/withdrawn counter).

## Regression: existing engineer-side counter offer (spec `tests/td-111-regression-engineer-counter.spec.js`, run `regression-run-1014122234`)

Verdict: **PASS – no regression.** 32 of 34 checks passed; the 2 failures are a pre-existing behaviour, not caused by TD-111 (see below).

| Scenario | Work order | Result |
|---|---|---|
| R1 Individual engineer 575: Counter Offer (30/4/33 + Fuel 10) → Edit (32/4/35) → Withdraw → Counter again (35/4/38 + Tools 15) → Tech Domain Providers > Pending Assignments > COUNTER OFFERS > Review ("Counter Offer Review", Current Pay vs Counter Pay) > Accept & Assign > "Yes, Assign" | 1069 (#11063) | PASS (19/19): `POST offers/counter/accept` 201, "Counter Offer Accepted Successfully", WO ASSIGNED to 575 with engineer rates 35/4/38 + TOOLS 15; customer rates untouched (45/5/50); engineer sees Assigned, Jobs > Countered counts it |
| R2 Vendor owner 609 counters for member "Demo Worker" 611 via "Select Engineer" (28/4/30) → Tech Domain accepts | 1070 (#11064) | PASS (9/9): payload carries `referredEngineerId 611`, WO ASSIGNED to 611 / company 79 with 28/4/30, Demo Worker sees the assigned job |
| R3 Work order with "Disable counter offers" (`isCounterOffersDisable: true`): engineer Request → "Requested Offer Review" → Accept & Assign (`POST offers/assign`) | 1071 (#11065) | Request path PASS (4/4): ASSIGNED with the original 20/4/22. **R3-01/R3-02 FAIL: the flag is ignored** – the engineer still sees "Counter Offer" and `PATCH offers/engineer/counter` returns 200 |

The "Disable counter offers" flag was already ineffective before TD-111: the engineer "Counter Offer" button condition is byte-for-byte identical in the 9 Oct bundle (`main.af2f4820.js`) and the 14 Oct bundle (`main.16fe721c.js`), and the checklist (line 1728) already documents the odd condition. Pre-existing issue, worth its own ticket; not a TD-111 regression.
Also unchanged: engineer counter modal prints amounts without a space ("USD30.00") while the new Tech Domain modal prints "USD 30.00" (cosmetic).
Runs 1–3 of this spec (`regression-run-1014120610`, `…121239`, `…121718`) failed only on test-data/timing issues (409 "Schedule Conflict" because the same engineers were already assigned on those dates by the previous run; expired browser token retried by the app) – the product behaviour was the same in every run.
Earlier today the whole checklist batch-1 suite (473 checks: auth, notifications, chat, roles, onboarding) was also re-run after the dev branch change with 0 regressions (`evidence/Checklist/Regression-2026-10-14.md`).
