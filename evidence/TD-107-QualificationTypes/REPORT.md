# TD-107 – Remove Background check & Insurance from the Qualification section (Dev)

Ticket: https://techdomain.atlassian.net/browse/TD-107 (label Backend, no description/comments)
Environment: https://dev.techdomain.com.au / https://api.dev.techdomain.com.au/api · Date: 2026-10-12
Spec: `tests/td-107-remove-insurance-background-qualifications.spec.js` · Evidence: `evidence/TD-107-QualificationTypes/run-1012115126/`
Accounts: engineer Ha@mailinator.com (575), Tech Domain owner istkhar+2@techdomain.com.au (27), admin admin@techdomain.com

## Verdict: PASS for the lists/pickers – backend still ACCEPTS the removed sub-types (finding 1)

| Where | Observed | Result |
|---|---|---|
| `GET /qualifications` (engineer / Tech Domain / admin) | Certification (1), Equipment (5), Licences (2) only. Insurance (3) and Background check (4) gone | PASS |
| `GET /qualifications/subQualifications` (789 rows) | only Equipment / Certification / Licences sub-types | PASS |
| `GET /qualifications/subQualificationsByQualificationId/3` and `/4` | empty `[]` | PASS |
| Tech Domain › Create New Work Order › Qualification Type | options: Certification, Equipment, Licences | PASS |
| Engineer › Profile Settings › Profile tab | sections About Me, Education, Resume, Background Verification*, Skills, Equipments, License and Certifications, … – no Insurance; legacy "Any Age" / "Professional Liability" rows not rendered | PASS |
| Admin › Manage › Qualifications (`/manage/qualifications`) | no Insurance / Background check type on the page | PASS |
| `POST /users/qualifications {qualificationSubTypeId: 71}` (Insurance) as engineer | **201 SUCCESS** – row stored with type "Insurance" | FAIL |
| `POST /users/qualifications {qualificationSubTypeId: 78}` (Background check "Any Age") | **201 SUCCESS** – row stored with type "Background check" | FAIL |
| Engineer › Profile Settings › Personal Info | an **"Insurance" section with "+"** is still rendered; "+" opens "Upload Insurance" whose Insurance Type list is empty (nothing can be added) | UI leftover |

\* "Background Verification" on the Profile tab is the Education / Working-Rights document upload, not the removed "Background check" qualification type.

## Findings
1. **Backend still accepts the removed sub-types.** `POST /users/qualifications` with sub-type 71 (Insurance) or 78 (Background check) returns 201 and stores the row (`qualificationType: "Insurance"` / `"Background check"`). The sub-types were only hidden from the list endpoints, not blocked. Any client/app/mobile that still knows the ids can keep adding them. Expected: 400/404 for sub-types of a removed type.
2. **Engineer web UI leftover (frontend):** Profile Settings › Personal Info still shows the "Insurance" section and the "Upload Insurance" modal (empty "Insurance Type"). Screenshots 03/04. Should be removed with the type.
3. Legacy data is untouched (information): engineer 575 still has Insurance + Background check rows in `GET /users/qualifications`; template WO 242 still requires Background check "Any Age" and shows it on the details page (screenshot 02). Decide whether existing rows should be migrated/hidden.
4. Side issue: `DELETE /users/qualifications/:id` returns 500 "Internal server error" although the row disappears from the list.
5. Information: the create-work-order help text still says qualifications "may encompass … insurance … screenings".

## Dev data
Engineer 575's Insurance row was re-created by the POST probe (backend soft-deletes and re-inserts on duplicate sub-type: 729 → 745 → 746 → 747 → …); duplicates were deleted again, the engineer ends with one Insurance and one Background check row as before.

## Screenshots
01 Create WO Qualification Type dropdown · 02 WO 242 legacy Background check · 03 engineer Personal Info (Insurance section) · 04 Upload Insurance modal · 05 engineer Profile tab · 06 Background Verification modal · 07 admin Manage menu · 08 admin Qualifications · 09 admin rows-per-page dropdown. `results.json` has every API response.
