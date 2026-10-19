# TD-167 – Customer should only receive notifications for sub-statuses that are visible to the customer

## Re-test 2026-10-16 10:17–10:30 UTC · run `run-1016101746` · WO 1089 (#11083) · Verdict: **PASS with one gap (PO Pending)**

Dev backend changed between the 04:44 run and this run (frontend bundle unchanged, main.9c79992f). The customer API now returns the technician sub-statuses and the notification rule matches visibility.

| Sub-status | Tech Domain sees | Customer sees (API + UI badge) | Customer notification | Expected | Result |
|---|---|---|---|---|---|
| NOT_CONFIRMED | Not Confirmed | hidden (null) | none | none | PASS |
| CONFIRMED | Confirmed | hidden (null) | none (was notified in the 04:44 run) | none | PASS |
| READY_TO_GO | Ready to go | **Ready to go** | "Engineer Ready to Go – WO-11083" | notify | PASS |
| ON_THE_WAY | On the way | **On the way** | "Engineer En Route – WO-11083" | notify | PASS |
| RUNNING_LATE | Running Late | **Running Late** | "Engineer Running Late – WO-11083" | notify | PASS |
| CHECK_IN | Checked In | **Checked In** | "Engineer Checked In – WO-11083" | notify | PASS |
| CHECK_OUT | Checked Out | **Checked Out** | "Engineer Checked Out – WO-11083" | notify | PASS |
| WORKDONE (status) | Work Done | Work Done | "Work Order Completed – WO-11083" | status change | info |
| REVIEWED | Reviewed | hidden (null) | none | none | PASS |
| VERIFIED / PO_PENDING | PO Pending | **PO Pending** (badge shown) | none | notify | **FAIL (gap)** |
| APPROVED (status) | Approved | Approved | "Your work order has been approved." | status change | info |

Notification text names the engineer and matches the customer-visible label (e.g. "Syed Hamza has checked in and ready to begin the work."). Customer sub-user (639) got nothing (expected, WO created by the owner). Tech Domain control got Confirmed / Ready to Go / En Route / Running Late / Completed.

Remaining gap: **PO Pending** is visible to the customer (screenshot 05) but no notification is created at VERIFIED/PO_PENDING (screenshot 06). Ticket expected result says notify for every customer-visible sub-status, so this is the missing half. Everything the ticket lists as "Actual Result" (hidden sub-statuses notifying) is fixed.

Evidence: `run-1016101746/` (results.json, summary.txt, screenshots 01–07). Test data left on dev: WO 1089 (#11083) APPROVED, engineer 575.

---

## Original run 2026-10-16 04:44 UTC (before the backend change) – kept for history

Ticket: https://techdomain.atlassian.net/browse/TD-167 (Feature, Medium, label Backend, status QA In Progress, no linked PR)
Environment: https://api.dev.techdomain.com.au/api, https://dev.techdomain.com.au
Spec: `tests/td-167-customer-substatus-notifications.spec.js` · Run: `run-1016044419` (2026-10-16 04:44–04:52 UTC)

## Verdict: **FAIL** – the behaviour described in the ticket is still present on dev. The customer sees none of the technician sub-statuses (Confirmed, Ready to go, On the way, Running Late, Checked In, Checked Out: customer API `subStatus: null`, no badge in the customer list/detail), yet the customer owner receives an in-app notification for every one of them. Only "Reviewed" is correctly silent. "PO Pending", the one sub-status the customer does see, produces no notification.

## Flow
Customer owner 638 created WO 1083 (#11077) via API → Tech Domain 27 completed the client fields + approvePublish → routed to individual engineer 575 "Syed Hamza" → accepted → assigned (NOT_CONFIRMED) → schedule moved to now → engineer confirm, ready to go, on the way, running late, check-in, check-out, mark complete → Tech Domain REVIEWED → verify (PO_PENDING) → approve.
At every step the test read: Tech Domain `GET /workOrders/1083`; customer `GET /workOrders/1083` + `GET /workOrders/customer?search=11077`; new rows in `GET /notifications/others` for the customer owner, the customer sub-user (639) and Tech Domain. Customer detail page + bell panel were screenshotted after the technician sub-statuses, after Reviewed and after PO Pending.

## Result per sub-status

| Step | Tech Domain sees | Customer sees (API detail / list / UI badge) | Customer notification | Expected | Result |
|---|---|---|---|---|---|
| NOT_CONFIRMED | ASSIGNED / Not Confirmed | ASSIGNED / – (hidden) | none | none | PASS |
| CONFIRMED | ASSIGNED / Confirmed | ASSIGNED / – (hidden) | "Work Order Confirmed by Engineer – WO-11077" | none | **FAIL** |
| READY_TO_GO | ASSIGNED / Ready to go | ASSIGNED / – (hidden) | "Engineer Ready to Go – WO-11077" | none | **FAIL** |
| ON_THE_WAY | ASSIGNED / On the way | ASSIGNED / – (hidden) | "Engineer En Route – WO-11077" | none | **FAIL** |
| RUNNING_LATE | ASSIGNED / Running Late | ASSIGNED / – (hidden) | "Engineer Running Late – WO-11077" | none | **FAIL** |
| CHECK_IN | INPROGRESS / Checked In | INPROGRESS / – (hidden) | "Engineer Checked In – WO-11077" | none | **FAIL** |
| CHECK_OUT | INPROGRESS / Checked Out | INPROGRESS / – (hidden) | "Engineer Checked Out – WO-11077" | none | **FAIL** |
| WORKDONE (status) | WORKDONE / – | WORKDONE / – | "Work Order Completed – WO-11077" | status change, allowed | info |
| REVIEWED | WORKDONE / Reviewed | WORKDONE / – (hidden) | none | none | PASS |
| VERIFIED (status) | VERIFIED / PO Pending | VERIFIED / PO Pending | none | – | info |
| PO_PENDING | VERIFIED / PO Pending | VERIFIED / **PO Pending** (visible, badge shown) | none | notification | **FAIL** (gap) |
| APPROVED (status) | APPROVED / PO Pending | APPROVED / PO Pending | "Your work order has been approved." | status change, allowed | info |

Tech Domain (control) received the same Confirmed / Ready to Go / En Route / Running Late / Completed notifications; Checked In / Checked Out go to the customer only. The customer sub-user received nothing (expected: sub-users are notified only for work orders they created).

## Findings
1. **Hidden technician sub-statuses still notify the customer** (6 of 6). Screenshot 01 shows the customer detail page at CHECK_OUT with only the "In Progress" badge and no sub-status; screenshot 02 shows the same customer's bell with "Engineer Checked Out / Checked In / Running Late / En Route / Ready to Go / Confirmed – WO-11077" (badge 8 unread). This is exactly the ticket's "Actual Result".
2. **REVIEWED is correctly silent** for the customer (screenshot 04: bell unchanged after Tech Domain set Reviewed, screenshot 03: detail shows "Work Done" only).
3. **PO Pending is visible but never notified.** The customer detail shows "Work Done · PO Pending" (screenshot 05) but no notification was created at VERIFIED/PO_PENDING (screenshot 06). If the rule is "notify for every sub-status the customer sees", this is the missing half of the fix.
4. **Rule ambiguity to settle with dev.** TD-110's dev comment said "tech and PO pending sub-statuses will be visible to the customer", but on dev the customer API returns `subStatus: null` for all technician sub-statuses (same as in the TD-110 runs of 9 and 12 Oct). The fix for TD-167 must be consistent with that: either (a) the customer API/UI start showing the technician sub-statuses and the notifications stay, or (b) the notifications for Confirmed / Ready to Go / En Route / Running Late / Checked In / Checked Out are suppressed for customers. Today it is neither.
5. **Push notifications** could not be observed by the test (no device); the in-app rows are the same backend notification records, so the push side will follow whatever the backend does with these records.
6. Notification text, where a notification exists, names the engineer and describes the event ("Syed Hamza has checked in …"), but it never uses the customer's status wording because the customer has no sub-status to compare against.

## Evidence
`evidence/TD-167-CustomerSubStatusNotifications/run-1016044419/`
- `results.json` – every API call, the customer/Tech Domain view per step, every notification row (id, type, title, content, createdAt) per viewer, UI texts.
- `summary.txt` – per-step table + PASS/FAIL/INFO list (33 checks: 22 PASS, 7 FAIL, 11 INFO).
- `TD-167_SubStatusNotifications_01_after-technician-substatuses-customer-detail.png` – customer detail at CHECK_OUT, no sub-status badge.
- `TD-167_SubStatusNotifications_02_after-technician-substatuses-customer-bell.png` – customer bell with 6 technician sub-status notifications.
- `TD-167_SubStatusNotifications_03/04_after-reviewed-*.png` – Reviewed hidden, bell unchanged.
- `TD-167_SubStatusNotifications_05/06_after-po-pending-*.png` – PO Pending badge visible, no notification.
- `TD-167_SubStatusNotifications_07_techdomain-bell-control.png` – Tech Domain bell (control).

Test data left on dev: WO 1083 (#11077) APPROVED, engineer 575.
Re-test: `npx playwright test tests/td-167-customer-substatus-notifications.spec.js --reporter=line --trace off` (creates a new WO; `WO_ID=<assigned wo>` reuses one).
