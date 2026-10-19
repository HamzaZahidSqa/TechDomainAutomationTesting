# Customer chat missing when Tech Domain creates the work order (WO #10979, id 985)

Date: 2026-10-13 · Environment: https://dev.techdomain.com.au · Customer entity 104 "Customer Company 10090955" (portal user 638) · Tech Domain owner user 27

## What was reported
Tech Domain created work order #10979 for the customer. Neither Tech Domain nor the customer can message each other on it.

## What we saw (screenshots in this folder)

| Work order | Created by | Status | Tech Domain → Messages tab | Customer → job page |
|---|---|---|---|---|
| #10979 (id 985) | Tech Domain (user 27) | Published / customer sees "Accepted", unassigned | Chat list empty: "No messages yet · No Conversation Selected" — no customer entry to click | Tabs: **Details, Payment only** — no Messages tab; `/workOrder/messages/985` just shows the overview |
| #10963 (id 969) | Customer (user 638) | Published / "Accepted", unassigned | Customer room listed ("Customer Company 10090955"), messages visible | Tabs: Details, Payment, **Messages** — chat works |
| #10975 (id 981) | Customer (user 638) | Assigned / Approved | Customer room + engineer rooms | Messages tab + "Job Discussion" |

Same customer entity, same company, same status family. The only difference is **who created the work order**.

API confirmation: `GET /chats/users/985/9` returns `[]` for Tech Domain and for the customer (no customer↔team room exists). For 981 it returns the room with `isCustomerChat: true`.

## Why (from the code checklist, §4 Chat & inbox rules)
- The customer↔team chat room is created automatically **only** when a customer raises the ticket (non-draft create or draft publish), and the on-demand "backfill" on `GET /chats/users/:wo/:company` also runs only for **customer-raised** work orders.
- When a CLIENT (Tech Domain) creates a work order for a customer, nothing creates the customer room. The web UI never offers a "start chat with customer" action, and the customer's job page hides the Messages tab when no room exists.
- The backend does support creating the room on demand: `POST /chats/room/group {workOrderId, companyId, engineerId: <customer user id>}` (the TD-123 test used exactly this when the room was missing). So this is a product gap, not a data problem.

## Suggested fix
Create the customer↔team room (or run the same backfill) when a CLIENT creates / publishes a work order whose `clientId` belongs to a customer with a portal user (entity or its parent), and show the Messages tab for the customer on those work orders.

## Workaround (until fixed)
Tech Domain (user 27) can create the room by calling `POST /chats/room/group` with `{workOrderId: 985, companyId: 9, engineerId: 638}`. After that both sides see the chat. Not applied, so the bug can still be reproduced on #10979.

Files: `TechDomain_2_-workOrder-messages-985.png`, `Customer_2_-workOrder-details-985-fromCustomerBoard.png`, `Customer_3_-workOrder-messages-985.png` (bug) · `*-WO969*.png`, `*-WO981*.png` (working comparison).

## Update 2026-10-13 12:03 — workaround applied on request
Tech Domain owner (user 27) called `POST /chats/room/group {workOrderId: 985, companyId: 9, engineerId: 638}` → room **1809** created (participants: customer 638, TD owner 27, team 473/263/476/640).
After this: Tech Domain's Messages tab lists "Customer Company 10090955"; the customer's job page now shows the Messages tab with "Tech Domain". Screenshots: `AfterFix-*.png`.
Note for developers: the bug is no longer reproducible on #10979; create a new work order as Tech Domain to reproduce.

## Re-test 2026-10-14 — FIXED
Tech Domain (user 27) created a new work order via `POST /workOrders` → **#10983 (id 989)**, PUBLISHED, unassigned, same customer entity 104.
- `GET /chats/users/989/9` immediately after create returns the customer room **1821** (`isCustomerChat: true`) for both Tech Domain and the customer — no manual `POST /chats/room/group` needed.
- Today's other Tech Domain-created work orders also have customer rooms: #10980 → 1810, #10981 → 1811, #10982 → 1814.
- UI end-to-end on #10983: Tech Domain's Messages tab lists "Customer Company 10090955"; message "TD to customer check 1014060807" sent. Customer's job page now shows **Details, Payment, Messages**; the customer sees the message under "Tech Domain", replied "Customer reply 1014060807", and Tech Domain received the reply. API `GET /chats/1821` lists both messages.
Screenshots: `Retest-2026-10-14/01..06_*.png`, log in `Retest-2026-10-14/log.txt`.
