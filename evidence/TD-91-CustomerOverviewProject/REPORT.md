# TD-91 – Hide project details from overview for customer role

Ticket: https://techdomain.atlassian.net/browse/TD-91 (Task, Highest, label Frontend, QA In Progress, 1 PR OPEN on 2026-10-12)
Environment: https://dev.techdomain.com.au (bundle main.af2f4820.js) / https://api.dev.techdomain.com.au/api
Spec: `tests/td-91-hide-project-customer-overview.spec.js` · Run: `run-1013050352` (2026-10-13)

## Verdict: **PASS** – the work order Overview card and the customer "Edit Overview" / "Create Work Order" forms no longer show project details to CUSTOMER users (owner and sub-user); Tech Domain (CLIENT) users still see them.

Accounts: Customer owner td36-customer-0929@mailinator.com (user 617, customer 93), Customer sub-user td36-subuser3-0930@mailinator.com (624), Tech Domain user istkhar+2@techdomain.com.au (27, CLIENT).
Work orders: 867 (customer 93, APPROVED, project "TD36 QA Project"), 909 (customer 93, PUBLISHED, Overview editable), 252 (Tech Domain, project "DC Project").

| # | Check | Result |
|---|---|---|
| B1 | Customer owner › WO 867 › Details › Overview card rows = Company, Incident ID, Client, SLA – no "Project:" row, no project title anywhere on the Details tab | PASS |
| B3 | Customer Payment and Job Sign-Off tabs – no project details | PASS |
| B2 | Customer owner › WO 909 › Overview pencil › "Edit Overview" form fields = Title, Incident ID, Entity, SLA – no Project field | PASS |
| B3 | Customer › Create Work Order (summary) – no Project field | PASS |
| B4 | Customer sub-user › WO 867 › Overview – no "Project:" row | PASS |
| B5 | Control: Tech Domain user › WO 252 › Overview shows "Project: DC Project"; Edit Overview form has "Project *" | PASS |
| A1/A2 | API: customer `GET /workOrders/867` and `GET /workOrders/customer` still return `project {id,title}` | INFO (backend, outside this Frontend ticket) |
| B6 | Customer Work Orders grid still has a "Project" column (ID, Incident ID, Client, **Project**, Status, Title, …) showing "TD36 QA Project" | INFO / observation |
| B6 | Customer dashboard – no project mention | INFO |

Implementation seen in the bundle: Overview row `authRole === CLIENT && <Project:…>`; the summary/edit form renders the Project select only when `authRole !== CUSTOMER`.

## Observations (for the ticket owner to decide)
1. The customer **Work Orders list** still shows a "Project" column with the project title (screenshot 01). If "project details" should be hidden from customers everywhere, this column needs the same treatment.
2. The API still sends the `project` object to customers (`/workOrders/:id`, `/workOrders/customer`), so the data is only hidden in the UI.

## Evidence
`evidence/TD-91-CustomerOverviewProject/run-1013050352/` – results.json, summary.txt, screenshots:
01 customer work-orders list (Project column) · 02 customer Overview card · 03 customer details full page · 04 customer Edit Overview form · 05 customer Create WO form · 06 customer sub-user Overview card · 07 Tech Domain Overview card with Project · 08 Tech Domain Edit Overview with Project.
No data was created or changed.
