// TD-113 follow-up: the "Send Invoice" dialog driven from the web UI (Tech Domain owner), with a CC address.
// Checks (a) the UI result (toast / dialog), (b) the invoice status via API, (c) who receives the e-mail:
// the customer billing inbox and the CC inbox (the web app appends ccEmails under the "toEmail" FormData key).
//
// Run:  INVOICE_ID=109 npx playwright test tests/td-113-ui-send-invoice.spec.js
// Evidence: evidence/TD-113-InvoiceEmailSubject/ui-run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-113-InvoiceEmailSubject', `ui-run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const INVOICE_ID = Number(process.env.INVOICE_ID || 109);
const CC_EMAIL = process.env.CC_EMAIL || 'td113-cc-check@mailinator.com';

test.setTimeout(400_000);
let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `TD-113_UI_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: true }).catch(() => { }); return path.basename(f); }
async function apiLogin(account) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: H });
  const res = await ctx.post(u('/auth/login'), { data: { email: account.email, password: account.password } });
  const body = await res.json().catch(() => ({})); await ctx.dispose();
  if (!body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${res.status()}`);
  return { api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${body.accessToken}` } }) };
}
async function getJson(s, p) { const r = await s.api.get(u(p)); return { status: r.status(), body: await r.json().catch(() => ({})) }; }
async function uiLogin(page, account) {
  await page.goto('/login');
  await page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first().fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Log in")').first().click();
  await expect(page).not.toHaveURL(/\/login|sign-?in/i, { timeout: 30_000 });
  await page.waitForTimeout(2_000);
}
async function inboxRows(page, email, subject) {
  const inbox = email.split('@')[0];
  await page.goto(`https://www.mailinator.com/v4/public/inboxes.jsp?to=${encodeURIComponent(inbox)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4_000);
  const rows = page.locator('tr').filter({ hasText: subject });
  const n = await rows.count();
  return { n, texts: n ? (await rows.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()) : [] };
}

test('TD-113 UI: Send Invoice dialog with a CC address', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 700) }); };
  const results = { run: RUN, invoiceId: INVOICE_ID, ccEmail: CC_EMAIL, checks: [], findings: [] };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); };
  const tdAcc = accounts.find((a) => a.role === 'TechDomain User');
  const custAcc = testAccounts.find((a) => a.role === 'Customer');
  const td = await apiLogin(tdAcc);

  const before = (await getJson(td, `/invoices/details/${INVOICE_ID}`)).body?.data || {};
  log(`invoice ${INVOICE_ID} before: ${before.status} client=${before.client?.clientName}`);
  expect(before.status, 'invoice must be GENERATED to send').toBe('GENERATED');

  const mailCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const mail = await mailCtx.newPage(); mail.setDefaultTimeout(15_000);
  const custBefore = (await inboxRows(mail, custAcc.email, new RegExp(`INV-#${INVOICE_ID}`))).n;
  const ccBefore = (await inboxRows(mail, CC_EMAIL, /invoice/i)).n;
  log(`inbox baseline: customer ${custBefore}, cc ${ccBefore}`);

  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(15_000);
  const apiCalls = [];
  page.on('response', async (r) => { if (/\/invoices\/send\//.test(r.url())) { let b = ''; try { b = (await r.text()).slice(0, 300); } catch { } apiCalls.push({ url: r.url(), status: r.status(), body: b, requestBody: r.request().postData()?.slice(0, 600) }); } });
  await uiLogin(page, tdAcc);
  await page.goto('/invoices/customer');
  await page.waitForTimeout(5_000);
  await shot(page, 'customer-invoices-list');
  // open the invoice (row containing the id, or the newest row)
  const row = page.locator('tr, [role="row"]', { hasText: new RegExp(`\\b${INVOICE_ID}\\b`) }).first();
  if (await row.count()) await row.click(); else await page.goto(`/invoices/customer/${INVOICE_ID}`);
  await page.waitForTimeout(5_000);
  log(`invoice page url: ${page.url()}`);
  await shot(page, 'invoice-detail');
  const sendBtn = page.locator('button', { hasText: /^\s*Send Invoice\s*$/i }).first();
  check('"Send Invoice" button is visible on the invoice page', await sendBtn.isVisible().catch(() => false), { url: page.url() });
  await sendBtn.click();
  await page.waitForTimeout(2_000);
  const dialog = page.locator('[role="dialog"], .MuiDialog-root, .MuiModal-root').last();
  await shot(page, 'send-dialog');
  const dialogText = (await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`dialog: ${dialogText.slice(0, 300)}`);
  const inputs = dialog.locator('input:not([type="checkbox"]):not([type="radio"]), textarea');
  const nInputs = await inputs.count();
  const values = []; for (let i = 0; i < nInputs; i++) values.push({ name: await inputs.nth(i).getAttribute('name'), value: await inputs.nth(i).inputValue().catch(() => '') });
  log(`dialog inputs: ${JSON.stringify(values)}`);
  const toInput = dialog.locator('input[name="billingToEmail"]').first();
  check('Company Email is prefilled with the customer billing e-mail', (await toInput.inputValue().catch(() => '')) === custAcc.email, { value: await toInput.inputValue().catch(() => '') });
  const ccInput = dialog.locator('input[name="ccEmails"], textarea[name="ccEmails"]').first();
  await ccInput.fill(CC_EMAIL);
  await shot(page, 'send-dialog-filled');
  await dialog.locator('button', { hasText: /^\s*Send Invoice\s*$/i }).first().click();
  await page.waitForTimeout(6_000);
  const toast = (await page.locator('.MuiAlert-message, .MuiSnackbar-root, [role="alert"], .Toastify__toast').allInnerTexts().catch(() => [])).join(' | ');
  const dialogStillOpen = await dialog.isVisible().catch(() => false);
  await shot(page, 'after-send');
  log(`toast: ${toast || '(none)'} | dialog open: ${dialogStillOpen} | send calls: ${JSON.stringify(apiCalls)}`);
  results.ui = { toast, dialogStillOpen, apiCalls };
  check('UI sent the request to /invoices/send', apiCalls.length > 0, { apiCalls });
  if (apiCalls[0]?.requestBody) {
    const keys = [...apiCalls[0].requestBody.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
    log(`multipart keys sent by the UI: ${keys.join(', ')}`);
    results.ui.multipartKeys = keys;
    check('UI sends the CC address under a "ccEmails" key (not "toEmail")', keys.includes('ccEmails'), { keys });
  }
  const after = (await getJson(td, `/invoices/details/${INVOICE_ID}`)).body?.data || {};
  check('invoice status is UNPAID after UI send', after.status === 'UNPAID', { status: after.status, message: apiCalls[0]?.body });
  await ctx.close();

  await mail.waitForTimeout(8_000);
  const custAfter = await inboxRows(mail, custAcc.email, new RegExp(`INV-#${INVOICE_ID}`));
  const ccAfter = await inboxRows(mail, CC_EMAIL, /invoice/i);
  await shot(mail, 'cc-inbox');
  log(`customer inbox rows for INV-#${INVOICE_ID}: ${custAfter.n} ${JSON.stringify(custAfter.texts)}`);
  log(`cc inbox rows: ${ccAfter.n} ${JSON.stringify(ccAfter.texts)}`);
  check('customer billing inbox received the invoice e-mail', custAfter.n > custBefore, { before: custBefore, after: custAfter.n });
  check('CC inbox received the invoice e-mail', ccAfter.n > ccBefore, { before: ccBefore, after: ccAfter.n, rows: ccAfter.texts });
  results.inbox = { customer: custAfter, cc: ccAfter };
  await mailCtx.close();

  const summary = results.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
  for (const c of results.checks) if (!c.ok) results.findings.push(c.name);
  log(`\nSUMMARY\n${summary}\nFINDINGS: ${results.findings.join(' | ') || 'none'}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n');
});
