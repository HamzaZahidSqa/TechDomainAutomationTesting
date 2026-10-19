# Chat module - full regression across every work-order state (dev, 2026-10-15)

Spec: `tests/chat-module-full.spec.js` · Run: `run-1015060616` (results.json, summary.txt, 18 screenshots) · Environment: https://dev.techdomain.com.au

## What was tested
Three work orders were driven through every state by API, and at **every state** the test audited every chat room of the work order:
1. which rooms exist and who is in them (compared with the expected set per role);
2. every participant we control posts a message, every other participant must see it and get a MESSAGE notification, the sender must not;
3. every non-participant (9 accounts, all roles) must not list, read, join or post in the room and must get no MESSAGE notification (also no cross-room leak between the customer room and the engineer/vendor rooms);
4. who received the status notification for the transition, and that nobody else did;
5. end of each flow: outsiders try to join each room with `POST /chats/room/group`, plus UI screenshots per role.

| Flow | Work order | Path | Checks |
|---|---|---|---|
| A | #11068 (id 1074), created by Tech Domain | engineer 575 requests -> counter -> assigned -> confirmed -> check-in -> check-out -> work done -> verified -> approved | 1007 / 1040 |
| B | #11069 (id 1075), created by Tech Domain | routed to vendor 609 -> vendor accepts for member 611 -> assigned -> confirmed -> ... -> approved | 983 / 1043 |
| C | #11070 (id 1076), raised by the customer | submitted -> accepted -> routed to engineer -> accepted -> assigned -> un-assigned -> re-assigned -> cancelled by client | 756 / 774 |

Accounts: TD owner 27, TD team member 640 (Service Delivery 3), TD user in no team 641, customer owner 638, customer sub-user 639, individual engineer 575, vendor owner 609, vendor engineer 611, other-company customer 617.

## What is correct (no action needed)
- **Group membership per role is right in every state.** Customer room = customer owner + TD owner + both teams (263, 473, 476, 640). Engineer room = engineer + TD owner + teams. Vendor owner room = vendor owner + TD owner + teams. Nobody missing, nobody extra, in all 3 flows and all states (until the join-probe at the end, see bug 3). The sub-user (did not create the WO) is in no room, gets no message and no notification, as agreed.
- **Message delivery inside a room works** at every state: every participant sees every message; MESSAGE notifications go to every other participant and never to the sender (one exception, see observation 5).
- **Reading is protected**: outsiders get 403 on `GET /inbox/:room` and `GET /chats/:room` and never see the room in their inbox; no MESSAGE notification ever reached an outsider or crossed rooms (engineer-room messages never appear in the customer room and vice versa).
- **Status notifications go to the right people, nothing leaks**: REQUESTED/COUNTER/ACCEPT -> TD owner + team; ROUTED -> routed engineer/vendor; ASSIGNED -> engineer (+ vendor owner) + customer owner; CONFIRMED/CHECK_IN/CHECK_OUT -> team + vendor owner + customer; WORK_DONE -> TD owner + team + customer; APPROVED -> customer + engineer; UNASSIGNED -> engineer; CANCELLED -> engineer + team + customer; customer ticket submitted -> TD owner + team; published/accepted -> customer owner. The sub-user, the non-team TD user, the other-company customer and the uninvolved vendor/engineer received **nothing** in any state.
- Chat keeps working for the group after un-assign, re-assign, cancel and approval.

## Bugs found

### 1. Message leak: engineers and vendors can post into the customer <-> Tech Domain room (HIGH)
Any FREELANCER who has an offer or assignment on the work order can `POST /inbox/<customerRoom>/message` and the message lands in the customer conversation, although `GET` on the same room correctly returns 403 for them.
- Flow A: engineer 575 posted into customer room 1921 at REQUESTED, COUNTER, ASSIGNED, CONFIRMED, CHECK_IN, CHECK_OUT, WORKDONE, VERIFIED and APPROVED (HTTP 201 every time).
- Flow B: vendor owner 609 from ROUTED onward, vendor engineer 611 from ROUTE ACCEPTED onward, into customer room 1928.
- Flow C: engineer 575 from ROUTED through UNASSIGNED, RE-ASSIGNED and CANCELLED, into customer room 1933.
- The customer sees these messages and gets MESSAGE notifications for them (customer 638 has 3 MESSAGE notifications from sender 575 for room 1921). Screenshots: `ChatModule_03_A-customer-owner-chat.png` ("LEAK TEST ... from Individual engineer" in the customer thread), `ChatModule_13_B-td-owner-chat.png` (customer room preview "Demo: LEAK TEST B APPROVED", unread 3).
- Same hole one level down: vendor engineer 611 can post into the vendor owner's room 1929 (HTTP 201) while `GET` is 403.
- Rule violated: "A FREELANCER may never open or create the customer room"; the send check (`canUserSendMessageInRoom`) accepts the assigned/offering engineer for **any** room of the work order instead of only their own engineer room.

### 2. (NOT A BUG - by design, confirmed by the tester 2026-10-15) Tech Domain users outside the work-order teams can open the customer conversation
User 641 (Tech Domain, member of no team) joined customer rooms 1921, 1928 and 1933 by opening `/workOrder/messages/<wo>?engineerId=638` (and via `POST /chats/room/group`), then read the thread, posted and received MESSAGE notifications (`ChatModule_18_C-nonteam-chat.png`). The tester confirmed this is the intended behaviour: Tech Domain and all of its users are assigned together and every Tech Domain user may message. The spec now treats the non-team Tech Domain user as an allowed on-demand member (not an outsider) and expects them to join on open. The earlier TD-123 finding 1 is closed as "by design".

### 3. Assigned vendor engineer gets no chat room with Tech Domain (MEDIUM)
When Tech Domain assigns a vendor member (`POST /offers/assign {userId: 609, referredEngineerId: 611}`), no room is created for the member (rule says it should be created proactively). Through CONFIRMED, CHECK_IN, CHECK_OUT, WORK_DONE, VERIFIED and APPROVED Tech Domain's chat list had only the vendor **owner** row and the customer row; there was no way for Tech Domain to message the engineer who was actually on site. The member room (1931) only appeared when the vendor engineer opened the Messages tab after approval (`ChatModule_08_B-vendor-engineer-chat.png`: empty "Demo Field Services 0925" room next to the owner's room; both rows carry the company name, so the engineer cannot tell them apart).

### 4. Customer stopped receiving MESSAGE notifications for room 1921 from CONFIRMED onward (MEDIUM, needs a re-check)
Flow A, customer room 1921: the customer got MESSAGE notifications for Tech Domain's messages at PUBLISHED, REQUESTED, COUNTER and ASSIGNED, then none at CONFIRMED, CHECK_IN, CHECK_OUT, WORKDONE, VERIFIED, APPROVED, and still none for a fresh TD message sent after the run (while fresh messages in rooms 1928 and 1933 of the same customer do produce notifications). The messages themselves are delivered. Most likely cause: a customer session was "viewing" room 1921 (the gateway suppresses notifications for the viewer and uses room membership when the socket never reported visibility). If the tester had WO #11068's chat open as the customer during the run this is expected; otherwise it is a bug where the viewing state is never cleared. Re-check by sending a TD message to room 1921 while no customer browser is open.

### 5. Minor
- The actor gets notified of their own action: TD owner receives ACCEPT "<engineer> has accepted." when TD owner assigns (flows B and C, ASSIGNED).
- Customer owner receives the WORK_ORDER_CANCELLED notification **twice** for the same cancellation (flow C, WO 1076).
- The customer is told "engineer assigned" but gets **no** notification when the engineer is un-assigned (flow C). The TD owner gets no CHECK_IN / CHECK_OUT notification (team only); the vendor owner gets no WORK_DONE / APPROVED notification; VERIFIED notifies nobody. These follow the code rules but may not match what the product wants.
- MESSAGE notification url for the customer room is still `/workOrder/messages/<wo>?engineerId=null` (known, informational).

## Observations (confirm with product)
- A **"Job Discussion"** room is created automatically when the engineer confirms (CONFIRMED) on flows A and B. Participants: customer owner + the assigned engineer (575 / 611) + TD owner + both teams. It is the only place where the customer and the engineer share a room. It becomes read-only ("This chat was closed when the work order was marked as done") after WORK_DONE; outsiders (sub-user, vendor owner, others) get 403 on it. Not part of the agreed rule set, so it is reported here rather than as a bug.
- `GET /inbox/:id` participant lists exclude the viewer; the test unions two viewers to get the full list.

## Dev data created
Work orders 1074, 1075 (walked to APPROVED, engineers 575 / 611), 1076 (CANCELLED). Rooms 1921/1922/1925, 1928/1929/1931/1932, 1933/1934. User 641 is now a participant of rooms 1921, 1928 and 1933 and user 611 of 1929 (left as-is so the leak can be inspected).

## Re-run
`npx playwright test tests/chat-module-full.spec.js` (env `FLOWS=A,B,C` to pick flows, `SKIP_UI=1` to skip screenshots, ~40 min for all three flows). The spec was corrected after this run for three false alarms seen in summary.txt: "Customer owner notified at PUBLISHED" (the customer's notification is of type WORK_ORDER_PUBLISHED, which the first version filtered out as the marketplace broadcast - the probe confirmed the customer did get "Your work order has been published/accepted"), "work order sub-status is CANCELLED" (the status, not the sub-status, becomes CANCELLED), and the engineer "actor" notification at CHECK_IN (it was the schedule-change notification triggered by the test's own schedule patch).

## Re-test 2026-10-15 13:02 (after the reported API fix) - NOT FIXED
`scripts/retest-customer-room-send.js` (results `retest-customer-room-send-1015080246.json`, `-1015080325.json`):
- Fresh WO #11072 (id 1078, customer room 1938): engineer 575 with no offer -> 403 (correct); after `POST /offers/engineer/request` -> `POST /inbox/1938/message` = **201**; after assignment -> **201**. Both messages are in the customer's thread.
- Old WOs: engineer 575 still posts into 1921 (#11068) and 1933 (#11070); vendor owner 609 and vendor engineer 611 still post into 1928 (#11069). All 201.
- Legitimate sends unchanged (customer, TD owner, team member in customer rooms; engineer/vendor in their own rooms); outsiders without an offer still get 403.

### Re-test 2026-10-15 13:10 (second run, fix now visible) - PARTIALLY FIXED
- Engineer with only a request/offer (not assigned): `POST /inbox/<customerRoom>/message` now returns **403** (fresh WO #11073, id 1079, room 1940). Fixed.
- **Assigned** engineer: still **201**. Fresh WO #11074 (id 1080, room 1942): after `POST /offers/assign` the engineer posted "leak retest" into the customer room (`requested-engineer-room-1015080757/results.json`). Old assigned WOs #11068 (room 1921), #11070 (1933) and vendor #11069 (owner 609 and engineer 611 into 1928) also still 201.
- Not affected by the fix: legitimate senders unchanged; engineer's own room open/send works at REQUESTED (API) and ASSIGNED (API + UI). At REQUESTED the engineer UI has no Messages tab at all (Details/Payment only), which is the existing design: Tech Domain starts the chat from the Providers tab.
Dev note: the send check still allows the assigned engineer / assigned vendor owner and member into the customer room (`isCustomerChat` / `userId` room with `engineerId = null`). The assigned-engineer branch of `canUserSendMessageInRoom` must also be limited to the engineer's own room.
