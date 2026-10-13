# TD-37 – Separate Bank Account API from User Detail / invoice

Ticket: https://techdomain.atlassian.net/browse/TD-37 (Task, Highest, labels Backend/api, status QA In Progress, 2 PRs still OPEN on 2026-10-12)
Environment: https://dev.techdomain.com.au / https://api.dev.techdomain.com.au/api
Spec: `tests/td-37-bank-accounts-api.spec.js` · Run: `run-1013043020` (2026-10-13) · Re-test of run-1009081007 (2026-10-09, same result)

## Verdict: **FAIL** – requirement R2 (get ONE account by id) is not implemented and `GET /bankDetails/:id` leaks a provider's full bank details to client users (R6/R7). Create / update / delete by id work correctly and are isolated per account (R1, R3, R4, R5).

Accounts: A = engineer 575 (owner), B = vendor engineer 611, C = TechDomain client user 27, admin 1.

| Req | Check | Result |
|---|---|---|
| R1 | `POST /bankDetails` twice → two distinct uuid ids, both in `GET /bankDetails/user/575` | PASS |
| R2 | A route that returns exactly one account for its id | **FAIL** – none. `GET /bankDetails/<accountId>` → 200 with the caller's whole list (2 rows); `/bankDetails/account/<id>`, `/bankDetails/details/<id>`, `/bankDetails/user/575/<id>`, `/bankAccounts/<id>`, `/bank-accounts/<id>` → 404 |
| R2 | `GET /bankDetails/:id` honours the id | **FAIL** – id1, id2 and `not-an-id` all return the same 2 rows; a numeric value (`/bankDetails/1`) filters by **branchId** (empty). The FE uses this route as `branchData` (bank accounts of a company branch) on the Generate Invoice screen, not as get-by-account-id |
| R3 | `PATCH /bankDetails/<id1>` changes only account 1; account 2 byte-identical before/after; unknown id → 404 "Bank detail not found" | PASS |
| R4 | `DELETE /bankDetails/<id1>/<userId>` removes only account 1; second delete → 404 "this account doesn't exist" | PASS |
| R5/R6 | B and C: PATCH on A's account (with/without `userId` in body) → 404; DELETE with A's id or own id → 404; `GET /bankDetails/user/<A.id>` returns the **caller's own** accounts, never A's | PASS |
| R6/R7 | B (vendor engineer) `GET /bankDetails/<A's account id>` → B's own accounts only | PASS |
| R6/R7 | **C (client user) `GET /bankDetails/<A's account id>` → A's accounts with `accountNumber`, `iban`, `swiftCode`, `bsb`** | **FAIL** |
| R7 | Provider view `GET /bankDetails/user/<A.id>/bankAccountDetails` (used by the invoice screen) exposes only `id`, `bankName`, `currency`; vendor engineer gets 403 | PASS |
| – | Ownership comes from the token: `userId` in POST body ignored (account created for the caller); `userId` in PATCH cannot move an account; wrong `userId` in DELETE path ignored | PASS / info |
| UI | Engineer › Profile Settings › Bank Accounts lists both accounts (rows keyed by account uuid) | PASS |
| UI | Click holder name → "Bank Account Details" modal shows that account only (rendered from the row, no API call) | PASS |
| UI | Actions › Edit → PATCH `/bankDetails/<id1>` only; account 2 unchanged; grid updated | PASS |
| UI | Actions › Delete → confirm names the account → DELETE `/bankDetails/<id1>/575`; toast "Bank Account deleted successfully"; account 2 stays | PASS |
| UI | View / Edit modal shows the stored currency | **FAIL** – AUD account shown as **PKR**; Update sends `currency: "PKR"` |

## Findings

1. **R2 not implemented (backend).** There is no endpoint that returns a single bank account by its id. `GET /bankDetails/:x` is a *branch* filter on the caller's (or company's) accounts and ignores account ids; the ticket's `GET /api/bank-accounts/101 → only Bank A` is not possible. Jira shows the 2 PRs for this ticket still OPEN, so the fix may simply not be deployed to dev yet.
2. **Data leak (backend, security).** A CLIENT user (TechDomain user 27) calling `GET /bankDetails/<anything>` receives engineer 575's full bank accounts (account number, IBAN, SWIFT, BSB) – 2 rows, HTTP 200. A vendor engineer gets only his own rows, so the scoping is wrong only for the client role. Same result as on 2026-10-09. Expected: 403/404 or owner-only rows. Admin also receives them (acceptable for admin).
3. **Currency reset on edit (frontend, data corruption).** The engineer's "Update Bank Account" / "Bank Account Details" modals pre-select **PKR** regardless of the stored currency (AUD here, and AUD is in the dropdown). Saving an unrelated field (bank name) sent `currency: "PKR"` and the backend accepted it. Any UI edit silently changes the account currency unless the user re-selects it. Screenshots 02, 04, 08; reproduced again on 2026-10-13 with an account the tester added through the UI ("Test Holer", AUD) – view and edit modals both show PKR (screenshots 09, 10).
4. **Minor (frontend).** The Bank Accounts tab requests `GET /bankDetails/user/undefined?page=1&limit=20` (user id not resolved yet); it only works because the backend ignores the path userId for non-admins and returns the caller's rows.
5. **Engineer UI allows only ONE bank account (frontend).** On the engineer Bank Accounts tab the "Add New Bank Account" button is rendered only while the list is empty (bundle: `0===list.length && <Add New Bank Account>`); once one account exists there is no way to add a second one from the UI. The admin/client version of the tab always shows the button. Contradicts the ticket's "customer has three bank accounts" scenario. Screenshot 11.
6. **Minor (backend).** `DELETE /bankDetails/:id/:userId` ignores the `:userId` segment (wrong id → 200 and deleted; ownership is taken from the token). Harmless, but the parameter is misleading.

## Evidence
`evidence/TD-37-BankAccountsApi/run-1013043020/`
- `results.json` – every request/response (ids, statuses, bodies), `summary.txt` – PASS/FAIL list
- 01 bank accounts list · 02 view modal (account 1, currency PKR) · 03 Actions menu · 04 edit form · 05 after edit · 06 delete confirm · 07 after delete · 08 currency dropdown (AUD available, PKR preselected) · 09/10 tester's UI-added AUD account shown as PKR in view/edit · 11 no Add button once an account exists

Test data: all `TD37*` accounts created by the run were deleted (engineer 575 and vendor engineer 611 back to their original state).
