# Locked profile fields after approval — Name, Nationality / ID, Email, Phone

Date: 2026-10-14 · Environment: https://dev.techdomain.com.au · All accounts in status **APPROVED** (accounts.json)

Requirement under test: after profile approval, **Name, Nationality / ID document, Email and Phone must not be editable** by the user. Checked for Engineer (575), Vendor owner (609), Vendor Engineer (611), Customer (617) and Customer sub-user (624), both through the web UI and directly through the API (`PATCH /users`). Every change made during the test was reverted (verified at the end).

## Result: FAIL — only Email is locked, and only in the UI

| Field | Engineer | Vendor | Vendor Engineer | Customer | Customer sub-user |
|---|---|---|---|---|---|
| Legal Name (first/last) | **Editable** UI + API | **Editable** UI + API | **Editable** UI + API | **Editable** UI + API | **Editable** UI + API |
| Phone | **Editable** UI + API | **Editable** UI + API | **Editable** UI + API | **Editable** UI (pencil) + API | **Editable** UI (pencil) + API |
| Nationality | **Editable** UI (Verify your Identity dialog) + API | API editable (no nationality in UI) | **Editable** UI + API | API editable (field not in UI) | API editable (field not in UI) |
| ID document (National Id / Driving License / Passport) | **Editable** — dialog lets the user delete the uploaded file and upload a new one | n/a in UI | **Editable** — same dialog | n/a | n/a |
| Email | UI locked ("Contact Support to change the email address") — **API still accepts** `PATCH /users {email}` | same | same | same | same |

### UI evidence
- Engineer / Vendor / Vendor Engineer → Profile Settings (`/user/settings`): pencil icons on **Legal Name** and **Phone** open inline inputs with Save; saving the name returns "Profile updated successfully" and the API confirms the new name (`<Role>_4_LegalName-saved.png`, `<Role>_5_Phone-edit.png`, `<Role>_1_LegalName-edit.png`). The **Verify your Identity** pencil opens a dialog with an editable Nationality dropdown, a file picker for the ID document and an X to delete the existing one (`Engineer_3_VerifyyourIdentity-edit.png`, `VendorEngineer_3_...`).
- Customer / Customer sub-user → avatar menu → **Profile Setting** (`/user/settings/profileInformation/<id>`): same Legal Name / Phone pencils; name change saved successfully (`Customer_ProfileSetting_name-saved.png`, `CustomerUser_ProfileSetting_name-saved.png`). "My Profile" (`/user/details/profile/<id>`) is read-only but only a view page.
- Email is the only field shown without a pencil, with the text "Contact Support to change the email address" (all roles).

### API evidence (`api-log.txt`, `api-results.json`)
For every role, `PATCH /users` with `firstName`, `lastName`, `nationality`, `phoneNumber` **and `email`** returned **200** and the value was changed (confirmed via `GET /users/me`). The backend performs no "approved → locked" check; the email lock exists only in the frontend. The response also carries `profileNeedsResubmit: false`, so a changed name/ID does not send the profile back for re-approval.

Observed side effect: `PATCH /users` validates `firstName` as letters only, so a name that was created with digits (customer 617 "TD36") can no longer be saved back by the user; it had to be restored through `PATCH /users/admin/617`.

## Expected behaviour (per requirement)
After approval the backend should reject `PATCH /users` for `firstName`, `lastName`, `nationality`, `phoneNumber`, `email` (and identity-document add/delete) for APPROVED users of every role, and the UI should hide the pencil icons / show "Contact Support" for all four fields, not only for Email.

## Files
`<Role>_-user-settings.png` (profile page), `<Role>_1_LegalName-edit.png`, `<Role>_4_LegalName-saved.png`, `<Role>_5_Phone-edit.png`, `Engineer_3_VerifyyourIdentity-edit.png`, `VendorEngineer_3_VerifyyourIdentity-edit.png`, `Customer*_ProfileSetting*.png`, `Customer*_MyProfile.png`, `api-log.txt`, `api-results.json`, `ui-edit-log.txt`, `ui-customer-log.txt`.
