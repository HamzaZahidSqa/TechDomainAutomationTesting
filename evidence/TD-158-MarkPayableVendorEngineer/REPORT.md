# TD-158 – Mark payable not working when work order is assigned to vendor's engineer

Ticket: https://techdomain.atlassian.net/browse/TD-158 (Task, Highest, Backend/Hotfix, status "QA In Progress", 4 PRs merged, no description)
Tested 2026-10-16 10:56–11:20 UTC on dev · Spec `tests/td-158-mark-payable-vendor-engineer.spec.js` · Run `run-1016105604`
Rule from the web app: Tech Domain sees **Mark Payable** on a CANCELLED work order → confirm "Confirm Payable" → `POST /workOrders/:id/markPayable` → toast "Work Order Payable" → work order stays CANCELLED with `customerStatus = CANCELLED_PAYABLE` (badge "Cancelled → Payable").

## Verdict: PASS – Mark Payable works for the vendor's engineer exactly as for an individual engineer.

| Step | Vendor engineer (WO 1094 / #11088, member 611 of company 79, owner 609) | Individual engineer (WO 1095 / #11089, engineer 575) – control |
|---|---|---|
| Tech Domain creates (template 242, client 97), routes, vendor accepts for member, assign | ASSIGNED, engineer 611, company 79 ✔ | ASSIGNED, engineer 575 ✔ |
| Tech Domain cancels (`POST /workOrders/client/cancel`, Client Requested) | CANCELLED ✔ | CANCELLED ✔ |
| "Mark Payable" button on the Tech Domain detail page | shown ✔ (01) | shown ✔ (06) |
| Click → "Confirm Payable" dialog → Mark Payable | `POST /workOrders/1094/markPayable` 201, toast "Work Order Payable" ✔ (02, 03) | 201, toast ✔ (07, 08) |
| Result | status CANCELLED, customerStatus **CANCELLED_PAYABLE**, header "Cancelled → Payable" ✔ (04, 05) | same ✔ (09, 10) |
| Vendor owner / member / engineer view | owner and member both see "Cancelled Payable" (11, 12) | engineer sees "Cancelled Payable" (13) |
| Engineer invoice for the payable WO (`POST /invoices/engineer`, engineerId = vendor owner 609) | invoice #116 GENERATED, WO → INVOICED ✔ | invoice #117 GENERATED, WO → INVOICED ✔ |

No difference between the two engineer types at any step, so the vendor-engineer bug in the ticket is fixed on dev.

## Observations (same for BOTH engineer types – not part of this ticket, please confirm intent)
1. **Payable amount is 0.** `estimatedPayment.engineerRates` for a payable WO returns `totalLabourCost 60` (15/h × 4 min h) but `totalWorkOrderCost 0 / grandTotal 0`; the Tech Domain Payment tab shows "Engineer Rates USD 60.00 … Grand Total USD 0.00", header "Payment: Pending USD 0.00", and both engineer invoices (#116, #117) were generated with sub total / grand total **0.00**. Older cancelled-payable work orders on dev (#10087, #10230, #10231, #10233) show the same 0, and there are older 0.00 engineer invoices, so this is pre-existing behaviour, not a regression. If "payable" is meant to pay the minimum hours, the amount should be 60.
2. The engineer-side Payment tab still says "**No payment will be processed** as this work order has been cancelled by Service Provider" after it was marked Payable (12, 13) – contradicts the "Payable" badge.
3. Vendor **member** (Demo Worker) Payment tab shows "Engineer Rates () 0 / Estimated Payment 0" with empty brackets (11) – same display bug reported in `evidence/CounterOffer-Invoice-E2E/REPORT.md`.
4. After Mark Payable the Tech Domain page offers "Mark PO Pending" on a cancelled work order (05); `POST /workOrders/:id/approve` answers 404 "not in a state that can be approved", so the only follow-up is the invoice.

## Evidence
`evidence/TD-158-MarkPayableVendorEngineer/run-1016105604/` – results.json, summary.txt (verdict line reflects the first run's wrong status expectation; corrected in the spec), screenshots TD-158_01…10 (Tech Domain), 11 vendor member, 12 vendor owner, 13 freelancer.
Test data left on dev: WO 1094 and 1095 CANCELLED / CANCELLED_PAYABLE / INVOICED, engineer invoices 116 (vendor owner 609) and 117 (engineer 575), both GENERATED 0.00.
