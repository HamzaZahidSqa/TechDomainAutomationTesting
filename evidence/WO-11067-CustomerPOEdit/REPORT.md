# WO #11067 (id 1073): customer cannot add the Purchase Order (no Edit pencil on the Payment tab)

Date: 2026-10-15 · Environment: https://dev.techdomain.com.au · Customer owner user 638 (customer-10090955@mailinator.com, Customer Company 10090955) · Engineer 611 Demo Worker

## Observed
- Work order header: **Disputed → PO Pending**. On the customer's **Payment** tab there is no edit pencil next to "Payment (Hourly)", so the customer cannot open **Edit Purchase Orders** and add the PO number (`2_customer-payment-tab.png`).
- Comparison, same customer account:
  - WO 976 (#10970, Approved + PO Pending, no customer counter offer): pencil present → modal "Edit Purchase Orders" with **Add Purchase Order** (`compare-976/2_customer-payment-tab.png`, `compare-976/3_customer-payment-edit-modal.png`).
  - WO 983 (#10977, **Disputed** + PO Pending, no customer counter offer): pencil present (`compare-983/2_customer-payment-tab.png`). So the Disputed status is NOT what hides the pencil.

## Root cause (frontend, main.439de0cf.js, Payment tab component)
```
x = GET /offers/customer/counter/<woId> has status ASSIGNED (or ASSIGNED in offerHistory)
poOnly       = role CUSTOMER && (status in [PUBLISHED..APPROVED] || customerStatus == APPROVED || x)
hasUpdateAccess (customer) = permission CLIENT_WORK_ORDERS.update && !x && (status in [DRAFT,PENDING_APPROVAL,PUBLISHED] || poOnly)
pencil shown = (poOnly || ...) && hasUpdateAccess
```
On #11067 the customer counter offer 2477 (created by Tech Domain user 27, accepted by the customer on 2026-10-15 04:39) has status **ASSIGNED**, so `x` is true and `!x` hides the pencil permanently.
Any work order whose customer counter offer was accepted therefore never lets the customer edit payment or add a PO, even while the work order sits in PO Pending waiting for exactly that.

## Impact
PO Pending can never be cleared by the customer on counter-offer work orders. Tech Domain also has no PO edit on a Disputed/Approved work order (its edit is limited to Draft..Verified), so the PO can only be added via API (`PATCH /workOrders/<id>` with `purchaseOrders`).

## Suggested fix
Drop the `!x` condition (or limit it to the rate fields only) so the PO-only edit stays available when the work order is in PO Pending.

Files: `1_customer-details.png`, `2_customer-payment-tab.png` (#11067, no pencil); `compare-976/*` (pencil + Edit Purchase Orders modal); `compare-983/*` (Disputed WO still has the pencil). Script: `scripts/shot-wo-11067-customer-payment.js` (WO_ID env).

## Workaround applied 2026-10-15 (API, same call the Edit Purchase Orders modal makes)
As the customer owner (638): `POST /workOrders/1073/purchaseOrder` (multipart, field `purchaseOrders` = `[{"number":"PO-11067-QA","uid":"<uuid>"}]`, optional `files`) → 201 "Purchase Orders processed successfully".
Result: `purchaseOrders[0].number = PO-11067-QA`, sub-status cleared automatically (`subStatus: null`); header now shows only **Disputed** and the Payment tab lists "Purchase Order # PO-11067-QA" (`after-po/1_customer-details.png`, `after-po/2_customer-payment-tab.png`). Log: `fix-api-log.txt`.

## Re-test 2026-10-16 (bundle main.b0713520.js) – FIXED
WO 1084 (#11078): customer counter offer 2490 ASSIGNED (accepted edited counter), work order moved to VERIFIED / PO Pending via API.
- Customer owner 638 Payment tab now shows the edit pencil (2 pencil icons) → modal **Edit Purchase Orders** opens; all rate/expense fields are disabled (25 disabled inputs, PO-only mode), "Add Purchase Order" available (`retest-2026-10-16-wo-11078/2_customer-payment-tab.png`, `3_customer-payment-edit-modal.png`).
- Add Purchase Order → entered `PO-11078-QA` → Save Changes → `POST /workOrders/1084/purchaseOrder` 201. Payment tab shows "Purchase Order # PO-11078-QA", header "Work Done" only (PO Pending cleared), API `subStatus: null`, `purchaseOrders[0].number = PO-11078-QA` (`4_po-entered.png`, `5_after-save.png`).
Verdict: the pencil is no longer hidden by an accepted customer counter offer; the customer can clear PO Pending themselves. Original WO 1073 (#11067) is now APPROVED with PO-11067-QA (added by API on 10-15).
