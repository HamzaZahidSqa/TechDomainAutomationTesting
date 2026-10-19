# WO #10980 (id 986): engineer request could not be accepted — qualification not verified

Date: 2026-10-14 · Environment: https://dev.techdomain.com.au · Tech Domain user 27 · Engineer 575 "Syed Hamza" (ha@mailinator.com)

## Problem
Engineer 575 sent a request on #10980. In Tech Domain's "Requested Offer Review" dialog the **Accept & Assign** button was disabled with the note
"(The qualifications of this engineer have not been verified yet.)" — `Before_3_TechDomain-review-request-dialog.png`.

Direct API call `POST /offers/assign {workOrderId: 986, userId: 575}` returned
`500 "The following qualifications are not verified: Aruba Certified Switching Associate"`.

## Root cause
- The work order requires the Certification **Aruba Certified Switching Associate** (qualification sub-type 11) — see Work Order Eligibility in `Before_1_*.png`.
- The engineer had this certification on their profile (user qualification row **752**) but it was **not verified** by Admin (`isVerified: false`), so the eligibility check blocks the assignment. This is expected product behaviour, not a bug in the accept flow.
- Side note for developers: the API returns HTTP **500** for this validation failure; it should be a 4xx.

## Fix applied (data, no code change)
1. Admin verified the engineer's certification: `POST /admin/equipment/verify {userQualificationId: 752, isVerified: true}` → `{"id":752,"isVerified":true}`
   (this is the same call the Admin UI makes when clicking the Verification tick in the engineer's Licences/Certifications table).
2. `POST /offers/engineer/workOrder/986` now returns `isEngineerQualificationsVerified: true`; the review dialog shows the enabled **Accept & Assign** button with no warning — `After_3_TechDomain-review-request-dialog.png`.
3. Request accepted & assigned in the UI → work order **Assigned / Not Confirmed**, Engineer Syed Hamza (ID 575) — `AfterAssign_1_TechDomain-workOrder-details-986.png`. Offer 2436 status ASSIGNED.

Note: `POST /admin/skill/verify` is for *skills* (userSkill); calling it with a userQualificationId crashes with a Prisma `findUnique ... id: undefined` error (500). Qualifications/certifications are verified with `/admin/equipment/verify`.

## How to do it from the Admin UI next time
Admin → Review → Engineers → engineer 575 → View Profile → Licences / Certifications → click the circle under **Verification** on the "Aruba Certified Switching Associate" row, then Tech Domain can Accept & Assign the request.

Files: `Before_*.png` (blocked), `After_3_*.png` (enabled after verification), `AfterAssign_1_*.png` (assigned), `fix-api-log.txt` (API calls).
