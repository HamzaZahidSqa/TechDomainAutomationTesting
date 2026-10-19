# WO #10982 (id 988): can it be cancelled after the vendor engineer checked in?

Date: 2026-10-14 · Environment: https://dev.techdomain.com.au · WO created by Tech Domain user 27 · Assigned to vendor "Demo Field Services 0925" (owner 609), member engineer 611 "Demo Worker"

## State at time of check
- Status **INPROGRESS**, sub-status **CHECK_IN** ("In Progress / Checked In" in the UI).
- Engineer 611 checked in at 2026-10-14 04:56 UTC (timeLog 959), not checked out. Offer 2438 ASSIGNED.
- Qualification requirement was removed earlier today (`PATCH /workOrders/988 {qualificationSubTypes: []}`).

## Answer: No — nobody can cancel it in this state
| Role | UI (details page) | API call | Result |
|---|---|---|---|
| Tech Domain (CLIENT, user 27) | No "Cancel" button (only Copy, Save as Template, Tags, Print, Report problem, Add Note, Create New Task) | `POST /workOrders/client/cancel/988 {cancellationReason: PROJECT_POSTPONED}` | 400 "Work Order not found" |
| Vendor owner (609) | No cancel button (Print, Report problem) | `POST /workOrders/engineer/cancel/988 {cancellationReason: SITE_ACCESS_ISSUES}` | 400 "Work Order not found" |
| Vendor Engineer (611, assigned) | No "Cancel Assignment" button — only **Check out** | `POST /workOrders/engineer/cancel/988 {...}` | 400 "Work Order not found" |
| Customer (portal user) | — | `POST /workOrders/client/cancel/988` | 403 Forbidden |
| Admin | — | `POST /workOrders/client/cancel/988` | 403 Forbidden |

"Work Order not found" is the backend's way of saying the work order is not in a cancellable state for that caller (the lookup is filtered by status); the same message comes back for an empty or invalid payload, so validation is not the cause.

## Who can cancel, and when (from the web app's rules)
- **Tech Domain (CLIENT)** — "Cancel" button → `POST /workOrders/client/cancel/:id`, only while status is **ASSIGNED** (engineer assigned, not yet started). Reasons: Client Requested Cancellation, Site Access Unavailable, Project Postponed, Parts Not Available, Issue Resolved Remotely, Other.
- **Assigned engineer (FREELANCER: individual engineer or vendor member)** — "Cancel Assignment" → `POST /workOrders/engineer/cancel/:id`, only while sub-status is **NOT_CONFIRMED, CONFIRMED or READY_TO_GO**. Reasons: Medical Emergency, Family Emergency, Bereavement, Customer Rescheduled, Site Access Issues, Other. Affects the engineer's cancellation rate.
- **Customer, Admin** — no cancel action (403 on the API).
- Before assignment (PUBLISHED / ROUTED) Tech Domain can **Unpublish / Move to Draft** instead of cancelling.

Once the engineer has **checked in** (INPROGRESS / CHECK_IN) cancellation is closed for everyone. The remaining path is: engineer **Check out** → work done → Tech Domain marks it Incomplete / Verified / Approved via the normal completion flow.

Files: `TechDomain_workOrder-details-988.png`, `Vendor_workOrder-details-988.png`, `VendorEngineer_workOrder-details-988.png`, `cancel-api-log.txt`.
