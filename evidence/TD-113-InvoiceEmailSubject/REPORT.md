# TD-113 customer invoice e-mail subject (dev, 2026-10-12)

Spec: `tests/td-113-invoice-email-subject.spec.js`  |  Final run: `run-1012062754`  |  Verdict: **PASS**

## Steps (API as the Tech Domain owner istkhar+2@techdomain.com.au, same calls as the web dialogs)
1. Generate invoice: `POST /invoices` {clientId 104, currency USD, paymentTerms 30, taxType GST, taxPercentage 10, workOrderIds [976], bankAccountId (Wise), branchId 1, role CLIENT} -> invoice **108** (GENERATED, grand total USD 88.00).
2. Send: `PATCH /invoices/send/108` multipart {id, status UNPAID, toEmail customer-10090955@mailinator.com, skipEmail false} -> SUCCESS, invoice status UNPAID.
3. Customer owner inbox (Mailinator customer-10090955) read in the browser.

## Result
- E-mail from accounts@techdomain.com.au, subject: **`Invoice INV-#108 – Tech Domain`** (en dash, as in the ticket).
- Body: "Hi Customer Company 10090955, Your invoice from Tech Domain is now available ... Invoice Number: INV-#108, Amount Due: USD 88.00".
- Customer sees invoice 108 (UNPAID) in `GET /invoices`.
- 8/8 checks passed. Screenshots: `TD-113_Invoice_01_mailinator-inbox.png`, `TD-113_Invoice_02_mailinator-email.png`.

## Findings (outside the ticket, worth separate tickets)
1. **Send Invoice fails silently when the customer entity has no address**: `PATCH /invoices/send/:id` returned HTTP 200 with message `Cannot read properties of null (reading 'addressLine1')`, invoice stayed GENERATED, no e-mail. Customer 104 had no address/e-mail (profile never completed). Fixed for the test by `PATCH /clients/104` (addressLine1, city, state, zipCode, country, email) as the Tech Domain owner. Expect a 4xx with a clear message instead.
2. **Prisma stack traces leak to API clients**: `GET /invoices/customer`, `GET /invoices/client` and `POST /invoices/workOrder` (with a body the web app does not send) return HTTP 200/201 with the Prisma query dump including server file paths (`/home/ubuntu/tdp-backend/src/modules/invoices/invoices.service.ts`).
3. Web bug (engineer invoice send): the FormData appends `ccEmails` under the key `toEmail` (both customer and engineer send wrappers), so CC addresses can never reach the backend as CC.

## Dev data changed
Invoice 108 created and sent (UNPAID) for WO 976; client 104 now has address "14 QA Street, Lahore, Punjab 54000, Pakistan" and e-mail customer-10090955@mailinator.com.
