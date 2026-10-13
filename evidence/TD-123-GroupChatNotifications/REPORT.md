# TD-123 group chat + notifications verification (dev, 2026-10-09)

Spec: `tests/td-123-group-chat-notifications.spec.js`
Final runs: `run-1009112549` (scenarios S1-S4 with the agreed sub-user rule + UI evidence), `run-1009103733` (status walk ACCEPTED -> CONFIRMED on WO 962), `run-1009104109` (status walk CHECK_IN -> APPROVED on WO 962).
PDF: `TD-123-Verification-Report.pdf` (also in ~/Downloads).

## Rule under test (agreed with the tester)
The work-order group chat contains the customer owner, the Tech Domain owner and the Tech Domain team members. The customer sub-user is included ONLY when the sub-user created the work order; otherwise the sub-user must get no chat, no messages and no notifications. Nobody outside the group may see the room or receive its notifications.

## Accounts

| Role | User id | Email | Password |
|---|---|---|---|
| Customer owner (Customer Company 10090955, Tech Domain company) | 638 | customer-10090955@mailinator.com | B4!Z7z9pPkuz |
| Customer sub-user | 639 | td123-subuser-1009101529@mailinator.com | Td123Pass@2026x |
| Tech Domain owner | 27 | istkhar+2@techdomain.com.au | Hussain@512 |
| Tech Domain team member (Service Delivery 3) | 640 | td123-tdteammember-1009101529@mailinator.com | Td123Pass@2026x |
| Tech Domain user in NO team (leak control) | 641 | td123-tdnonteamuser-1009101730@mailinator.com | Td123Pass@2026x |
| Other-company customer (Neomeric, leak control) | 617 | td36-customer-0929@mailinator.com | Td36Pass@123 |
| Vendor owner (leak control) | 609 | td-demo-company-0925@mailinator.com | TdDemo@2026x |
| Individual engineer (leak control / assigned engineer in the walk) | 575 | Ha@mailinator.com | Hacktime123@ |

## Scenario results (final run)

| Scenario | WO | Result |
|---|---|---|
| S1 Customer owner creates | 965 (WO-10959) | 64/68 - room = owner + TD owner + team, sub-user correctly excluded (403, no notifications, no acceptance notification); TD owner + team member get "New Work Order Received" (TD-124); owner gets "Work Order Accepted" (TD-125). Only the 4 leak checks fail. |
| S2 Customer sub-user creates | 966 (WO-10960) | 60/64 - room = owner + sub-user + TD owner + team; all 4 see all 4 messages with notifications; owner AND sub-user get "Work Order Accepted". Only the 4 leak checks fail. |
| S3 Tech Domain owner creates | 967 (WO-10961) | 57/61 - sub-user correctly excluded; customer owner gets "Work Order Published". Only the 4 leak checks fail. |
| S4 TD team member creates | 968 (WO-10962) | 57/61 - same as S3. |

## Status walk (WO 962, created by the sub-user)
Accepted -> REQUESTED -> COUNTER -> ASSIGNED -> CONFIRMED -> CHECK_IN -> CHECK_OUT -> WORKDONE -> VERIFIED -> APPROVED. Group chat kept working for owner, sub-user, TD owner and team member at every status; the engineer never had access to the customer room. Status notifications: REQUESTED/COUNTER -> TD owner + team; ASSIGNED -> owner + sub-user + engineer; CONFIRMED/CHECK_IN/CHECK_OUT -> owner + sub-user + team member; WORKDONE -> owner + sub-user + TD owner + team member; VERIFIED -> nobody; APPROVED -> owner + sub-user + engineer. Outsiders: nothing.

## Findings (bugs)
1. **Data leak: any Tech Domain company user can join a customer conversation by opening its URL.** User 641 (no team, not owner) opened `/workOrder/messages/<wo>?engineerId=638`; the socket join added them as a participant; afterwards the REST API returns the thread (200), they can post and they receive MESSAGE notifications. Reproduced on all work orders of every run.
2. **Security: `GET /teams/:id` returns every member's bcrypt password hash** (`members[].teamMember.password`).

Informational: the stored MESSAGE notification url is `/workOrder/messages/<wo>?engineerId=null`, but the web app opens the right room via `chatRoomId` (verified manually). Customer owner notification on TD-created work orders was missing in the 15:33 run and present from the 16:25 run (probable deploy in between) - re-check before closing.

Working as designed: sub-user gets nothing for work orders they did not create; marketplace broadcast to nearby engineers/vendors on publish; creator never notified of own action; engineer never in the customer room.

## Dev data created/changed
Customer 103 approved (branch 1, SD3 + Op3); users 639/640/641 created, 640 added to Service Delivery 3; work orders 955-968; WO 962 walked to APPROVED with engineer 575; WO 957 assigned to engineer 575.
