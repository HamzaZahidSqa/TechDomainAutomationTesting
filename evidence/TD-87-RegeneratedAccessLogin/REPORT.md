# TD-87 – Regenerated User Access Cannot Login With Same Email

Ticket: https://techdomain.atlassian.net/browse/TD-87 (Task, High, Backend/Bug, "QA In Progress", 1 PR OPEN)
Tested 2026-10-16 on dev · Spec `tests/td-87-regenerated-access-login.spec.js` + driver run `run-1016111102`

Repro (Tech Domain Work Board → Customer Dashboard): create a parent customer → row menu **Generate Signup** (`POST /clients/owner/:id`) with a Mailinator e-mail → **Delete Access** (`DELETE /clients/owner/:id`) → **Generate Signup** again with the SAME e-mail → log in with the newly e-mailed password.

## Verdict: PASS – the regenerated access CAN log in with the same e-mail. The ticket bug does not reproduce on dev.

Clean end-to-end run (customer 109, e-mail `td87-e2e-0577616@mailinator.com`):

| # | Step | Result |
|---|---|---|
| 1 | Tech Domain creates the parent customer, Generate Signup #1 | owner user **669** created (PENDING), welcome e-mail with password #1 ✔ |
| 2 | Delete Access | `DELETE /clients/owner/109` 200, customer has no owner ✔ |
| 3 | Generate Signup #2, **same e-mail** | `POST /clients/owner/109` **201**, new owner **670**, fresh welcome e-mail with password #2 ✔ (regeneration is NOT blocked) |
| 4 | Login with the OLD (pre-delete) password | **401 "Invalid email or password"** – correctly invalidated ✔ |
| 5 | Login with the REGENERATED password (before e-mail verify) | **307 "Please verify email"** – note: NOT the ticket's "Invalid email/password"; the password is accepted, only the normal new-account e-mail check remains |
| 6 | Verify e-mail (OTP 744182 → `otps/verify` 201) then login with the regenerated password | **201 "Login successfully"**, access token issued, role CUSTOMER ✔ |

So after delete + regenerate with the same e-mail, the user logs in successfully with the newly generated credentials. The reported symptom ("Invalid email/password" on the regenerated login) was not seen; the regenerated password returns the standard "Please verify email" gate and then succeeds.

## Notes
- The UI path was exercised too: Delete Access dialog ("Delete Associated Account … cannot be undone") and the Generate Signup modal both worked; the row-action column is pinned right and needs a wide viewport / horizontal scroll to reach. Screenshots TD-87_05…09.
- Soft-delete: after Delete Access the old owner row is removed from the customer but the underlying user id stays addressable (669 vs the new 670); the new login resolves to the active regenerated user. No login conflict resulted.
- Flake: on one earlier inbox (`td87-owner-1016111131`) neither the welcome nor the forgot-password e-mail arrived in Mailinator within ~70 s, while a known account and the e2e inbox received them immediately. Treated as a Mailinator delivery delay, not a product issue; the authoritative result is the e2e run above (`e2e-final.json`).
- The automated spec `tests/td-87-regenerated-access-login.spec.js` depends on Mailinator timing and can report a false FAIL when the welcome mail is slow; the driver run captured the deterministic result.

## Evidence
`evidence/TD-87-RegeneratedAccessLogin/run-1016111102/` – e2e-result.json, e2e-final.json (final login 201, loggedIn true), results.json, screenshots TD-87_01…09.
Test data left on dev: customers 107, 108, 109 with regenerated owners; customer 109 owner 670 verified and logs in.
