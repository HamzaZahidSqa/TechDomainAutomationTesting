# TD-93 sign-off sheet visible to the customer on approved status (dev, 2026-10-12)

Spec: `tests/td-93-signoff-sheet.spec.js`  |  Final run: `run-1012061150`  |  Verdict: **PASS**

## Accounts
| Role | Email | Password |
|---|---|---|
| Customer owner (Customer Company 10090955, user 638) | customer-10090955@mailinator.com | B4!Z7z9pPkuz |
| Customer sub-user (user 639) | td123-subuser-1009101529@mailinator.com | Td123Pass@2026x |
| Tech Domain owner (user 27, control) | istkhar+2@techdomain.com.au | Hussain@512 |
| Engineer (user 575, uploads the sheet) | Ha@mailinator.com | Hacktime123@ |

## Data
- WO 976 (ref 10970, APPROVED): sheet uploaded by engineer 575 via `POST /workOrders/signOffSheet` (multipart: clientName "QA Customer Signer", clientDesignation "Site Manager", clientComment, engineerComment, client/engineer signature PNGs, physical sheet PNG).
- WO 978 (ref 10972): created by the customer owner, assigned to engineer 575, sheet uploaded at check-out, then WORKDONE -> REVIEWED -> VERIFIED -> APPROVED.

## Results
| Status | Customer owner | Customer sub-user | Tech Domain owner (control) |
|---|---|---|---|
| APPROVED (WO 976) | tab "Job Sign-Off" shown; sheet page shows Customer Sign-Off name, designation, comment, signatures, download buttons | same | same |
| WORKDONE (WO 978) | tab hidden (web app rule: CUSTOMER does not see the tab at WORKDONE); direct URL does not show the sheet | not checked | tab shown, sheet rendered (a Feedback popup opens on top of it) |
| VERIFIED (WO 978) | tab + sheet shown | not checked | tab + sheet shown |
| APPROVED (WO 978) | tab + sheet shown | tab + sheet shown | tab + sheet shown |

Checks: 23/23 (WO 976 APPROVED), 15/15 (VERIFIED), 22/22 (APPROVED WO 978). The 3 "failed" checks at WORKDONE are the Tech Domain control view: the text check could not read the fields behind the auto-opened Feedback popup, the screenshot `TD-93_SignOff_10_workdone-techdomain-signoff-page.png` shows the sheet is rendered.

API: `GET /workOrders/:id` returns `signOffSheet` (clientName, clientDesignation, clientComment, clientSignature, engineerComment, engineerSignature, physicalSheet URLs) to the customer owner and the sub-user.

## Notes
- Sign-off tab config (web bundle): roles CLIENT/FREELANCER/CUSTOMER, statuses WORKDONE, VERIFIED, APPROVED, INVOICED, DISPUTED, PAID; CUSTOMER excluded at WORKDONE.
- `POST /workOrders/signOffSheet` with only `workOrderId` creates an empty sheet record (no validation) - observed while probing, upserted afterwards with full data.
