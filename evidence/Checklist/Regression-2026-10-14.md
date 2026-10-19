# Checklist regression compare
baseline: C:/Users/MC1E1~1.HAM/AppData/Local/Temp/claude/C--Users-M--Hamza-Downloads-TechDomainAutomationTesting/e7526b08-9392-4b85-bb38-5c8619a675a8/scratchpad/baseline
current: C:\Users\M. Hamza\Downloads\TechDomainAutomationTesting\evidence\Checklist\results

| Area | Pass before | Pass after | Same | Fixed | Regressed | New | Missing |
|---|---|---|---|---|---|---|---|
| 01-AuthAPI | 91/103 | 91/103 | 103 | 0 | 0 | 0 | 0 |
| 02-AuthUI | 89/89 | 89/89 | 88 | 0 | 0 | 1 | 1 |
| 03-NotificationsAPI | 52/66 | 52/66 | 66 | 0 | 0 | 0 | 0 |
| 04-ChatAPI | 61/67 | 61/67 | 67 | 0 | 0 | 0 | 0 |
| 05-RolesPermissions | 113/116 | 113/116 | 116 | 0 | 0 | 0 | 0 |
| 06-Onboarding | 27/32 | 27/32 | 32 | 0 | 0 | 0 | 0 |

Totals: same 472, fixed 0, regressed 0, new 1, missing 1

## 01-AuthAPI (run 1013113433 -> 1014101231)
pass before 91/103, after 91/103; same 103, fixed 0, regressed 0, new 0, missing 0

## 02-AuthUI (run 1013115004 -> 1014101344)
pass before 89/89, after 89/89; same 88, fixed 0, regressed 0, new 1, missing 1
- MISSING UR-04 Logged-out visit to /some/unknown-1013115004 redirects to /getStarted (was PASS)

## 03-NotificationsAPI (run 1013115222 -> 1014101344)
pass before 52/66, after 52/66; same 66, fixed 0, regressed 0, new 0, missing 0

## 04-ChatAPI (run 1013113816 -> 1014101612)
pass before 61/67, after 61/67; same 67, fixed 0, regressed 0, new 0, missing 0

## 05-RolesPermissions (run 1013113833 -> 1014101626)
pass before 113/116, after 113/116; same 116, fixed 0, regressed 0, new 0, missing 0

## 06-Onboarding (run 1013114837 -> 1014101754)
pass before 27/32, after 27/32; same 32, fixed 0, regressed 0, new 0, missing 0
