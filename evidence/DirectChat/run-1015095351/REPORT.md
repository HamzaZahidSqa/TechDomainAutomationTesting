# Direct Chat - A to Z test report (dev, 2026-10-15)

Run `1015095351` - 291 passed, 11 failed, 1 observations. Spec: `tests/direct-chat.spec.js`. Evidence: `evidence/DirectChat/run-1015095351/`.

## Rooms used

| key | room id |
|---|---|
| td_ENG2 | 1947 |
| td_VEN2 | 1948 |
| td_ENG1 | 1930 |
| td_VEN1 | 1924 |
| td_VENENG1 | 1926 |
| vendorPair | 1949 |

## Failures / bugs

- **06.ENG2.5** Room appears in BOTH sidebars (GET inbox?section=direct) - it was absent before for ENG2
  - expected: both listed, isDirectChat=true
  - actual: {"tdListed":false,"tgtListed":false,"tgtBeforeHadIt":false}
- **06.ENG2.7.4** MESSAGE notification to receiver (both directions)
  - expected: b has notif for "first TDTEAM->ENG2 dc1015095351", a has notif for "first ENG2->TDTEAM dc1015095351", url /messages/1947
  - actual: {"bGot":{"id":112862,"senderId":640,"title":"","url":"/messages/1947","content":"first TDTEAM->ENG2 dc1015095351","isRead":false},"aGot":null}
- **06.VEN2.5** Room appears in BOTH sidebars (GET inbox?section=direct) - it was absent before for VEN2
  - expected: both listed, isDirectChat=true
  - actual: {"tdListed":false,"tgtListed":false,"tgtBeforeHadIt":false}
- **06.VEN2.7.4** MESSAGE notification to receiver (both directions)
  - expected: b has notif for "first TDTEAM->VEN2 dc1015095351", a has notif for "first VEN2->TDTEAM dc1015095351", url /messages/1948
  - actual: {"bGot":{"id":112868,"senderId":640,"title":"","url":"/messages/1948","content":"first TDTEAM->VEN2 dc1015095351","isRead":false},"aGot":null}
- **07.ENG1.4** MESSAGE notification to receiver (both directions)
  - expected: b has notif for "again TDTEAM->ENG1 dc1015095351", a has notif for "again ENG1->TDTEAM dc1015095351", url /messages/1930
  - actual: {"bGot":{"id":112874,"senderId":640,"title":"","url":"/messages/1930","content":"again TDTEAM->ENG1 dc1015095351","isRead":false},"aGot":null}
- **07.VEN1.4** MESSAGE notification to receiver (both directions)
  - expected: b has notif for "again TDTEAM->VEN1 dc1015095351", a has notif for "again VEN1->TDTEAM dc1015095351", url /messages/1924
  - actual: {"bGot":{"id":112880,"senderId":640,"title":"","url":"/messages/1924","content":"again TDTEAM->VEN1 dc1015095351","isRead":false},"aGot":null}
- **07.VENENG1.4** MESSAGE notification to receiver (both directions)
  - expected: b has notif for "again TDTEAM->VENENG1 dc1015095351", a has notif for "again VENENG1->TDTEAM dc1015095351", url /messages/1926
  - actual: {"bGot":{"id":112886,"senderId":640,"title":"","url":"/messages/1926","content":"again TDTEAM->VENENG1 dc1015095351","isRead":false},"aGot":null}
- **10.2** Whitespace-only message
  - expected: 400 (or trimmed/rejected)
  - actual: 201 {"data":{"sentMessage":{"id":9476,"chatRoomId":1947,"senderId":640,"message":"   ","messageType":null,"clientMessageId":null,"isRead":false,"isEdited":false,"ed
- **10.5** HTML with onerror handler accepted by API (stored as-is?)
  - expected: sanitised or rejected
  - actual: 201 stored="<p>xss dc1015095351</p><img src=x onerror=\"window.__dcXss=1\">"
- **11.3** Engineer sidebar "Messages" lists the Tech Domain team conversation
  - expected: Service Delivery 3 listed
  - actual: false
  - screenshot: DirectChat_03_engineer-messages-listing.png
- **13.eng2** Engineer #2 (first-ever chat, started by Tech Domain) sees it in sidebar Messages
  - expected: Service Delivery 3 listed
  - actual: {"listed":false,"url":"https://dev.techdomain.com.au/messages"}
  - screenshot: DirectChat_31_engineer2-first-chat-listing.png

## Notes / observations

- Names: ENG1=Syed, ENG2=Individual, VEN1=Demo, VENENG1=Demo, VEN2=Vendor, TDTEAM=Teammember Tdtest
- Tech Domain company OWNER (user 27) is in no team, so he gets no Message button anywhere and cannot start a direct chat - only team members can. Confirm with product whether the owner should be able to.
- No second engineer of vendor 609 exists on dev, so "vendor engineer -> vendor engineer of the same company" could not be exercised.
- Direct-chat MESSAGE notification title is empty string (room 1947); work-order notifications carry the WO title.
- Direct-chat MESSAGE notification title is empty string (room 1948); work-order notifications carry the WO title.
- Direct-chat MESSAGE notification title is empty string (room 1930); work-order notifications carry the WO title.
- Direct-chat MESSAGE notification title is empty string (room 1924); work-order notifications carry the WO title.
- Direct-chat MESSAGE notification title is empty string (room 1926); work-order notifications carry the WO title.
- Direct-chat MESSAGE notification title is empty string (room 1949); work-order notifications carry the WO title.

## All checks

| # | check | expected | actual | result | screenshot |
|---|---|---|---|---|---|
| 00.TDOWNER | API login Tech Domain owner (27, no team) | token + id | id=27 role=CLIENT | PASS |  |
| 00.TDTEAM | API login Tech Domain team member (640, Service Delivery 3) | token + id | id=640 role=CLIENT | PASS |  |
| 00.TDNONTEAM | API login Tech Domain user without team (641) | token + id | id=641 role=CLIENT | PASS |  |
| 00.ENG1 | API login Individual engineer (575) | token + id | id=575 role=FREELANCER | PASS |  |
| 00.ENG2 | API login Individual engineer #2 (636) | token + id | id=636 role=FREELANCER | PASS |  |
| 00.VEN1 | API login Vendor owner (609, Demo Field Services 0925) | token + id | id=609 role=FREELANCER | PASS |  |
| 00.VENENG1 | API login Vendor engineer (611, member of vendor 609) | token + id | id=611 role=FREELANCER | PASS |  |
| 00.VEN2 | API login Vendor owner #2 (637) | token + id | id=637 role=FREELANCER | PASS |  |
| 00.CUST | API login Customer owner (638) | token + id | id=638 role=CUSTOMER | PASS |  |
| 00.CUSTSUB | API login Customer sub-user (639) | token + id | id=639 role=CUSTOMER | PASS |  |
| 00.ADMIN | API login Admin (1) | token + id | id=1 role=ADMIN | PASS |  |
| 01.TDOWNER>TDTEAM | Message button: Tech Domain owner (27, no team) viewing Tech Domain team member (640, Service Delivery 3) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDOWNER>ENG1 | Message button: Tech Domain owner (27, no team) viewing Individual engineer (575) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDOWNER>ENG2 | Message button: Tech Domain owner (27, no team) viewing Individual engineer #2 (636) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDOWNER>VEN1 | Message button: Tech Domain owner (27, no team) viewing Vendor owner (609, Demo Field Services 0925) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDOWNER>VENENG1 | Message button: Tech Domain owner (27, no team) viewing Vendor engineer (611, member of vendor 609) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDOWNER>VEN2 | Message button: Tech Domain owner (27, no team) viewing Vendor owner #2 (637) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDOWNER>CUST | Message button: Tech Domain owner (27, no team) viewing Customer owner (638) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDOWNER>ADMIN | Message button: Tech Domain owner (27, no team) viewing Admin (1) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDTEAM>TDOWNER | Message button: Tech Domain team member (640, Service Delivery 3) viewing Tech Domain owner (27, no team) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDTEAM>ENG1 | Message button: Tech Domain team member (640, Service Delivery 3) viewing Individual engineer (575) | option(s): teams | 200 vendor=- teams=Service Delivery 3#1930 | PASS |  |
| 01.TDTEAM>ENG2 | Message button: Tech Domain team member (640, Service Delivery 3) viewing Individual engineer #2 (636) | option(s): teams | 200 vendor=- teams=Service Delivery 3#null | PASS |  |
| 01.TDTEAM>VEN1 | Message button: Tech Domain team member (640, Service Delivery 3) viewing Vendor owner (609, Demo Field Services 0925) | option(s): teams | 200 vendor=- teams=Service Delivery 3#1924 | PASS |  |
| 01.TDTEAM>VENENG1 | Message button: Tech Domain team member (640, Service Delivery 3) viewing Vendor engineer (611, member of vendor 609) | option(s): teams | 200 vendor=- teams=Service Delivery 3#1926 | PASS |  |
| 01.TDTEAM>VEN2 | Message button: Tech Domain team member (640, Service Delivery 3) viewing Vendor owner #2 (637) | option(s): teams | 200 vendor=- teams=Service Delivery 3#null | PASS |  |
| 01.TDTEAM>CUST | Message button: Tech Domain team member (640, Service Delivery 3) viewing Customer owner (638) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDTEAM>ADMIN | Message button: Tech Domain team member (640, Service Delivery 3) viewing Admin (1) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDNONTEAM>TDOWNER | Message button: Tech Domain user without team (641) viewing Tech Domain owner (27, no team) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDNONTEAM>TDTEAM | Message button: Tech Domain user without team (641) viewing Tech Domain team member (640, Service Delivery 3) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDNONTEAM>ENG1 | Message button: Tech Domain user without team (641) viewing Individual engineer (575) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDNONTEAM>ENG2 | Message button: Tech Domain user without team (641) viewing Individual engineer #2 (636) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDNONTEAM>VEN1 | Message button: Tech Domain user without team (641) viewing Vendor owner (609, Demo Field Services 0925) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDNONTEAM>VENENG1 | Message button: Tech Domain user without team (641) viewing Vendor engineer (611, member of vendor 609) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDNONTEAM>VEN2 | Message button: Tech Domain user without team (641) viewing Vendor owner #2 (637) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDNONTEAM>CUST | Message button: Tech Domain user without team (641) viewing Customer owner (638) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.TDNONTEAM>ADMIN | Message button: Tech Domain user without team (641) viewing Admin (1) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG1>TDOWNER | Message button: Individual engineer (575) viewing Tech Domain owner (27, no team) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG1>TDTEAM | Message button: Individual engineer (575) viewing Tech Domain team member (640, Service Delivery 3) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG1>ENG2 | Message button: Individual engineer (575) viewing Individual engineer #2 (636) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG1>VEN1 | Message button: Individual engineer (575) viewing Vendor owner (609, Demo Field Services 0925) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG1>VENENG1 | Message button: Individual engineer (575) viewing Vendor engineer (611, member of vendor 609) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG1>VEN2 | Message button: Individual engineer (575) viewing Vendor owner #2 (637) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG1>CUST | Message button: Individual engineer (575) viewing Customer owner (638) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG1>ADMIN | Message button: Individual engineer (575) viewing Admin (1) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG2>TDOWNER | Message button: Individual engineer #2 (636) viewing Tech Domain owner (27, no team) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG2>TDTEAM | Message button: Individual engineer #2 (636) viewing Tech Domain team member (640, Service Delivery 3) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG2>ENG1 | Message button: Individual engineer #2 (636) viewing Individual engineer (575) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG2>VEN1 | Message button: Individual engineer #2 (636) viewing Vendor owner (609, Demo Field Services 0925) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG2>VENENG1 | Message button: Individual engineer #2 (636) viewing Vendor engineer (611, member of vendor 609) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG2>VEN2 | Message button: Individual engineer #2 (636) viewing Vendor owner #2 (637) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG2>CUST | Message button: Individual engineer #2 (636) viewing Customer owner (638) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ENG2>ADMIN | Message button: Individual engineer #2 (636) viewing Admin (1) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN1>TDOWNER | Message button: Vendor owner (609, Demo Field Services 0925) viewing Tech Domain owner (27, no team) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN1>TDTEAM | Message button: Vendor owner (609, Demo Field Services 0925) viewing Tech Domain team member (640, Service Delivery 3) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN1>ENG1 | Message button: Vendor owner (609, Demo Field Services 0925) viewing Individual engineer (575) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN1>ENG2 | Message button: Vendor owner (609, Demo Field Services 0925) viewing Individual engineer #2 (636) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN1>VENENG1 | Message button: Vendor owner (609, Demo Field Services 0925) viewing Vendor engineer (611, member of vendor 609) | option(s): vendor | 200 vendor=Demo Field Services 0925#null teams=- | PASS |  |
| 01.VEN1>VEN2 | Message button: Vendor owner (609, Demo Field Services 0925) viewing Vendor owner #2 (637) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN1>CUST | Message button: Vendor owner (609, Demo Field Services 0925) viewing Customer owner (638) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN1>ADMIN | Message button: Vendor owner (609, Demo Field Services 0925) viewing Admin (1) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VENENG1>TDOWNER | Message button: Vendor engineer (611, member of vendor 609) viewing Tech Domain owner (27, no team) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VENENG1>TDTEAM | Message button: Vendor engineer (611, member of vendor 609) viewing Tech Domain team member (640, Service Delivery 3) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VENENG1>ENG1 | Message button: Vendor engineer (611, member of vendor 609) viewing Individual engineer (575) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VENENG1>ENG2 | Message button: Vendor engineer (611, member of vendor 609) viewing Individual engineer #2 (636) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VENENG1>VEN1 | Message button: Vendor engineer (611, member of vendor 609) viewing Vendor owner (609, Demo Field Services 0925) | option(s): vendor | 200 vendor=Demo Field Services 0925#null teams=- | PASS |  |
| 01.VENENG1>VEN2 | Message button: Vendor engineer (611, member of vendor 609) viewing Vendor owner #2 (637) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VENENG1>CUST | Message button: Vendor engineer (611, member of vendor 609) viewing Customer owner (638) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VENENG1>ADMIN | Message button: Vendor engineer (611, member of vendor 609) viewing Admin (1) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN2>TDOWNER | Message button: Vendor owner #2 (637) viewing Tech Domain owner (27, no team) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN2>TDTEAM | Message button: Vendor owner #2 (637) viewing Tech Domain team member (640, Service Delivery 3) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN2>ENG1 | Message button: Vendor owner #2 (637) viewing Individual engineer (575) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN2>ENG2 | Message button: Vendor owner #2 (637) viewing Individual engineer #2 (636) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN2>VEN1 | Message button: Vendor owner #2 (637) viewing Vendor owner (609, Demo Field Services 0925) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN2>VENENG1 | Message button: Vendor owner #2 (637) viewing Vendor engineer (611, member of vendor 609) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN2>CUST | Message button: Vendor owner #2 (637) viewing Customer owner (638) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.VEN2>ADMIN | Message button: Vendor owner #2 (637) viewing Admin (1) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUST>TDOWNER | Message button: Customer owner (638) viewing Tech Domain owner (27, no team) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUST>TDTEAM | Message button: Customer owner (638) viewing Tech Domain team member (640, Service Delivery 3) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUST>ENG1 | Message button: Customer owner (638) viewing Individual engineer (575) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUST>ENG2 | Message button: Customer owner (638) viewing Individual engineer #2 (636) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUST>VEN1 | Message button: Customer owner (638) viewing Vendor owner (609, Demo Field Services 0925) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUST>VENENG1 | Message button: Customer owner (638) viewing Vendor engineer (611, member of vendor 609) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUST>VEN2 | Message button: Customer owner (638) viewing Vendor owner #2 (637) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUST>ADMIN | Message button: Customer owner (638) viewing Admin (1) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUSTSUB>TDOWNER | Message button: Customer sub-user (639) viewing Tech Domain owner (27, no team) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUSTSUB>TDTEAM | Message button: Customer sub-user (639) viewing Tech Domain team member (640, Service Delivery 3) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUSTSUB>ENG1 | Message button: Customer sub-user (639) viewing Individual engineer (575) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUSTSUB>ENG2 | Message button: Customer sub-user (639) viewing Individual engineer #2 (636) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUSTSUB>VEN1 | Message button: Customer sub-user (639) viewing Vendor owner (609, Demo Field Services 0925) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUSTSUB>VENENG1 | Message button: Customer sub-user (639) viewing Vendor engineer (611, member of vendor 609) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUSTSUB>VEN2 | Message button: Customer sub-user (639) viewing Vendor owner #2 (637) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUSTSUB>CUST | Message button: Customer sub-user (639) viewing Customer owner (638) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.CUSTSUB>ADMIN | Message button: Customer sub-user (639) viewing Admin (1) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ADMIN>TDOWNER | Message button: Admin (1) viewing Tech Domain owner (27, no team) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ADMIN>TDTEAM | Message button: Admin (1) viewing Tech Domain team member (640, Service Delivery 3) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ADMIN>ENG1 | Message button: Admin (1) viewing Individual engineer (575) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ADMIN>ENG2 | Message button: Admin (1) viewing Individual engineer #2 (636) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ADMIN>VEN1 | Message button: Admin (1) viewing Vendor owner (609, Demo Field Services 0925) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ADMIN>VENENG1 | Message button: Admin (1) viewing Vendor engineer (611, member of vendor 609) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ADMIN>VEN2 | Message button: Admin (1) viewing Vendor owner #2 (637) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 01.ADMIN>CUST | Message button: Admin (1) viewing Customer owner (638) | no option (button hidden) | 200 vendor=- teams=- | PASS |  |
| 02.1 | Individual engineer (575) POST chats/direct {"userId":636} - engineer -> engineer | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 02.2 | Individual engineer #2 (636) POST chats/direct {"userId":575} - engineer -> engineer (reverse) | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 02.3 | Individual engineer (575) POST chats/direct {"userId":609} - engineer -> vendor owner | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 02.4 | Individual engineer (575) POST chats/direct {"userId":611} - engineer -> vendor engineer | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 02.5 | Individual engineer (575) POST chats/direct {"userId":640} - engineer -> Tech Domain (engineer must not start) | 4xx (denied) | 403 {"message":"This user cannot be messaged directly","error":"Forbidden","statusCode":403} | PASS |  |
| 02.6 | Individual engineer (575) POST chats/direct {"userId":640,"teamId":"8ae534d5-d80c-49d9-8ac3-849fc63a927f"} - engineer -> Tech Domain team (teamId injected) | 4xx (denied) | 403 {"message":"This user cannot be messaged directly","error":"Forbidden","statusCode":403} | PASS |  |
| 02.7 | Individual engineer (575) POST chats/direct {"userId":638} - engineer -> customer | 4xx (denied) | 403 {"message":"This user cannot be messaged directly","error":"Forbidden","statusCode":403} | PASS |  |
| 02.8 | Individual engineer (575) POST chats/direct {"userId":575} - engineer -> self | 4xx (denied) | 403 {"message":"You cannot start a chat with yourself","error":"Forbidden","statusCode":403} | PASS |  |
| 03.1 | Vendor owner (609, Demo Field Services 0925) POST chats/direct {"userId":637} - vendor -> vendor | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 03.2 | Vendor owner #2 (637) POST chats/direct {"userId":609} - vendor -> vendor (reverse) | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 03.3 | Vendor owner (609, Demo Field Services 0925) POST chats/direct {"userId":575} - vendor -> individual engineer (not his member) | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 03.4 | Vendor owner #2 (637) POST chats/direct {"userId":611} - vendor -> ANOTHER vendor's engineer | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 03.5 | Vendor owner (609, Demo Field Services 0925) POST chats/direct {"userId":640} - vendor -> Tech Domain (vendor must not start) | 4xx (denied) | 403 {"message":"This user cannot be messaged directly","error":"Forbidden","statusCode":403} | PASS |  |
| 03.6 | Vendor owner (609, Demo Field Services 0925) POST chats/direct {"userId":640,"teamId":"8ae534d5-d80c-49d9-8ac3-849fc63a927f"} - vendor -> Tech Domain team (teamId injected) | 4xx (denied) | 403 {"message":"This user cannot be messaged directly","error":"Forbidden","statusCode":403} | PASS |  |
| 03.7 | Vendor owner (609, Demo Field Services 0925) POST chats/direct {"userId":638} - vendor -> customer | 4xx (denied) | 403 {"message":"This user cannot be messaged directly","error":"Forbidden","statusCode":403} | PASS |  |
| 03.8 | Vendor owner (609, Demo Field Services 0925) POST chats/direct {"userId":609} - vendor -> self | 4xx (denied) | 403 {"message":"You cannot start a chat with yourself","error":"Forbidden","statusCode":403} | PASS |  |
| 04.1 | Vendor engineer (611, member of vendor 609) POST chats/direct {"userId":575} - vendor engineer -> individual engineer | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 04.2 | Vendor engineer (611, member of vendor 609) POST chats/direct {"userId":636} - vendor engineer -> engineer #2 | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 04.3 | Vendor engineer (611, member of vendor 609) POST chats/direct {"userId":637} - vendor engineer -> ANOTHER vendor owner | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 04.4 | Vendor engineer (611, member of vendor 609) POST chats/direct {"userId":640} - vendor engineer -> Tech Domain (must not start) | 4xx (denied) | 403 {"message":"This user cannot be messaged directly","error":"Forbidden","statusCode":403} | PASS |  |
| 04.5 | Vendor engineer (611, member of vendor 609) POST chats/direct {"userId":638} - vendor engineer -> customer | 4xx (denied) | 403 {"message":"This user cannot be messaged directly","error":"Forbidden","statusCode":403} | PASS |  |
| 04.6 | Vendor engineer (611, member of vendor 609) POST chats/direct {"userId":611} - vendor engineer -> self | 4xx (denied) | 403 {"message":"You cannot start a chat with yourself","error":"Forbidden","statusCode":403} | PASS |  |
| 05.1 | Customer owner (638) POST chats/direct {"userId":575} - customer -> engineer | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 05.2 | Customer owner (638) POST chats/direct {"userId":609} - customer -> vendor | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 05.3 | Customer owner (638) POST chats/direct {"userId":640} - customer -> Tech Domain | 4xx (denied) | 403 {"message":"This user cannot be messaged directly","error":"Forbidden","statusCode":403} | PASS |  |
| 05.4 | Customer sub-user (639) POST chats/direct {"userId":575} - customer sub-user -> engineer | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 05.5 | Admin (1) POST chats/direct {"userId":575} - admin -> engineer (feature is for TD/vendor roles only) | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 05.6 | Tech Domain team member (640, Service Delivery 3) POST chats/direct {"userId":638,"teamId":"8ae534d5-d80c-49d9-8ac3-849fc63a927f"} - Tech Domain -> customer (customers are out of scope) | 4xx (denied) | 403 {"message":"This user cannot be messaged directly","error":"Forbidden","statusCode":403} | PASS |  |
| 05.7 | Tech Domain team member (640, Service Delivery 3) POST chats/direct {"userId":27,"teamId":"8ae534d5-d80c-49d9-8ac3-849fc63a927f"} - Tech Domain -> Tech Domain colleague | 4xx (denied) | 403 {"message":"This user cannot be messaged directly","error":"Forbidden","statusCode":403} | PASS |  |
| 05.8 | Tech Domain team member (640, Service Delivery 3) POST chats/direct {"userId":640,"teamId":"8ae534d5-d80c-49d9-8ac3-849fc63a927f"} - Tech Domain -> self | 4xx (denied) | 403 {"message":"You cannot start a chat with yourself","error":"Forbidden","statusCode":403} | PASS |  |
| 05.9 | Tech Domain team member (640, Service Delivery 3) POST chats/direct {"userId":575,"teamId":"cf0ed3db-521f-4c9f-887b-d5301383f8ce"} - Tech Domain member sending as a team he is NOT in | 4xx (denied) | 403 {"message":"You are not a member of this team","error":"Forbidden","statusCode":403} | PASS |  |
| 05.10 | Tech Domain team member (640, Service Delivery 3) POST chats/direct {"userId":575,"teamId":"not-a-team-id"} - bogus teamId | 4xx (denied) | 400 {"message":["teamId must be a UUID"],"error":"Bad Request","statusCode":400} | PASS |  |
| 05.11 | Tech Domain team member (640, Service Delivery 3) POST chats/direct {"userId":99999999,"teamId":"8ae534d5-d80c-49d9-8ac3-849fc63a927f"} - unknown userId | 4xx (denied) | 404 {"message":"User not found","error":"Not Found","statusCode":404} | PASS |  |
| 05.12 | Tech Domain team member (640, Service Delivery 3) POST chats/direct {} - empty body | 4xx (denied) | 400 {"message":["userId should not be empty","userId must be an integer number"],"error":"Bad Request","statusCode":400} | PASS |  |
| 05.13 | Tech Domain team member (640, Service Delivery 3) POST chats/direct {"userId":"abc","teamId":"8ae534d5-d80c-49d9-8ac3-849fc63a927f"} - non-numeric userId | 4xx (denied) | 400 {"message":["userId must be an integer number"],"error":"Bad Request","statusCode":400} | PASS |  |
| 05.14 | Tech Domain user without team (641) POST chats/direct {"userId":575} - Tech Domain user with NO team | 4xx (denied) | 403 {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 05.15 | Tech Domain user without team (641) POST chats/direct {"userId":575,"teamId":"8ae534d5-d80c-49d9-8ac3-849fc63a927f"} - Tech Domain user with NO team injecting a teamId | 4xx (denied) | 403 {"message":"You are not a member of this team","error":"Forbidden","statusCode":403} | PASS |  |
| 05.16 | Tech Domain owner (27, no team) POST chats/direct {"userId":575,"teamId":"8ae534d5-d80c-49d9-8ac3-849fc63a927f"} - Tech Domain OWNER (not a team member) injecting a teamId | 4xx (denied) | 403 {"message":"You are not a member of this team","error":"Forbidden","statusCode":403} | PASS |  |
| 05.17 | Tech Domain member POST chats/direct WITHOUT teamId (UI always sends one) | 4xx, or the existing team room 1930 re-used (no personal TD<->engineer room) | 403 id=null teamId=undefined {"message":"You can only message engineers of your own company","error":"Forbidden","statusCode":403} | PASS |  |
| 05.18 | Vendor owner -> own engineer with a Tech Domain teamId injected | 4xx, or vendor room (teamId ignored) | 403 {"message":"You are not a member of this team","error":"Forbidden","statusCode":403} | PASS |  |
| 05.19 | Unauthenticated POST chats/direct / GET options / GET inbox | 401 x3 | [401,401,401] | PASS |  |
| 06.ENG2.1 | Before: options for Individual engineer #2 (636) | team option with chatRoomId null (no room yet) | vendor=- teams=Service Delivery 3#null | PASS |  |
| 06.ENG2.2 | POST chats/direct {userId:636, teamId:SD3} (Tech Domain -> engineer) | 201 + room id | 201 id=1947 {"data":{"id":1947,"workOrderId":null,"companyId":9,"teamId":"8ae534d5-d80c-49d9-8ac3-849fc63a927f","directChatKey":"team:8ae534 | PASS |  |
| 06.ENG2.3 | Second POST for the same pair re-uses the room (idempotent) | same id 1947 | 201 id=1947 | PASS |  |
| 06.ENG2.4 | Options now carry the existing chatRoomId | teams=...#1947 | vendor=- teams=Service Delivery 3#1947 | PASS |  |
| 06.ENG2.5 | Room appears in BOTH sidebars (GET inbox?section=direct) - it was absent before for ENG2 | both listed, isDirectChat=true | {"tdListed":false,"tgtListed":false,"tgtBeforeHadIt":false} | FAIL |  |
| 06.ENG2.6 | Participants = target user + Service Delivery 3 members only | members contain 636; teamId SD3; directUserId 636 | {"teamId":"8ae534d5-d80c-49d9-8ac3-849fc63a927f","directUserId":636,"members":[636,476,263]} | PASS |  |
| 06.ENG2.7.1 | Tech Domain team member (640, Service Delivery 3) sends in room 1947 | 201 sentMessage | 201 {"id":9464,"key":"team:8ae534d5-d80c-49d9-8ac3-849fc63a927f:636"} | PASS |  |
| 06.ENG2.7.2 | Individual engineer #2 (636) replies in room 1947 | 201 sentMessage | 201 {"id":9465} | PASS |  |
| 06.ENG2.7.3 | Both sides read both messages via GET inbox/1947 | both true | {"aStatus":200,"aSeesReply":true,"bStatus":200,"bSeesFirst":true} | PASS |  |
| 06.ENG2.7.4 | MESSAGE notification to receiver (both directions) | b has notif for "first TDTEAM->ENG2 dc1015095351", a has notif for "first ENG2->TDTEAM dc1015095351", url /messages/1947 | {"bGot":{"id":112862,"senderId":640,"title":"","url":"/messages/1947","content":"first TDTEAM->ENG2 dc1015095351","isRead":false},"aGot":nul | FAIL |  |
| 06.ENG2.7.5 | Sender is not notified about own message | no self notification | {"selfA":false,"selfB":false} | PASS |  |
| 06.ENG2.8 | engineer side: participant shown is the TEAM (not an individual) | participant.type COMPANY "Service Delivery 3" | {"participant":"Service Delivery 3","type":"COMPANY"} | PASS |  |
| 06.VEN2.1 | Before: options for Vendor owner #2 (637) | team option with chatRoomId null (no room yet) | vendor=- teams=Service Delivery 3#null | PASS |  |
| 06.VEN2.2 | POST chats/direct {userId:637, teamId:SD3} (Tech Domain -> vendor owner) | 201 + room id | 201 id=1948 {"data":{"id":1948,"workOrderId":null,"companyId":9,"teamId":"8ae534d5-d80c-49d9-8ac3-849fc63a927f","directChatKey":"team:8ae534 | PASS |  |
| 06.VEN2.3 | Second POST for the same pair re-uses the room (idempotent) | same id 1948 | 201 id=1948 | PASS |  |
| 06.VEN2.4 | Options now carry the existing chatRoomId | teams=...#1948 | vendor=- teams=Service Delivery 3#1948 | PASS |  |
| 06.VEN2.5 | Room appears in BOTH sidebars (GET inbox?section=direct) - it was absent before for VEN2 | both listed, isDirectChat=true | {"tdListed":false,"tgtListed":false,"tgtBeforeHadIt":false} | FAIL |  |
| 06.VEN2.6 | Participants = target user + Service Delivery 3 members only | members contain 637; teamId SD3; directUserId 637 | {"teamId":"8ae534d5-d80c-49d9-8ac3-849fc63a927f","directUserId":637,"members":[637,476,263]} | PASS |  |
| 06.VEN2.7.1 | Tech Domain team member (640, Service Delivery 3) sends in room 1948 | 201 sentMessage | 201 {"id":9466,"key":"team:8ae534d5-d80c-49d9-8ac3-849fc63a927f:637"} | PASS |  |
| 06.VEN2.7.2 | Vendor owner #2 (637) replies in room 1948 | 201 sentMessage | 201 {"id":9467} | PASS |  |
| 06.VEN2.7.3 | Both sides read both messages via GET inbox/1948 | both true | {"aStatus":200,"aSeesReply":true,"bStatus":200,"bSeesFirst":true} | PASS |  |
| 06.VEN2.7.4 | MESSAGE notification to receiver (both directions) | b has notif for "first TDTEAM->VEN2 dc1015095351", a has notif for "first VEN2->TDTEAM dc1015095351", url /messages/1948 | {"bGot":{"id":112868,"senderId":640,"title":"","url":"/messages/1948","content":"first TDTEAM->VEN2 dc1015095351","isRead":false},"aGot":nul | FAIL |  |
| 06.VEN2.7.5 | Sender is not notified about own message | no self notification | {"selfA":false,"selfB":false} | PASS |  |
| 06.VEN2.8 | vendor owner side: participant shown is the TEAM (not an individual) | participant.type COMPANY "Service Delivery 3" | {"participant":"Service Delivery 3","type":"COMPANY"} | PASS |  |
| 07.ENG1.0 | Room Tech Domain(SD3) <-> Individual engineer (575) | room id | 1930 | PASS |  |
| 07.ENG1.1 | Tech Domain team member (640, Service Delivery 3) sends in room 1930 | 201 sentMessage | 201 {"id":9468,"key":"team:8ae534d5-d80c-49d9-8ac3-849fc63a927f:575"} | PASS |  |
| 07.ENG1.2 | Individual engineer (575) replies in room 1930 | 201 sentMessage | 201 {"id":9469} | PASS |  |
| 07.ENG1.3 | Both sides read both messages via GET inbox/1930 | both true | {"aStatus":200,"aSeesReply":true,"bStatus":200,"bSeesFirst":true} | PASS |  |
| 07.ENG1.4 | MESSAGE notification to receiver (both directions) | b has notif for "again TDTEAM->ENG1 dc1015095351", a has notif for "again ENG1->TDTEAM dc1015095351", url /messages/1930 | {"bGot":{"id":112874,"senderId":640,"title":"","url":"/messages/1930","content":"again TDTEAM->ENG1 dc1015095351","isRead":false},"aGot":nul | FAIL |  |
| 07.ENG1.5 | Sender is not notified about own message | no self notification | {"selfA":false,"selfB":false} | PASS |  |
| 07.VEN1.0 | Room Tech Domain(SD3) <-> Vendor owner (609, Demo Field Services 0925) | room id | 1924 | PASS |  |
| 07.VEN1.1 | Tech Domain team member (640, Service Delivery 3) sends in room 1924 | 201 sentMessage | 201 {"id":9470,"key":"team:8ae534d5-d80c-49d9-8ac3-849fc63a927f:609"} | PASS |  |
| 07.VEN1.2 | Vendor owner (609, Demo Field Services 0925) replies in room 1924 | 201 sentMessage | 201 {"id":9471} | PASS |  |
| 07.VEN1.3 | Both sides read both messages via GET inbox/1924 | both true | {"aStatus":200,"aSeesReply":true,"bStatus":200,"bSeesFirst":true} | PASS |  |
| 07.VEN1.4 | MESSAGE notification to receiver (both directions) | b has notif for "again TDTEAM->VEN1 dc1015095351", a has notif for "again VEN1->TDTEAM dc1015095351", url /messages/1924 | {"bGot":{"id":112880,"senderId":640,"title":"","url":"/messages/1924","content":"again TDTEAM->VEN1 dc1015095351","isRead":false},"aGot":nul | FAIL |  |
| 07.VEN1.5 | Sender is not notified about own message | no self notification | {"selfA":false,"selfB":false} | PASS |  |
| 07.VENENG1.0 | Room Tech Domain(SD3) <-> Vendor engineer (611, member of vendor 609) | room id | 1926 | PASS |  |
| 07.VENENG1.1 | Tech Domain team member (640, Service Delivery 3) sends in room 1926 | 201 sentMessage | 201 {"id":9472,"key":"team:8ae534d5-d80c-49d9-8ac3-849fc63a927f:611"} | PASS |  |
| 07.VENENG1.2 | Vendor engineer (611, member of vendor 609) replies in room 1926 | 201 sentMessage | 201 {"id":9473} | PASS |  |
| 07.VENENG1.3 | Both sides read both messages via GET inbox/1926 | both true | {"aStatus":200,"aSeesReply":true,"bStatus":200,"bSeesFirst":true} | PASS |  |
| 07.VENENG1.4 | MESSAGE notification to receiver (both directions) | b has notif for "again TDTEAM->VENENG1 dc1015095351", a has notif for "again VENENG1->TDTEAM dc1015095351", url /messages/1926 | {"bGot":{"id":112886,"senderId":640,"title":"","url":"/messages/1926","content":"again TDTEAM->VENENG1 dc1015095351","isRead":false},"aGot": | FAIL |  |
| 07.VENENG1.5 | Sender is not notified about own message | no self notification | {"selfA":false,"selfB":false} | PASS |  |
| 08.1 | Vendor engineer sees "Your company" option on the owner profile | vendor option | vendor=Demo Field Services 0925#null teams=- | PASS |  |
| 08.2 | Vendor ENGINEER creates the room first (POST chats/direct {userId: owner}) | 201 + id | 201 id=1949 {"data":{"id":1949,"workOrderId":null,"companyId":79,"teamId":null,"directChatKey":"vendor:609:611","engineerId":null,"userId":6 | PASS |  |
| 08.3 | Owner side POST for the same pair returns the SAME room (one room per pair, whoever starts) | id 1949 | 201 id=1949 | PASS |  |
| 08.4 | Vendor room participants = owner + engineer only (no Tech Domain, no team) | members [611] from owner view, teamId null | {"teamId":null,"directUserId":611,"members":[]} | PASS |  |
| 08.5.1 | Vendor engineer (611, member of vendor 609) sends in room 1949 | 201 sentMessage | 201 {"id":9474,"key":"vendor:609:611"} | PASS |  |
| 08.5.2 | Vendor owner (609, Demo Field Services 0925) replies in room 1949 | 201 sentMessage | 201 {"id":9475} | PASS |  |
| 08.5.3 | Both sides read both messages via GET inbox/1949 | both true | {"aStatus":200,"aSeesReply":true,"bStatus":200,"bSeesFirst":true} | PASS |  |
| 08.5.4 | MESSAGE notification to receiver (both directions) | b has notif for "vendor VENENG1->VEN1 dc1015095351", a has notif for "vendor VEN1->VENENG1 dc1015095351", url /messages/1949 | {"bGot":{"id":112890,"senderId":611,"title":"","url":"/messages/1949","content":"vendor VENENG1->VEN1 dc1015095351","isRead":false},"aGot":{ | PASS |  |
| 08.5.5 | Sender is not notified about own message | no self notification | {"selfA":false,"selfB":false} | PASS |  |
| 08.6 | Vendor pair room listed in both sidebars | both listed | {"owner":"Demo Worker","engineer":"Demo Field Services 0925"} | PASS |  |
| 09.td_ENG2.TDOWNER | Tech Domain owner (27, no team) is an outsider of TD(SD3) <-> Individual engineer #2 (636) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG2.TDNONTEAM | Tech Domain user without team (641) is an outsider of TD(SD3) <-> Individual engineer #2 (636) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG2.ENG1 | Individual engineer (575) is an outsider of TD(SD3) <-> Individual engineer #2 (636) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG2.VEN1 | Vendor owner (609, Demo Field Services 0925) is an outsider of TD(SD3) <-> Individual engineer #2 (636) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG2.VENENG1 | Vendor engineer (611, member of vendor 609) is an outsider of TD(SD3) <-> Individual engineer #2 (636) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG2.VEN2 | Vendor owner #2 (637) is an outsider of TD(SD3) <-> Individual engineer #2 (636) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG2.CUST | Customer owner (638) is an outsider of TD(SD3) <-> Individual engineer #2 (636) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG2.CUSTSUB | Customer sub-user (639) is an outsider of TD(SD3) <-> Individual engineer #2 (636) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG2.ADMIN | Admin (1) is an outsider of TD(SD3) <-> Individual engineer #2 (636) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN2.TDOWNER | Tech Domain owner (27, no team) is an outsider of TD(SD3) <-> Vendor owner #2 (637) (room 1948) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN2.TDNONTEAM | Tech Domain user without team (641) is an outsider of TD(SD3) <-> Vendor owner #2 (637) (room 1948) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN2.ENG1 | Individual engineer (575) is an outsider of TD(SD3) <-> Vendor owner #2 (637) (room 1948) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN2.ENG2 | Individual engineer #2 (636) is an outsider of TD(SD3) <-> Vendor owner #2 (637) (room 1948) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN2.VEN1 | Vendor owner (609, Demo Field Services 0925) is an outsider of TD(SD3) <-> Vendor owner #2 (637) (room 1948) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN2.VENENG1 | Vendor engineer (611, member of vendor 609) is an outsider of TD(SD3) <-> Vendor owner #2 (637) (room 1948) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN2.CUST | Customer owner (638) is an outsider of TD(SD3) <-> Vendor owner #2 (637) (room 1948) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN2.CUSTSUB | Customer sub-user (639) is an outsider of TD(SD3) <-> Vendor owner #2 (637) (room 1948) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN2.ADMIN | Admin (1) is an outsider of TD(SD3) <-> Vendor owner #2 (637) (room 1948) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG1.TDOWNER | Tech Domain owner (27, no team) is an outsider of TD(SD3) <-> Individual engineer (575) (room 1930) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG1.TDNONTEAM | Tech Domain user without team (641) is an outsider of TD(SD3) <-> Individual engineer (575) (room 1930) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG1.ENG2 | Individual engineer #2 (636) is an outsider of TD(SD3) <-> Individual engineer (575) (room 1930) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG1.VEN1 | Vendor owner (609, Demo Field Services 0925) is an outsider of TD(SD3) <-> Individual engineer (575) (room 1930) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG1.VENENG1 | Vendor engineer (611, member of vendor 609) is an outsider of TD(SD3) <-> Individual engineer (575) (room 1930) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG1.VEN2 | Vendor owner #2 (637) is an outsider of TD(SD3) <-> Individual engineer (575) (room 1930) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG1.CUST | Customer owner (638) is an outsider of TD(SD3) <-> Individual engineer (575) (room 1930) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG1.CUSTSUB | Customer sub-user (639) is an outsider of TD(SD3) <-> Individual engineer (575) (room 1930) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_ENG1.ADMIN | Admin (1) is an outsider of TD(SD3) <-> Individual engineer (575) (room 1930) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN1.TDOWNER | Tech Domain owner (27, no team) is an outsider of TD(SD3) <-> Vendor owner (609, Demo Field Services 0925) (room 1924) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN1.TDNONTEAM | Tech Domain user without team (641) is an outsider of TD(SD3) <-> Vendor owner (609, Demo Field Services 0925) (room 1924) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN1.ENG1 | Individual engineer (575) is an outsider of TD(SD3) <-> Vendor owner (609, Demo Field Services 0925) (room 1924) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN1.ENG2 | Individual engineer #2 (636) is an outsider of TD(SD3) <-> Vendor owner (609, Demo Field Services 0925) (room 1924) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN1.VENENG1 | Vendor engineer (611, member of vendor 609) is an outsider of TD(SD3) <-> Vendor owner (609, Demo Field Services 0925) (room 1924) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN1.VEN2 | Vendor owner #2 (637) is an outsider of TD(SD3) <-> Vendor owner (609, Demo Field Services 0925) (room 1924) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN1.CUST | Customer owner (638) is an outsider of TD(SD3) <-> Vendor owner (609, Demo Field Services 0925) (room 1924) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN1.CUSTSUB | Customer sub-user (639) is an outsider of TD(SD3) <-> Vendor owner (609, Demo Field Services 0925) (room 1924) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VEN1.ADMIN | Admin (1) is an outsider of TD(SD3) <-> Vendor owner (609, Demo Field Services 0925) (room 1924) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VENENG1.TDOWNER | Tech Domain owner (27, no team) is an outsider of TD(SD3) <-> Vendor engineer (611, member of vendor 609) (room 1926) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VENENG1.TDNONTEAM | Tech Domain user without team (641) is an outsider of TD(SD3) <-> Vendor engineer (611, member of vendor 609) (room 1926) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VENENG1.ENG1 | Individual engineer (575) is an outsider of TD(SD3) <-> Vendor engineer (611, member of vendor 609) (room 1926) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VENENG1.ENG2 | Individual engineer #2 (636) is an outsider of TD(SD3) <-> Vendor engineer (611, member of vendor 609) (room 1926) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VENENG1.VEN1 | Vendor owner (609, Demo Field Services 0925) is an outsider of TD(SD3) <-> Vendor engineer (611, member of vendor 609) (room 1926) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VENENG1.VEN2 | Vendor owner #2 (637) is an outsider of TD(SD3) <-> Vendor engineer (611, member of vendor 609) (room 1926) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VENENG1.CUST | Customer owner (638) is an outsider of TD(SD3) <-> Vendor engineer (611, member of vendor 609) (room 1926) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VENENG1.CUSTSUB | Customer sub-user (639) is an outsider of TD(SD3) <-> Vendor engineer (611, member of vendor 609) (room 1926) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.td_VENENG1.ADMIN | Admin (1) is an outsider of TD(SD3) <-> Vendor engineer (611, member of vendor 609) (room 1926) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.vendorPair.TDOWNER | Tech Domain owner (27, no team) is an outsider of Vendor 609 <-> engineer 611 (room 1949) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.vendorPair.TDTEAM | Tech Domain team member (640, Service Delivery 3) is an outsider of Vendor 609 <-> engineer 611 (room 1949) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.vendorPair.TDNONTEAM | Tech Domain user without team (641) is an outsider of Vendor 609 <-> engineer 611 (room 1949) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.vendorPair.ENG1 | Individual engineer (575) is an outsider of Vendor 609 <-> engineer 611 (room 1949) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.vendorPair.ENG2 | Individual engineer #2 (636) is an outsider of Vendor 609 <-> engineer 611 (room 1949) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.vendorPair.VEN2 | Vendor owner #2 (637) is an outsider of Vendor 609 <-> engineer 611 (room 1949) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.vendorPair.CUST | Customer owner (638) is an outsider of Vendor 609 <-> engineer 611 (room 1949) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.vendorPair.CUSTSUB | Customer sub-user (639) is an outsider of Vendor 609 <-> engineer 611 (room 1949) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.vendorPair.ADMIN | Admin (1) is an outsider of Vendor 609 <-> engineer 611 (room 1949) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 09.cross | Messages of one Tech Domain room never show in another target's room | no cross-room text | {"engRoomMsgs":2,"venRoomMsgs":2,"cross":false} | PASS |  |
| 10.1 | Empty message | 400 | 400 {"message":["message should not be empty"],"error":"Bad Request","statusCode":400} | PASS |  |
| 10.2 | Whitespace-only message | 400 (or trimmed/rejected) | 201 {"data":{"sentMessage":{"id":9476,"chatRoomId":1947,"senderId":640,"message":"   ","messageType":null,"clientMessageId":null,"isRead":fa | FAIL |  |
| 10.3 | Missing message field | 400 | 400 {"message":["message should not be empty","message must be a string"],"error":"Bad Request","statusCode":400} | PASS |  |
| 10.4 | 10,000-character message | 201 or a clear 4xx (no 500) | 201 len=10007 | PASS |  |
| 10.5 | HTML with onerror handler accepted by API (stored as-is?) | sanitised or rejected | 201 stored="<p>xss dc1015095351</p><img src=x onerror=\"window.__dcXss=1\">" | FAIL |  |
| 10.6 | Send to a non-existent room | 403/404 | 404 {"message":"Conversation not found","error":"Not Found","statusCode":404} | PASS |  |
| 10.7 | Engineer #2 has unread messages in the TD room before reading | unreadCount > 0, unreadDirectCount > 0 | {"unreadCount":3,"counts":{"total":3,"direct":1,"wo":0}} | PASS |  |
| 10.8 | PATCH inbox/<id>/read clears the unread count | 200 + unreadCount 0 | {"patch":200,"unreadCount":0,"counts":{"total":0,"direct":0,"wo":0}} | PASS |  |
| 10.9 | Outsider cannot mark the room as read | 403/404 | 403 {"message":"You are not allowed to view this conversation","error":"Forbidden","statusCode":403} | PASS |  |
| 11.1 | Tech Domain member sees "Message" button on the engineer profile | visible | true | PASS | DirectChat_01_td-engineer-profile-message-button.png |
| 11.2 | Click navigates to /messages/<roomId> | /messages/1930 | https://dev.techdomain.com.au/messages/1930 | PASS | DirectChat_02_td-direct-room-opened.png |
| 11.3 | Engineer sidebar "Messages" lists the Tech Domain team conversation | Service Delivery 3 listed | false | FAIL | DirectChat_03_engineer-messages-listing.png |
| 11.4 | Message typed by Tech Domain appears live (socket) on the engineer screen | visible within 15s without reload | true | PASS | DirectChat_04_engineer-received-live.png |
| 11.5 | Engineer reply appears live on the Tech Domain screen | visible within 15s | true | PASS | DirectChat_06_td-received-reply-live.png |
| 11.6 | Tech Domain thread header shows the engineer name | Syed | true | PASS |  |
| 11.7 | Sender OFFLINE (network off) and presses Enter | clear feedback (error/pending), message NOT shown as delivered, receiver gets nothing | {"errorToast":false,"shownInSenderThread":false,"receiverGotIt":false} | PASS | DirectChat_07_td-offline-after-send.png |
| 11.8 | Sender back ONLINE: is the offline message delivered / retried / dropped? | consistent state (either delivered to both or clearly failed on sender) | {"senderShows":true,"receiverShows":true} | PASS | DirectChat_08_td-back-online.png |
| 11.9 | Sending again after reconnect works live | delivered | true | PASS | DirectChat_09_engineer-after-reconnect.png |
| 11.10 | Receiver was OFFLINE while the message was sent, then reconnects | sender delivered OK; receiver sees it after reconnect (resync) | {"senderShows":true,"receiverShowsAfterReconnect":true} | PASS | DirectChat_10_engineer-reconnect-resync.png |
| 11.12 | Stored XSS: message containing <img onerror> rendered on the receiver screen | handler must NOT execute (sanitised) | {"onerrorExecuted":false,"rawImgTags":1} | PASS | DirectChat_11_engineer-xss-render.png |
| 12.1 | Vendor engineer sees "Message" on his vendor owner profile | visible | true | PASS | DirectChat_12_vendor-engineer-owner-profile-button.png |
| 12.2 | Navigates to the vendor pair room | /messages/1949 | https://dev.techdomain.com.au/messages/1949 | PASS | DirectChat_13_vendor-engineer-room.png |
| 12.3 | Vendor owner sidebar Messages lists the engineer conversation | Demo listed | true | PASS | DirectChat_14_vendor-owner-messages-listing.png |
| 12.4 | Engineer -> owner live | visible within 15s | true | PASS | DirectChat_15_vendor-owner-received-live.png |
| 12.5 | Owner -> engineer live | visible within 15s | true | PASS | DirectChat_16_vendor-engineer-received-reply.png |
| 12.6 | Vendor owner sees "Message" on his engineer profile | visible | true | PASS | DirectChat_17_vendor-owner-engineer-profile-button.png |
| 12.7 | Owner click opens the SAME pair room | /messages/1949 | https://dev.techdomain.com.au/messages/1949 | PASS | DirectChat_18_vendor-owner-same-room.png |
| 13.1 | Message button: engineer viewing a vendor | hidden | {"buttonVisible":false,"pageUnauthorized":true} | PASS | DirectChat_19_no-button-ENG1-views-VEN1.png |
| 13.2 | Message button: engineer viewing another engineer | hidden | {"buttonVisible":false,"pageUnauthorized":true} | PASS | DirectChat_20_no-button-ENG1-views-ENG2.png |
| 13.3 | Message button: engineer viewing a Tech Domain user | hidden | {"buttonVisible":false,"pageUnauthorized":false} | PASS | DirectChat_21_no-button-ENG1-views-TDTEAM.png |
| 13.4 | Message button: vendor viewing another vendor | hidden | {"buttonVisible":false,"pageUnauthorized":true} | PASS | DirectChat_22_no-button-VEN1-views-VEN2.png |
| 13.5 | Message button: vendor viewing an individual engineer | hidden | {"buttonVisible":false,"pageUnauthorized":true} | PASS | DirectChat_23_no-button-VEN1-views-ENG1.png |
| 13.6 | Message button: vendor viewing a Tech Domain user | hidden | {"buttonVisible":false,"pageUnauthorized":false} | PASS | DirectChat_24_no-button-VEN1-views-TDTEAM.png |
| 13.7 | Message button: vendor engineer viewing an individual engineer | hidden | {"buttonVisible":false,"pageUnauthorized":true} | PASS | DirectChat_25_no-button-VENENG1-views-ENG1.png |
| 13.8 | Message button: vendor viewing ANOTHER vendor's engineer | hidden | {"buttonVisible":false,"pageUnauthorized":true} | PASS | DirectChat_26_no-button-VEN2-views-VENENG1.png |
| 13.9 | Message button: Tech Domain viewing a customer | hidden | {"buttonVisible":false,"pageUnauthorized":false} | PASS | DirectChat_27_no-button-TDTEAM-views-CUST.png |
| 13.10 | Message button: Tech Domain viewing a colleague | hidden | {"buttonVisible":false,"pageUnauthorized":false} | PASS | DirectChat_28_no-button-TDTEAM-views-TDNONTEAM.png |
| 13.11 | Message button: Tech Domain OWNER (no team) viewing an engineer | observation (owner is in no team) | {"buttonVisible":false,"pageUnauthorized":false} | INFO | DirectChat_29_no-button-TDOWNER-views-ENG1.png |
| 13.12 | Message button: customer viewing an engineer | hidden | {"buttonVisible":false,"pageUnauthorized":false} | PASS | DirectChat_30_no-button-CUST-views-ENG1.png |
| 13.eng2 | Engineer #2 (first-ever chat, started by Tech Domain) sees it in sidebar Messages | Service Delivery 3 listed | {"listed":false,"url":"https://dev.techdomain.com.au/messages"} | FAIL | DirectChat_31_engineer2-first-chat-listing.png |
| 13.eng2xss | Engineer #2 opens the room holding the API-sent onerror payload | handler must NOT execute | {"onerrorExecuted":false} | PASS | DirectChat_32_engineer2-room-xss-check.png |
| 14.1 | Offline-typed message stored exactly once or not at all (no duplicates) | 0 or 1 rows | {"stored":1} | PASS |  |
| 14.2 | Message sent while receiver was offline stored once | 1 row | {"stored":1} | PASS |  |
| 14.3.ENG1 | Individual engineer (575) is an outsider of TD(SD3) <-> engineer #2 (final) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 14.3.VEN1 | Vendor owner (609, Demo Field Services 0925) is an outsider of TD(SD3) <-> engineer #2 (final) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 14.3.VENENG1 | Vendor engineer (611, member of vendor 609) is an outsider of TD(SD3) <-> engineer #2 (final) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 14.3.VEN2 | Vendor owner #2 (637) is an outsider of TD(SD3) <-> engineer #2 (final) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 14.3.TDNONTEAM | Tech Domain user without team (641) is an outsider of TD(SD3) <-> engineer #2 (final) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 14.3.TDOWNER | Tech Domain owner (27, no team) is an outsider of TD(SD3) <-> engineer #2 (final) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 14.3.CUST | Customer owner (638) is an outsider of TD(SD3) <-> engineer #2 (final) (room 1947) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 14.4.TDTEAM | Tech Domain team member (640, Service Delivery 3) is an outsider of Vendor 609 <-> 611 (final) (room 1949) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 14.4.ENG1 | Individual engineer (575) is an outsider of Vendor 609 <-> 611 (final) (room 1949) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 14.4.VEN2 | Vendor owner #2 (637) is an outsider of Vendor 609 <-> 611 (final) (room 1949) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |
| 14.4.ENG2 | Individual engineer #2 (636) is an outsider of Vendor 609 <-> 611 (final) (room 1949) | not listed, GET 403, POST 403, 0 notifications | {"listed":false,"get":403,"post":403,"notifs":0,"postMsg":"You are not allowed to send messages in this conversation"} | PASS |  |