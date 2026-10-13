// TD-50: "Customer profile submit API accepts submission without required Company Details and Accounts fields"
// https://techdomain.atlassian.net/browse/TD-50
//
// Uses three throwaway accounts with EMPTY profiles (signed up today, see test-accounts.json):
//   customer -> GET /clients/customer/submitProfile
//   engineer -> GET /users/engineer/submitProfile
//   vendor   -> GET /companies/submitProfile
// If an account is still unverified (login 307), the OTP is read from its Mailinator inbox and verified first.
// Expected per ticket: 400 with the missing fields, status stays PENDING, no admin "Profile Submitted" notification.
// Evidence: evidence/TD-50-SubmitProfileValidation/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-50-SubmitProfileValidation', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const H = { Origin: 'https://dev.techdomain.com.au' };

const TARGETS = [
  { key: 'customer', role: 'Customer', endpoint: '/clients/customer/submitProfile', notifTitle: /Customer Profile Submitted/i },
  { key: 'engineer', role: 'Individual Engineer', endpoint: '/users/engineer/submitProfile', notifTitle: /^Profile Submitted/i },
  { key: 'vendor', role: 'Vendor', endpoint: '/companies/submitProfile', notifTitle: /Company Profile Submitted/i },
];

test.setTimeout(420_000);

let shotNo = 0;
async function shot(page, name) {
  shotNo += 1;
  await page.screenshot({ path: path.join(EVIDENCE, `TD-50_SubmitProfile_${String(shotNo).padStart(2, '0')}_${name}.png`) });
}

async function login(email, password) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: H, maxRedirects: 0 });
  const res = await ctx.post(u('/auth/login'), { data: { email, password } });
  const body = await res.json().catch(() => ({}));
  await ctx.dispose();
  return { status: res.status(), token: body.accessToken, user: body.user };
}
async function authed(token) { return pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${token}` } }); }
async function me(api) { const j = await (await api.get(u('/users/me'))).json().catch(() => ({})); return j.user || j.data || j; }

// Read the newest 6-digit OTP from a Mailinator public inbox
async function readOtp(page, email, log) {
  const inbox = email.split('@')[0];
  await page.goto(`https://www.mailinator.com/v4/public/inboxes.jsp?to=${encodeURIComponent(inbox)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4_000);
  const rows = page.locator('tr').filter({ hasText: /otp|verif|code|welcome|confirm/i });
  const n = await rows.count();
  log(`Mailinator ${inbox}: ${n} candidate row(s)`);
  if (!n) return null;
  await rows.first().click();
  await page.waitForTimeout(4_000);
  let text = '';
  for (const f of page.frames()) { try { text += '\n' + (await f.locator('body').innerText({ timeout: 3_000 })); } catch { } }
  const m = text.match(/\b(\d{6})\b/);
  return m ? m[1] : null;
}

test('TD-50: submitProfile APIs reject empty profiles for customer, engineer and vendor', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 600) }); };
  const adminAcc = accounts.find((a) => a.role === 'Admin');
  const results = [];

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);

  for (const t of TARGETS) {
    const acc = testAccounts.find((a) => a.role === t.role);
    const r = { key: t.key, email: acc?.email, endpoint: t.endpoint };
    results.push(r);
    if (!acc) { r.error = 'no account in test-accounts.json'; continue; }

    // 1. login, verifying the OTP from Mailinator if needed
    let l = await login(acc.email, acc.password);
    if (l.status === 307) {
      log(`${t.key}: unverified (307); OTP re-sent, reading Mailinator`);
      await page.waitForTimeout(3_000);
      // several OTP emails may be in the inbox (signup + resends); try each candidate until one verifies
      const inbox = acc.email.split('@')[0];
      await page.goto(`https://www.mailinator.com/v4/public/inboxes.jsp?to=${encodeURIComponent(inbox)}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4_000);
      const rowCount = await page.locator('tr').filter({ hasText: /Verify OTP/i }).count();
      log(`${t.key}: ${rowCount} "Verify OTP" email(s) in Mailinator`);
      for (let i = 0; i < Math.min(rowCount, 4) && !l.token; i++) {
        await page.goto(`https://www.mailinator.com/v4/public/inboxes.jsp?to=${encodeURIComponent(inbox)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3_000);
        await page.locator('tr').filter({ hasText: /Verify OTP/i }).nth(i).click();
        await page.waitForTimeout(3_500);
        let text = '';
        for (const f of page.frames()) { try { text += '\n' + (await f.locator('body').innerText({ timeout: 3_000 })); } catch { } }
        // the code is rendered letter-spaced after "One Time Password (OTP)"; digits may come through with spaces
        const after = text.slice(Math.max(0, text.search(/One Time Password/i)));
        const otp = ((after.match(/(?:\d\s*){6}/) || [''])[0]).replace(/\s+/g, '') || null;
        log(`${t.key}: candidate ${i + 1} otp=${otp}`);
        if (i === 0) await shot(page, `${t.key}-otp-email`);
        if (!otp) continue;
        const v = await pwRequest.newContext({ extraHTTPHeaders: H });
        const vr = await v.post(u('/otps/verify'), { data: { email: acc.email, code: otp } });
        log(`${t.key}: otps/verify (candidate ${i + 1}) -> HTTP ${vr.status()}`);
        await v.dispose();
        if (vr.ok()) l = await login(acc.email, acc.password);
      }
      r.otpFound = !!l.token;
    }
    r.loginStatus = l.status;
    if (!l.token) { r.error = `login failed (HTTP ${l.status})`; log(`${t.key}: ${r.error}`); continue; }
    const api = await authed(l.token);
    const before = await me(api);
    r.userId = before.id; r.statusBefore = before.status;
    log(`${t.key}: user ${before.id} status before = ${before.status}`);

    // admin notifications snapshot (ids) before the call
    const adminL = await login(adminAcc.email, adminAcc.password);
    const admin = await authed(adminL.token);
    const nb = await (await admin.get(u('/notifications/others?limit=10'))).json().catch(() => ({}));
    const idsBefore = new Set((nb.data?.data || nb.data || []).map((n) => n.id));

    // 2. the submit call
    const res = await api.get(u(t.endpoint));
    const text = await res.text();
    r.submitStatus = res.status();
    r.submitBody = text.slice(0, 400);
    log(`${t.key}: GET ${t.endpoint} -> HTTP ${res.status()} ${text.slice(0, 200)}`);

    // 3. status after, admin notification after
    await page.waitForTimeout(2_000);
    const after = await me(api);
    r.statusAfter = after.status;
    const na = await (await admin.get(u('/notifications/others?limit=10'))).json().catch(() => ({}));
    const newNotifs = (na.data?.data || na.data || []).filter((n) => !idsBefore.has(n.id));
    r.newAdminNotifs = newNotifs.map((n) => `${n.title}: ${n.content}`);
    r.adminGotSubmitted = newNotifs.some((n) => t.notifTitle.test(n.title || '') || /submitted/i.test(n.content || ''));
    log(`${t.key}: status after = ${after.status}; new admin notifications = ${JSON.stringify(r.newAdminNotifs)}`);
    await api.dispose(); await admin.dispose();
  }

  // UI evidence: the customer's complete-profile page with the disabled Submit button
  const cust = testAccounts.find((a) => a.role === 'Customer');
  try {
    await page.goto('/login');
    await page.locator('input[type="email"], input[name="email"]').first().fill(cust.email);
    await page.locator('input[type="password"]').first().fill(cust.password);
    await page.locator('button[type="submit"], button:has-text("Login")').first().click();
    await page.waitForTimeout(5_000);
    await page.goto('/completeYourProfile');
    await page.waitForTimeout(5_000);
    await shot(page, 'customer-ui-complete-profile-page');
    const submitBtn = page.locator('button', { hasText: /^(Submit|Submitted|Resubmit)$/i }).first();
    const uiSubmit = (await submitBtn.count()) ? { text: (await submitBtn.innerText()).trim(), disabled: await submitBtn.isDisabled() } : null;
    log(`customer UI: url=${page.url()} submit button=${JSON.stringify(uiSubmit)}`);
    results.push({ key: 'customer-ui', url: page.url(), submitButton: uiSubmit });
  } catch (e) { log(`customer UI step failed: ${e.message.slice(0, 150)}`); }
  await ctx.close();

  fs.writeFileSync(path.join(EVIDENCE, `TD-50_results_${RUN}.json`), JSON.stringify(results, null, 2));

  for (const r of results.filter((x) => x.endpoint)) {
    if (r.error) { expect.soft(false, `${r.key}: ${r.error}`).toBe(true); continue; }
    expect.soft(r.submitStatus, `${r.key}: ${r.endpoint} on an empty profile should return 400 (got ${r.submitStatus}: ${r.submitBody})`).toBe(400);
    expect.soft(r.statusAfter, `${r.key}: status should stay ${r.statusBefore} (got ${r.statusAfter})`).toBe(r.statusBefore);
    expect.soft(r.adminGotSubmitted, `${r.key}: admin must not receive a "Profile Submitted" notification`).toBe(false);
  }
});
