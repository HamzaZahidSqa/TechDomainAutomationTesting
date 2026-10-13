# TD-55 – Optimize route to multiple engineers API

Ticket: https://techdomain.atlassian.net/browse/TD-55 (sub-task TD-85 unroute – Done)
Environment: https://dev.techdomain.com.au (web bundle main.af2f4820.js) / https://api.dev.techdomain.com.au/api
Date: 2026-10-12 · Spec: `tests/td-55-route-multiple-engineers.spec.js` · Evidence: `evidence/TD-55-RouteMultiple/run-1012102647/`
Account: Tech Domain owner istkhar+2@techdomain.com.au (user 27) · Work order: 969 "leak test Data" (PUBLISHED, Lahore)

## Verdict: PASS with one deviation (per-engineer result is NOT returned on a partial failure)

| # | Expected result (ticket) | Observed | Result |
|---|---|---|---|
| 1 | One request with the work order + full list of engineers | UI "Route Selected (3)" sends exactly one `POST /offers/route` `{"workOrderId":969,"userIds":[41,294,386]}` → 201 | PASS |
| 2 | Backend routes all together, result per engineer | Success: `data[]` has one offer per engineer (ROUTED) + `routedCount`. Failure: whole batch rejected with ONE message naming the first bad engineer, nothing routed | PARTIAL |
| 3 | Page refreshes once, not 3× per engineer | After the click: `users/nearby` ×1, `workOrders/providersCount` ×1, `workOrders/969` ×1 (3 calls total for 3 engineers; before the fix it was 9) | PASS |
| 4 | Message says which ones / why | Success toast "3 engineers routed successfully"; failure toast "Saman Farooq: Engineer billing rates are missing." (names the engineer + reason) | PASS |
| TD-85 | Unroute multiple in one request | "Unroute Selected (3)" → one `POST /offers/unroute {"offerIds":[2429,2430,2428]}` → 201, toast "3 offers unrouted successfully", reloads once each | PASS |

## API checks
- `POST /offers/route {workOrderId, userIds:[575,609,611]}` → 201 in ~0.3 s, `data` = 3 ROUTED offers, `routedCount: 3`, `message: "SUCCESS"`.
- Already-routed engineer → 409 "Already Routed to you, please refresh the page", no duplicate offer.
- `userIds: []` → 400 "userIds should not be empty". Legacy `{userId: 576}` still works (201).
- Mixed batch `[576, 999999]` → 400 "Engineer 999999: Engineer is not approved" and **576 is not routed** (all-or-nothing, no per-engineer result list).
- `POST /offers/unroute {offerIds[4]}` → 201 in ~0.4 s, all unrouted.

## Findings
1. **Partial failure = whole batch fails (deviation from "return a result for each engineer").** From the UI, ticking Saman Farooq (91, hourly rate only) + Demo User (294) and clicking Route Selected (2) gives 400 "Saman Farooq: Engineer billing rates are missing." and *neither* engineer is routed. The user must untick the bad engineer and click again. The ticks stay selected after the failure (button still shows "Route Selected (2)"), so retrying is easy, but the response has no per-engineer success/failure list. Acceptable if the team wants atomic behaviour; otherwise backend should return e.g. `{routed:[...], failed:[{userId, reason}]}` and the UI should show both.
2. Info: engineers whose profile has only an hourly rate (e.g. 91 Saman Farooq, 115, 116, 118, 119 on this list) cannot be routed at all ("billing rates are missing"), yet they are listed with a "Route" button. Not in scope of TD-55.

## Dev data
WO 969 was routed/unrouted several times during the test; it is left with 0 ROUTED offers.

## Screenshots
01 wo-details, 02 providers-tab, 03 three-selected, 04 after-route-selected (toast), 05 routed-list (Pending Assignments), 06 routed-selected, 07 after-unroute-selected, 08 mixed-selected, 09 mixed-after-route (error toast). `results.json` holds every captured request/response.
