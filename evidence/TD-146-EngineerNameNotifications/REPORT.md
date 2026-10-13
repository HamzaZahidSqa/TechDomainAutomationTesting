# TD-146 – Show engineer's name instead of generic "Engineer" in engineer-related notifications

Ticket: https://techdomain.atlassian.net/browse/TD-146 (Feature, Medium, labels Backend/Hotfix, QA In Progress, PR MERGED 2026-10-12)
Environment: https://api.dev.techdomain.com.au/api, https://dev.techdomain.com.au
Spec: `tests/td-146-engineer-name-in-notifications.spec.js` · Run: `run-1013060218` (2026-10-13, after the backend deploy)

## Verdict: **PASS** – after today's deploy every engineer-event notification (confirmed, ready to go, en route, running late, checked in, checked out, completed, offer accepted) carries the engineer's name in its text ("Syed Hamza has checked in …"). Two leftovers noted below.

Flow: customer owner 638 created WO 983 (#10977) → Tech Domain 27 completed + approvePublish → routed to individual engineer 575 "Syed Hamza" → engineer accepted → assigned → engineer confirm, ready to go, on the way, running late, check-in, check-out, mark complete (API, task ids = `tasks[].completedTask.id`) → WORKDONE. Notifications read via `GET /notifications/others` and in the UI bell panel.

| Recipient | Notification | Text after deploy | Result |
|---|---|---|---|
| TD + customer | Work Order Confirmed by Engineer – WO-10977 | **Syed Hamza** has confirmed the work order | PASS |
| TD + customer | Engineer Ready to Go – WO-10977 | **Syed Hamza** has marked the work order as Ready to Go | PASS |
| TD + customer | Engineer En Route – WO-10977 | **Syed Hamza** is now on the way to the service location. | PASS |
| TD + customer | Engineer Running Late – WO-10977 | **Syed Hamza** has reported a delay and may arrive later than originally scheduled. | PASS |
| customer | Engineer Checked In – WO-10977 | **Syed Hamza** has checked in and ready to begin the work. | PASS |
| customer | Engineer Checked Out – WO-10977 | **Syed Hamza** has checked out after completing the onsite activity. | PASS |
| TD + customer | Work Order Completed – WO-10977 | **Syed Hamza** has completed the required service activities. | PASS |
| TD | WO-10977 (ACCEPT) | **Syed Hamza** has accepted the routed offer. / has accepted. | PASS (already named before) |
| customer | Engineer Assigned – WO-10977 | View the work order for engineer details and service updates. | **no name** |
| UI | Customer and Tech Domain bell panels | all rows above show "Syed Hamza …" (screenshots 02, 03) | PASS |

Before the deploy (same day, WO 981 vendor worker "Demo Worker" and WO 954 "Syed Hamza", runs at 05:47–05:59 UTC) every one of these texts was still generic: "The assigned engineer has confirmed / checked in / …", "The engineer has completed …" – so the change is confirmed to come from the deploy.

## Leftovers / observations
1. **"Engineer Assigned – WO-x"** (customer, type WORK_ORDER_ASSIGNED) still has no engineer name: "View the work order for engineer details and service updates." If this counts as engineer-related it should become e.g. "Syed Hamza has been assigned to your work order".
2. Notification **titles** keep the generic word ("Engineer Checked In – WO-x", "Work Order Confirmed by Engineer – WO-x"); only the body names the engineer. Fine if the intent was the message text; mention if titles should change too.
3. Vendor-worker path (engineer belonging to a vendor company) was exercised only before the deploy (generic texts then). The same templates are used, so it should now be named too, but it was not re-run after the deploy.
4. Dev API returned 502 Bad Gateway for ~1 minute at 06:01 UTC (deploy window); the first spec run aborted there and was re-run.

## Evidence
`evidence/TD-146-EngineerNameNotifications/run-1013060218/` – results.json (every walk call + every notification with `hasName`), summary.txt, 01 customer bell panel (run), 02 customer bell panel after deploy, 03 Tech Domain bell panel after deploy.
Test data left on dev: WO 983 (#10977) WORKDONE for engineer 575; earlier today WO 981 (#10975, vendor worker 611) and WO 954 (#10948, engineer 575) were also walked to WORKDONE; WO 982 (#10976) created and published but not assigned.
