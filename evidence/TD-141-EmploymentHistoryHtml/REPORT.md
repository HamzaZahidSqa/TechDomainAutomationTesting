# TD-141 - Remove html tags from employment history display

- Ticket: https://techdomain.atlassian.net/browse/TD-141 (Feature, Frontend, status QA In Progress, PR open)
- Environment: https://dev.techdomain.com.au, bundle `static/js/main.2a8246fe.js`, API https://api.dev.techdomain.com.au/api
- Tested: 2026-10-16 11:30 UTC, spec `tests/td-141-employment-history-html.spec.js`, evidence `run-1016113012/`

## Verdict: PASS (display fix works in every view) - plus 1 security finding (stored XSS, same component)

## What the bug was (bundle diff)
The employment "Description" is entered in a Quill rich-text editor and saved as HTML (`<p>`, `<strong>`, `<ul><li>`...).
The production build (`main.3f79de71`) rendered it in the profile view `/user/details/profile/:id` (card "Employment",
seen by Tech Domain / admin / customer / vendor owner) as plain text `<p class="text-xs">{description}</p>`, so viewers saw
the raw tags. The dev build renders it with `<div class="ql-editor ..." dangerouslySetInnerHTML>` in all three places.

## Checks (46 PASS, 4 FAIL - all 4 are the security probe)
Seed data (API `POST /employment` as the user, deleted at the end):
- rich description: paragraph + bold + italic + underline + 2-item bullet list
- escaped literal: `&lt;tag&gt;` typed by the user (must stay visible as text)
- probe: `<img src=x onerror=...>` (must not execute)

| View | URL | Result |
|---|---|---|
| Engineer own Profile Settings > Profile tab, "Employment History" card | `/user/settings/profile/575` | PASS - formatted text, bullets, bold/italic/underline; no raw tags |
| Engineer edit through the modal "Employement History" (Quill editor, bold button, Update -> `PATCH /employment/:id` 200) | same | PASS - editor pre-filled with formatting, new bold text saved as `<strong>` and rendered |
| Tech Domain (CLIENT) viewing the engineer profile, card "Employment" | `/user/details/profile/575` | PASS - no raw tags, markup rendered; no edit controls (ADMIN only) |
| Admin viewing the engineer profile (tabbed view) | `/user/details/profile/575` | PASS - no raw tags; pencil + "+" shown |
| Customer viewing the engineer profile | `/user/details/profile/575` | PASS - no raw tags |
| Vendor owner viewing own member's profile | `/user/details/profile/611` | PASS - no raw tags |
| PENDING engineer, Complete Your Profile > Profile Details > "Employment History" card | `/completeYourProfile` | PASS - no raw tags |
| Escaped literal `<tag>` typed as text | all views | PASS - shown literally (correct, Quill escapes typed `<`) |

Observation: the API stores and returns the description verbatim (`GET /employment/:userId`), no server-side stripping or
sanitising. The fix is purely how the frontend renders it.

## FINDING (security, out of ticket scope but caused by the same rendering): stored XSS via employment description
- `POST /employment` has no validation (checklist: "No ValidationPipe"), so any engineer can save
  `<p>Probe</p><img src="x" onerror="...">` as a description via the API (the Quill editor itself would escape it).
- Every viewer of that profile then executes the `onerror` script: confirmed for the engineer themself,
  the Tech Domain user, the admin and the customer (`window.__td141xss` set to 1 on each page).
  Vendor owner view was not probed (member record had the rich description only) but uses the same component.
- Impact: an engineer can run JavaScript in an admin's / Tech Domain's / customer's session (token theft, actions as the viewer).
- Fix suggestion: sanitise before rendering (e.g. DOMPurify on the frontend) and/or sanitise `description` on the
  backend in `POST/PATCH /employment` (strip tags not produced by Quill: `img`, `script`, `on*` attributes, `style`, `iframe`).
  The same `dangerouslySetInnerHTML` pattern is used for "About Me" (`PATCH users {description}`), worth checking too.
- Repro: `evidence/TD-141-EmploymentHistoryHtml/run-1016113012/results.json` (`views.*.xssProbeFired`).

## Evidence files (run-1016113012)
- `TD-141_EmploymentHistory_01_engineer-profile-settings-employment-card.png`
- `TD-141_EmploymentHistory_02_engineer-edit-modal-rich-text-prefilled.png`
- `TD-141_EmploymentHistory_03_engineer-edit-modal-description-edited.png`
- `TD-141_EmploymentHistory_04_engineer-settings-after-edit.png`
- `TD-141_EmploymentHistory_05_tech-domain-view-engineer-profile-employment.png`
- `TD-141_EmploymentHistory_06_admin-view-engineer-profile-employment.png`
- `TD-141_EmploymentHistory_07_customer-view-engineer-profile-employment.png`
- `TD-141_EmploymentHistory_08_vendor-owner-view-member-profile-employment.png`
- `TD-141_EmploymentHistory_09_pending-engineer-complete-profile-employment-card.png`
- `results.json` - every check with the rendered text / HTML per view
