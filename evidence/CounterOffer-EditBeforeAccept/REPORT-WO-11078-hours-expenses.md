# WO #11078 – additional hours and expenses after the edited counter offer was accepted

Spec: `tests/wo-11078-additional-hours-expenses.spec.js` · Run: `wo-11078-hours-expenses-run-1016055156` (2026-10-16 05:52–06:15 UTC) · WO 1084 (#11078), engineer 575 "Syed Hamza"
Starting point: edited counter offer accepted → customer rates 58/h, 6 minimum hours, 62/h additional, expenses Travel 30 (customer) + Parking 10 (counter) = USD 388.

## Verdict: calculations are consistent with the accepted (edited) counter rates, **but two findings**: (1) the customer is billed in rounded-up full hours once the overrun is ≥ 15 min while overruns < 15 min are billed pro-rata (inconsistent rule, floating-point leftovers); (2) `PATCH workOrders/:id/companyExpenses` answers `success:true` even when the payload key is wrong and nothing is saved.

## Flow and results

| # | Step | Result |
|---|---|---|
| 1 | Tech Domain publishes (teams/category added, engineer rates 15/h min 4 h, +15/h) | PUBLISHED, customer rates still 58/6/62, total 388 ✔ |
| 2 | Route → engineer accepts → assign | ASSIGNED, rates unchanged ✔ |
| 3 | Engineer confirm → check-in → check-out → mark complete | WORKDONE, 0 h logged: labour 58 × 6 = 348, expenses 40, total 388 ✔ (minimum hours applied) |
| 4 | Tech Domain edits the time log (`PATCH timeLogs/updateTimelogs {logs:[{id, checkInTime, checkOutTime}]}`) to **8 h 30 min** | Header "Working Hours 8 hours 30 mins" ✔ |
| 5 | Customer calculation with 8.5 h | hoursWorked **9**, additional **3 h**, labour 348 + 3 × 62 = **534**, expenses 40, **total 574** – see finding 1 (pro-rata would be 2.5 h → 503 / 543) |
| 6 | Engineer calculation with 8.5 h | 15 × 4 + 4.5 × 15 = **127.50** (exact, pro-rata) ✔ |
| 7 | Tech Domain adds company expense Material 25 | shown as "Techdomain Expenses USD 25.00" on the Tech Domain Payment tab only; NOT added to the customer total (574) and not visible to the customer ✔ (internal cost) |
| 8 | Customer API vs Tech Domain API | identical numbers ✔ |
| 9 | UI: Tech Domain Payment tab = Customer Rates 534.00 (58.00 / 6 h / 62.00 / 3 h additional), Expenses 40.00, Estimated Payable 574.00, Engineer Rates 127.50, Techdomain Expenses 25.00 | screenshot 05 |
| 10 | UI: customer Payment tab = same customer numbers, no Tech Domain expense | screenshots 03, 06 |

## Finding 1 – customer hours rounding is inconsistent (engineer is pro-rata)
Probed by editing the single time log (`updateTimelogs`) and reading `GET workOrders/estimatedPayment/1084`:

| Worked | Customer billed hours | Customer labour | Engineer billed hours |
|---|---|---|---|
| 5.5 h | 6 (minimum) | 348 | 5.5 |
| 6.1 h (6 h 06) | **6.1** | 354.2 | 6.1 |
| 6.2 h (6 h 12) | **6.2** | 360.40000000000003 | 6.2 |
| 6.25 h (6 h 15) | **7** | 410 | 6.25 |
| 6.5 / 6.75 / 6.9 h | 7 | 410 | exact |
| 7.0 h | 7 | 410 | 7 |
| 7.1 / 7.15 / 7.2 h | **7.1 / 7.15 / 7.2** | 416.2 / 419.3 / 422.4 | exact |
| 7.25 h | **8** | 472 | 7.25 |
| 8.5 h | **9** | 534 | 8.5 |
| 9.3 h | **10** | 596 | 9.3 |

Rule observed: overrun ≥ 15 min → rounded UP to the next full hour; overrun < 15 min → billed exactly (pro-rata, e.g. 7 h 12 min = 7.2 h). The engineer side is always exact. So 6 h 14 min costs the customer 348 + 0.23 × 62 while 6 h 15 min costs a full extra hour (410). Either < 15 min should be a free grace period (billed 0 extra) or everything should be pro-rata; dev to confirm the intended rule. Also unrounded floats leak into the API (`additionalHours: 0.09999999999999964`, `totalLabourCost: 360.40000000000003`).

## Finding 2 – companyExpenses endpoint accepts a wrong payload silently
`PATCH workOrders/1084/companyExpenses` with `{id, companyCurrency, expenses:[…]}` → `200 {"success":true}` but nothing is stored. The web app sends the key `companyExpenses` (then it works). The endpoint should reject/validate the payload instead of reporting success.

## Observations
- Tech Domain detail page at WORKDONE opens the "Feedback" popup automatically; it blocks the tabs until Cancel is clicked.
- Counter-offer expense is labelled "Provider: USD 10" and the customer's own expense "Buyer: USD 30" on both Payment tabs.
- Customer "Approve" button is disabled at WORKDONE (needs Tech Domain review/verify first) – consistent with TD-93/TD-110 runs.

## Evidence
`evidence/CounterOffer-EditBeforeAccept/wo-11078-hours-expenses-run-1016055156/` – results.json, summary.txt, 01 Tech Domain detail with Feedback popup, 02 Tech Domain detail (Working Hours 8 h 30), 03 customer Payment tab (534 / 574), 04 engineer Payment tab (127.50), 05 Tech Domain Payment tab (customer 574, engineer 127.50, Techdomain expense 25), 06 customer Payment tab after the Tech Domain expense (unchanged 574).
Test data: WO 1084 left at WORKDONE with time log 967 = 8.5 h and company expense 25.

## Part 2 (2026-10-16 06:30–07:05 UTC) – Verified → PO → Approved → invoices (end of the flow)

| # | Step | Result |
|---|---|---|
| 11 | Tech Domain: Reviewed → Verify → PO Pending | VERIFIED / PO_PENDING ✔ |
| 12 | Customer adds PO `PO-11078-QA` from the Payment tab (Edit Purchase Orders, PO-only modal) | `POST /workOrders/1084/purchaseOrder` 201, PO Pending cleared ✔ (also closes the WO-11067 bug, see that report) |
| 13 | Tech Domain approves | APPROVED, customerStatus APPROVED; final customer total 574, engineer 127.50, Tech Domain expense 25 ✔ |
| 14 | Customer invoice `POST /invoices` (GST 10 %, 30 days) → invoice **INV-#110** | GENERATED: subTotal **574.00**, tax **57.40**, grandTotal **631.40** ✔ |
| 15 | Engineer invoice `POST /invoices/engineer` (role FREELANCER, engineer bank account) → invoice **#111** | GENERATED: 127.50 / 127.50 ✔ |
| 16 | Send both (`PATCH /invoices/send/110`, `PATCH /invoices/engineer/send/111`) | both UNPAID; work order header now **Invoiced** on Tech Domain and customer side ✔ |
| 17 | E-mails (Mailinator) | customer: "Invoice INV-#110 – Tech Domain" from Tech Domain Accounts; engineer: "System-Generated Invoice for Completed Work" ✔ |
| 18 | Customer Invoices page | INV-#110 listed: 16 Oct 2026, 30 Days, Sub Total USD 574.00, Tax 10, Grand Total USD 631.40, due 15 Nov 2026 ✔ |
| 19 | Tech Domain Engineer Invoices list | #111 Syed Hamza UNPAID 127.50 USD ✔ |

No calculation issue from the accepted counter offer to the invoice: 58 × 6 + 3 × 62 = 534, + 40 expenses = 574, + 10 % GST = 631.40; engineer 15 × 4 + 4.5 × 15 = 127.50. Tech Domain's own expense (25) is not billed to the customer.

Observations (not calculation bugs):
- Customer Invoices page opens on the "Received" tab (status VERIFIED) which is empty; the freshly sent UNPAID invoice sits under the tab labelled "Approved". The counts (Received 0 / Approved 2) match the API, but the labels are confusing for a customer who just received an invoice.
- Engineers have no invoice view in the web app (all `/invoices*` endpoints → 403 for the FREELANCER role); the engineer invoice is handled by Tech Domain and e-mailed only. Looks intentional, mention if engineers are expected to see it.
- `taxAmount` is returned as `57.40000000000001` (float leftover, UI shows 10 / 631.40 correctly).

Evidence: `evidence/CounterOffer-EditBeforeAccept/wo-11078-approve-invoice/` (1 TD customer invoices, 2 TD engineer invoices, 3 TD WO Invoiced, 5 customer WO Invoiced, 6 customer invoice tabs, 9/10 Mailinator inboxes) and `evidence/WO-11067-CustomerPOEdit/retest-2026-10-16-wo-11078/` (PO step).
Test data: WO 1084 (#11078) APPROVED + Invoiced, invoices 110 (customer, UNPAID 631.40) and 111 (engineer, UNPAID 127.50).

## Part 3 (2026-10-16 07:05 UTC) – customer invoice marked Paid (done manually by the user in the Tech Domain UI)
- INV-#110 status history: GENERATED (06:54) → UNPAID (06:56, sent) → **PAID** (07:05, by istkhar Hussain / user 27, with a proof image uploaded to `invoices/110/`). No separate "Verified" step was needed.
- Tech Domain Customer Invoices → Paid tab: INV-#110, 16 Oct 2026, 30 Days, Paid, Sub Total USD 574.00, Tax 10, Grand Total USD 631.40, Approved by Istkhar Hussain (`4_td-paid-tab.png`). Amounts unchanged after payment ✔
- Customer Invoices → Paid tab shows the same row (`6_customer-paid-tab.png`); customer notification "Invoice Paid – INV-110 · istkhar Hussain has paid this invoice." (`8_customer-bell-invoice-paid.png`).
- Work order: Tech Domain header **Invoiced** (`5_td-wo-header.png`), customer header **Paid** (`7_customer-wo-header.png`); API status INVOICED, customerStatus PAID ✔
- Engineer invoice #111 is still UNPAID (not marked paid).

Observation: the customer notification text says "istkhar Hussain has paid this invoice" – it is the customer who paid; wording should be "Your payment for INV-110 has been received / invoice marked as paid".
Evidence: `evidence/CounterOffer-EditBeforeAccept/wo-11078-invoice-verify-paid/`.
