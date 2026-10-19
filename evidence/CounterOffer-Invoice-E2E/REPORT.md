# Counter offer → work → invoices → paid, end to end for BOTH engineer types (2026-10-16)

Spec: `tests/counter-offer-invoice-e2e.spec.js` (two serial scenarios, API-driven with UI evidence at the end)
Runs: `freelancer-run-1016074524` (WO 1086 / #11080, engineer 575 Syed Hamza) and `vendor-run-1016074900` (WO 1087 / #11081, vendor owner 609 Demo CompanyOwner counters for member 611 Demo Worker, company 79).

Flow in both runs: customer owner 638 creates the WO (45/h, 5 h min, 50/h, Travel 30 = 255) → Tech Domain counter v1 (60/4/65 + Tools 20) → Tech Domain EDITS to v2 (58/6/62 + Parking 10) → customer accepts (→ 388) → Tech Domain publishes with engineer rates 15/4/15 → **engineer counter offer** (freelancer 20/4/22 · vendor 28/4/30 for member 611) → Tech Domain accepts the counter (ASSIGNED) → confirm / check-in / check-out / complete (WORKDONE) → Tech Domain edits the time log to 8 h 30 + adds company expense 25 → Reviewed → Verify → PO Pending → customer PO → Approve → customer invoice (GST 10 %, 30 days) → engineer invoice → send both → mark both PAID.

## Verdict: all calculations are correct for both engineer types, from the accepted counter offers to the paid invoices.

| Figure | Expected | Freelancer (WO #11080) | Vendor (WO #11081) |
|---|---|---|---|
| Customer rates after accepting the EDITED counter | 58 / 6 h / 62, Travel 30 + Parking 10 = 388 | 388 ✔ | 388 ✔ |
| Engineer rates after Tech Domain accepts the engineer counter | counter values | 20 / 4 h / 22 → 80 ✔ | 28 / 4 h / 30 → 112 ✔ |
| Customer labour with 8.5 h worked (billed 9 h, dev rounding rule) | 58×6 + 3×62 = 534 | 534 ✔ | 534 ✔ |
| Customer total (+ expenses 40) | 574 | 574 ✔ | 574 ✔ |
| Engineer labour with 8.5 h (pro-rata) | 20×4 + 4.5×22 = 179 / 28×4 + 4.5×30 = 247 | 179 ✔ | 247 ✔ |
| Tech Domain company expense 25 | internal only, not billed to the customer | ✔ (customer stays 574) | ✔ |
| Customer invoice | sub 574, GST 57.40, grand 631.40 | INV-#112 ✔ | INV-#114 ✔ |
| Engineer invoice | 179 / 247, no tax | #113 to engineer 575 ✔ | #115 to **vendor owner 609** ✔ |
| Send → UNPAID, WO INVOICED | | ✔ | ✔ |
| Mark as Paid (customer + engineer) | PAID, amounts unchanged, WO customerStatus PAID | ✔ | ✔ |
| Tech Domain Payment tab | 534.00 / 574.00, engineer total, TD expense 25.00 | ✔ (01) | ✔ (01) |
| Customer Payment tab | customer figures only, no engineer rate, no TD expense | ✔ (05) | ✔ (05) |
| Engineer / vendor owner Payment tab | engineer figures only, no customer figures | engineer 179.00 ✔ (07) | vendor owner 28.00 / 247.00 ✔ (08) |
| Tech Domain Engineer Invoices list (Paid tab) | invoice row with the engineer total | ✔ (vendor run 03: #115 Demo CompanyOwner 247.00; see note) | ✔ |

Vendor specifics confirmed: the vendor counter carries `referredEngineerId 611`; the WO is assigned to member 611 / company 79 at the vendor's rates; the engineer invoice is generated to the **company owner** (engineerId 609, role FREELANCER) with the owner's bank account (609 had none – the test added "QA Vendor Bank" as the vendor). The vendor owner, like a freelancer, gets 403 on every `/invoices*` endpoint (no invoice UI; the `/invoices` page shows "Unauthorized").

## Findings (not calculation errors)

1. **Vendor member sees a broken Payment tab.** Demo Worker (611, the engineer who actually did the job) opens the Payment tab and gets "Payment Terms ()", "Engineer Rates () 0" and "Total Payable 0" with empty parentheses (`vendor-run-1016074900/07_vendor-member-payment-tab.png`); the API returns an empty `engineerRates` for them. Hiding the company's rates from a member may be intended, but then the tab should be hidden or show a message instead of "0". The member's header also still says "Approved / Payment: Approved" while the owner's header says "Paid".
2. **"PO Pending" badge survives Approve/Paid when no PO was ever added.** In the freelancer run the PO call used the wrong payload (201 "Purchase Orders processed successfully" with `purchaseOrders: []` – the endpoint answers success for an empty/invalid payload, same pattern as companyExpenses). Approve still worked without a PO and the Tech Domain header now shows "Paid → PO Pending" (`freelancer-run-1016074524/01_td-payment-tab.png`). Either Approve should be blocked while PO Pending, or the sub-status should be cleared on approval. The vendor run used the correct FormData payload (`purchaseOrders=[{number,uid}]`) and PO Pending cleared normally.
3. **Vendor owner header label.** Owner's header shows "Payment:" with no status word above "USD 247.00" (freelancer's shows "Payment: Paid"). Cosmetic.
4. Already reported: customer rounding rule (≥ 15 min overrun → full hour), float leftovers (`taxAmount 57.40000000000001`), and the "istkhar Hussain has paid this invoice" notification wording (ticket drafted).

## Evidence
- `evidence/CounterOffer-Invoice-E2E/freelancer-run-1016074524/`: results.json, summary.txt, 01 TD Payment tab, 02 TD header, 03/04 TD invoice lists, 05 customer Payment tab, 06 customer invoices, 07 engineer Payment tab.
- `evidence/CounterOffer-Invoice-E2E/vendor-run-1016074900/`: same plus 07 vendor member Payment tab, 08 vendor owner Payment tab, 09 vendor owner /invoices page.
- Note: in the freelancer run the engineer-invoice list screenshot (03) was taken on the "Generated" tab (0 rows) – the spec now clicks the "Paid" tab; API confirms #113 PAID 179.
- Test data left on dev: WO 1086 (#11080) and 1087 (#11081) PAID; invoices 112/113 (freelancer) and 114/115 (vendor) all PAID; vendor 609 now has bank account "QA Vendor Bank".
