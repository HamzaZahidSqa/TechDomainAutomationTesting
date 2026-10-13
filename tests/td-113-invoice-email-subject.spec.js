// TD-113: "update customer invoice subject - Invoice [Invoice Number] – Tech Domain"  (Backend)
// https://techdomain.atlassian.net/browse/TD-113
//
// Expected: when Tech Domain sends a customer invoice, the e-mail the customer receives has the subject
//   "Invoice <invoice number> – Tech Domain"
//
// Flow (API as the Tech Domain owner, same calls as the web "Generate Invoice" / "Send Invoice" dialogs):
//   1. POST /invoices {clientId, currency, paymentTerms, taxType, taxPercentage, workOrderIds, bankAccountId, branchId, role:'CLIENT'}
//   2. PATCH /invoices/send/<id> {id, status:'SENT', ccEmails:[], skipEmail:false}
//   3. the customer owner's Mailinator inbox is read: newest "Invoice" e-mail -> subject + body (screenshot)
//   4. the customer's invoice list/detail is read to compare the invoice number
//
// Run:  npx playwright test tests/td-113-invoice-email-subject.spec.js
//       WO_ID=978 npx playwright test tests/td-113-invoice-email-subject.spec.js   (approved work order to invoice)
//       INVOICE_ID=<id> ...  (skip generation, only send + check)
// Evidence: evidence/TD-113-InvoiceEmailSubject/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-113-InvoiceEmailSubject', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const WO_ID = Number(process.env.WO_ID || 976);          // APPROVED work order of customer 103 (entity 104)
const ENTITY_ID = 104;
const BRANCH_ID = 1;                                       // Tech Domain Testing Branch
const BANK_ACCOUNT_ID = '75111164-ad42-4c50-ab3d-159c4201cc3d'; // Wise / Tech Domain Pty Ltd (used by invoice 107)
const EXPECTED_SUBJECT = /^Invoice\s+(\S+)\s+[–-]\s+Tech Domain$/; // en dash per the ticket; plain hyphen reported separately

test.setTimeout(600_000);

let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `TD-113_Invoice_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: true }).catch(() => { }); return path.basename(f); }
async function rawLogin(email, password) { const ctx = await pwRequest.newContext({ extraHTTPHeaders: H }); const res = await ctx.post(u('/auth/login'), { data: { email, password } }); const body = await res.json().catch(() => ({})); await ctx.dispose(); return { status: res.status(), body }; }
async function apiLogin(account, label) {
  const l = await rawLogin(account.email, account.password);
  if (!l.body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${l.status}`);
  return { label, account, api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${l.body.accessToken}` } }), user: l.body.data || {}, id: l.body.data?.id };
}
async function call(s, method, p, data) {
  const r = await s.api[method](u(p), data === undefined ? undefined : { data });
  return { status: r.status(), body: await r.json().catch(async () => ({ text: await r.text().catch(() => '') })) };
}
const getJson = (s, p) => call(s, 'get', p);
const postJson = (s, p, d) => call(s, 'post', p, d);
const patchJson = (s, p, d) => call(s, 'patch', p, d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mailinator public inbox: returns the rows (subject/from) and opens the newest row matching `subject`
async function readMailinator(page, email, subject, log, sinceRows = 0) {
  const inbox = email.split('@')[0];
  for (let attempt = 1; attempt <= 8; attempt++) {
    await page.goto(`https://www.mailinator.com/v4/public/inboxes.jsp?to=${encodeURIComponent(inbox)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4_000);
    const rows = page.locator('tr').filter({ hasText: subject });
    const n = await rows.count();
    log(`Mailinator ${inbox}: attempt ${attempt}, ${n} row(s) matching ${subject} (before: ${sinceRows})`);
    if (n > sinceRows) {
      const rowText = (await rows.first().innerText()).replace(/\s+/g, ' ').trim();
      const listShot = await shot(page, 'mailinator-inbox');
      await rows.first().click();
      await page.waitForTimeout(4_000);
      let text = '';
      for (const f of page.frames()) { try { text += '\n' + (await f.locator('body').innerText({ timeout: 3_000 })); } catch { } }
      // the subject is shown in the message header of the inbox page
      const header = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      const mailShot = await shot(page, 'mailinator-email');
      return { rowText, text, header, listShot, mailShot };
    }
    await page.waitForTimeout(5_000);
  }
  return null;
}
async function countMailinator(page, email, subject) {
  const inbox = email.split('@')[0];
  await page.goto(`https://www.mailinator.com/v4/public/inboxes.jsp?to=${encodeURIComponent(inbox)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4_000);
  return page.locator('tr').filter({ hasText: subject }).count();
}

test('TD-113: customer invoice e-mail subject is "Invoice <number> – Tech Domain"', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 700) }); };
  const results = { run: RUN, workOrderId: WO_ID, checks: [], findings: [] };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); };

  const tdAcc = accounts.find((a) => a.role === 'TechDomain User');
  const custAcc = testAccounts.find((a) => a.role === 'Customer');
  const td = await apiLogin(tdAcc, 'TD owner');
  const cust = await apiLogin(custAcc, 'Customer owner');

  const mailCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const mail = await mailCtx.newPage(); mail.setDefaultTimeout(15_000);
  const before = await countMailinator(mail, custAcc.email, /invoice/i);
  log(`customer inbox ${custAcc.email}: ${before} invoice e-mail(s) before the test`);

  // 1. generate the customer invoice
  let invoiceId = Number(process.env.INVOICE_ID || 0);
  if (!invoiceId) {
    const wo = (await getJson(td, `/workOrders/${WO_ID}`)).body?.data || {};
    log(`WO ${WO_ID} ref=${wo.referenceId} status=${wo.status}/${wo.subStatus} client=${wo.client?.id}`);
    expect(wo.status, 'work order to invoice must be APPROVED').toBe('APPROVED');
    const payload = { clientId: ENTITY_ID, currency: 'USD', paymentTerms: 30, taxType: 'GST', taxPercentage: 10, workOrderIds: [WO_ID], bankAccountId: BANK_ACCOUNT_ID, branchId: BRANCH_ID, role: 'CLIENT' };
    const cr = await postJson(td, '/invoices', payload);
    log(`POST /invoices -> HTTP ${cr.status} ${JSON.stringify(cr.body).slice(0, 400)}`);
    invoiceId = cr.body?.data?.id || cr.body?.id;
    check('Tech Domain owner can generate the customer invoice', cr.status < 300 && !!invoiceId, { status: cr.status, id: invoiceId, message: cr.body?.message });
    expect(invoiceId, 'invoice id').toBeTruthy();
  }
  results.invoiceId = invoiceId;
  const detail = (await getJson(td, `/invoices/details/${invoiceId}`)).body?.data || {};
  log(`invoice ${invoiceId}: ${JSON.stringify({ status: detail.status, invoiceNumber: detail.invoiceNumber, referenceId: detail.referenceId, grandTotal: detail.grandTotal, client: detail.client?.clientName })}`);
  const numberFields = Object.fromEntries(Object.entries(detail).filter(([k]) => /number|reference|serial|code/i.test(k)));
  log(`invoice number-like fields: ${JSON.stringify(numberFields)}`);

  // 2. send it to the customer
  // web "Send Invoice" dialog: multipart PATCH /invoices/send/:id {id, status:'UNPAID', toEmail:<billing e-mail>, skipEmail:'false'}
  const sdRes = await td.api.patch(u(`/invoices/send/${invoiceId}`), { multipart: { id: String(invoiceId), status: 'UNPAID', toEmail: custAcc.email, skipEmail: 'false' } });
  const sd = { status: sdRes.status(), body: await sdRes.json().catch(() => ({})) };
  log(`PATCH /invoices/send/${invoiceId} (multipart, status=UNPAID, toEmail=${custAcc.email}) -> HTTP ${sd.status} ${JSON.stringify(sd.body).slice(0, 300)}`);
  check('Send Invoice succeeds', sd.status < 300, { status: sd.status, message: sd.body?.message });
  const after = (await getJson(td, `/invoices/details/${invoiceId}`)).body?.data || {};
  check('invoice status is UNPAID after sending', after.status === 'UNPAID', { status: after.status });

  // 3. the customer's e-mail
  await sleep(5_000);
  const got = await readMailinator(mail, custAcc.email, /invoice/i, log, before);
  check('customer received an invoice e-mail', !!got, { inbox: custAcc.email });
  let subject = '';
  if (got) {
    // Mailinator inbox rows: "<from> <subject> <time>"; the opened message shows the subject in its header
    const m = got.header.match(/Invoice[^\n]{0,80}?Tech Domain/i) || got.rowText.match(/Invoice[^\n]{0,80}?Tech Domain/i);
    subject = m ? m[0].trim() : got.rowText;
    log(`e-mail row: ${got.rowText}`);
    log(`subject (parsed): ${subject}`);
    results.email = { rowText: got.rowText, subject, bodyExcerpt: got.text.replace(/\s+/g, ' ').slice(0, 600), shots: [got.listShot, got.mailShot] };
    const mm = subject.match(EXPECTED_SUBJECT);
    check('subject matches "Invoice <number> – Tech Domain"', !!mm, { subject });
    if (mm) {
      check('subject uses the en dash (–) from the ticket', /–/.test(subject), { subject });
      const num = mm[1];
      const known = [String(invoiceId), detail.invoiceNumber, detail.referenceId, after.invoiceNumber].filter(Boolean).map(String);
      check(`subject invoice number "${num}" matches the invoice (${known.join('/')})`, known.some((k) => num.includes(k) || k.includes(num)), { num, known });
      check('e-mail body mentions the same invoice number', got.text.includes(num), { num });
    }
  }

  // 4. what the customer sees in the app
  const cl = await getJson(cust, '/invoices?limit=10&page=1');
  const row = (cl.body?.data?.invoices || []).find((i) => i.id === invoiceId);
  check('invoice is listed for the customer', !!row, { status: row?.status, id: invoiceId });
  results.customerView = row || null;

  await mailCtx.close();
  const summary = results.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
  for (const c of results.checks) if (!c.ok) results.findings.push(c.name);
  log(`\nSUMMARY\ninvoice ${invoiceId} for WO ${WO_ID}; subject: ${subject}\n${summary}\nFINDINGS: ${results.findings.join(' | ') || 'none'}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), `invoice ${invoiceId} for WO ${WO_ID}\nsubject: ${subject}\n\n${summary}\n\nFindings:\n${results.findings.join('\n') || 'none'}\n`);
});
