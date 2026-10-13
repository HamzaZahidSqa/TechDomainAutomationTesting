// TD-41: "Display Profile Incomplete Reason in Email and Notification"
// https://techdomain.atlassian.net/browse/TD-41
//
// Flow:
//   1. Admin (UI) opens /admin/review/engineers, finds the Individual Engineer, Actions -> Send Email,
//      "Send a custom email" with a reason, Confirm. Engineer status becomes Incomplete (UNAPPROVE).
//   2. Engineer: API notifications must contain a PROFILE_INCOMPLETE entry whose content is the reason;
//      UI: login and screenshot the in-app notification.
//   3. Mailinator public inbox: the "Important: Action Required" email must contain the reason.
//   4. Vendor (company owner): same via API with the document-list template (ID, RATES), then notification + email.
//   5. Restore both accounts to APPROVED.
// Evidence: evidence/TD-41-ProfileIncompleteReason/TD-41_ProfileIncomplete_NN_<step>.png

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-41-ProfileIncompleteReason', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const byRole = (r) => accounts.find((a) => a.role === r);

test.setTimeout(420_000);

let shotNo = 0;
async function shot(page, name) {
  shotNo += 1;
  const file = path.join(EVIDENCE, `TD-41_ProfileIncomplete_${String(shotNo).padStart(2, '0')}_${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function apiLogin(account) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: { Origin: 'https://dev.techdomain.com.au' } });
  const res = await ctx.post(u('/auth/login'), { data: { email: account.email, password: account.password } });
  const body = await res.json().catch(() => ({}));
  await ctx.dispose();
  if (!res.ok() || !body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 200)}`);
  const api = await pwRequest.newContext({ extraHTTPHeaders: { Origin: 'https://dev.techdomain.com.au', Authorization: `Bearer ${body.accessToken}` } });
  const me = await api.get(u('/users/me'));
  const mj = await me.json().catch(() => ({}));
  const user = mj.user || mj.data || mj;
  return { account, api, user, id: user.id, status: user.status };
}

async function uiLogin(page, account) {
  await page.goto('/login');
  const email = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
  await expect(email).toBeVisible({ timeout: 20_000 });
  await email.fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in")').first().click();
  await expect(page).not.toHaveURL(/login|sign-?in/i, { timeout: 30_000 });
  await page.waitForTimeout(1_500);
}

async function latestProfileIncompleteNotification(session) {
  const res = await session.api.get(u('/notifications/others?limit=10'));
  const j = await res.json().catch(() => ({}));
  const list = j?.data?.data || j?.data || [];
  return list.find((n) => n.type === 'PROFILE_INCOMPLETE') || null;
}

// Read the newest Mailinator email whose subject matches; returns { subject, bodyText, found }
async function readMailinator(page, inbox, subjectRe, mustContain, log) {
  await page.goto(`https://www.mailinator.com/v4/public/inboxes.jsp?to=${encodeURIComponent(inbox)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4_000);
  const rows = page.locator('tr').filter({ hasText: subjectRe });
  const count = await rows.count();
  log(`Mailinator ${inbox}: ${count} row(s) matching ${subjectRe}`);
  if (!count) return { found: false };
  await rows.first().click();
  await page.waitForTimeout(4_000);
  let bodyText = '';
  for (const f of page.frames()) {
    try { bodyText += '\n' + (await f.locator('body').innerText({ timeout: 3_000 })); } catch { }
  }
  return { found: true, bodyText, hasReason: bodyText.includes(mustContain) };
}

test('TD-41: incomplete-profile reason reaches the engineer and vendor by notification and email', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 600) }); };

  const adminAcc = byRole('Admin');
  const engAcc = byRole('Individual Engineer');
  const vendorAcc = byRole('Vendor');
  const admin = await apiLogin(adminAcc);
  const eng0 = await apiLogin(engAcc);
  const vendor0 = await apiLogin(vendorAcc);
  log(`engineer id=${eng0.id} status=${eng0.status}; vendor id=${vendor0.id} status=${vendor0.status}`);

  const engReason = `TD41 ${RUN}: Insurance document is missing/invalid. Please upload a valid certificate.`;
  const results = {};

  try {
    // ---------- 1. Admin UI: mark engineer incomplete with a custom reason ----------
    // The "Send Email" action only exists for PENDING / SUBMITTED / UNAPPROVE engineers (an Active engineer's menu
    // is View Profile / Deactivate). Our test engineer is Active, so first move them to UNAPPROVE via the API
    // (document-list template, no custom text) to represent a profile waiting for review.
    const prep = await admin.api.post(u('/admin/request/resubmitMissingDocuments'), { data: { emailTemplate: ['ID'], engineerId: eng0.id } });
    log(`prep: engineer -> UNAPPROVE via API: HTTP ${prep.status()}`);
    // Wide viewport: the engineers grid virtualises columns, so Email/Actions only exist in the DOM when they fit.
    const ctxAdmin = await browser.newContext({ viewport: { width: 2400, height: 1000 } });
    const pageA = await ctxAdmin.newPage();
    pageA.setDefaultTimeout(15_000); // never let one click wait for the whole test timeout
    await uiLogin(pageA, adminAcc);
    await pageA.goto('/admin/review/engineers');
    const search = pageA.locator('input[placeholder*="Search" i]').first();
    await expect(search).toBeVisible({ timeout: 30_000 });
    await search.fill(engAcc.email);
    await pageA.waitForTimeout(2_500);
    await shot(pageA, 'admin-engineers-list-before');

    // MUI DataGrid rows are div[role=row]; match on the engineer id cell (always rendered) rather than the email column.
    const row = pageA.locator('[role="row"], tr').filter({ has: pageA.getByText(String(eng0.id), { exact: true }) }).first();
    let adminUiDone = false;
    log(`admin grid: engineer row found = ${await row.count()}`);
    if (await row.count()) {
      // Click the "..." by coordinates: x from the "Actions" column header, y from the row.
      const hdr = await pageA.getByText('Actions', { exact: true }).first().boundingBox();
      const rb = await row.boundingBox();
      if (hdr && rb) await pageA.mouse.click(hdr.x + hdr.width / 2, rb.y + rb.height / 2);
      else await row.locator('[role="cell"], td').last().click({ timeout: 10_000 }).catch(() => { });
      await pageA.waitForTimeout(800);
      await shot(pageA, 'admin-actions-menu');
      const sendEmail = pageA.locator('li, [role="menuitem"], button, p, span', { hasText: /^Send Email$/i }).first();
      if (await sendEmail.count()) {
        await sendEmail.click({ timeout: 10_000 });
        await pageA.waitForTimeout(1_000);
        await shot(pageA, 'admin-send-email-modal');
        const custom = pageA.locator('label, span, p', { hasText: /send a custom email/i }).first();
        await custom.click().catch(() => { });
        const ta = pageA.locator('textarea').first();
        await expect(ta).toBeVisible({ timeout: 10_000 });
        await ta.fill(engReason);
        await shot(pageA, 'admin-custom-reason-typed');
        const respP = pageA.waitForResponse((r) => r.url().includes('resubmitMissingDocuments'), { timeout: 20_000 });
        await pageA.locator('button', { hasText: /^Confirm$/i }).first().click({ timeout: 10_000 });
        const resp = await respP;
        const rj = await resp.json().catch(() => ({}));
        log(`admin UI resubmitMissingDocuments -> HTTP ${resp.status()} ${JSON.stringify(rj).slice(0, 300)}`);
        results.adminUiStatus = resp.status();
        adminUiDone = resp.ok();
        await pageA.waitForTimeout(2_000);
        await shot(pageA, 'admin-engineer-status-incomplete');
      }
    }
    if (!adminUiDone) {
      log('Admin UI path not completed; falling back to API for the engineer.');
      const r = await admin.api.post(u('/admin/request/resubmitMissingDocuments'), { data: { emailTemplate: ['CUSTOM_EMAIL'], emailContent: engReason, engineerId: eng0.id } });
      log(`API resubmit (engineer) -> HTTP ${r.status()} ${(await r.text()).slice(0, 300)}`);
      results.adminUiStatus = r.status();
    }
    await ctxAdmin.close();

    // ---------- 2. Engineer: API + UI notification ----------
    const eng = await apiLogin(engAcc);
    log(`engineer status after admin action = ${eng.status}`);
    results.engStatusAfter = eng.status;
    const engNotif = await latestProfileIncompleteNotification(eng);
    log(`engineer PROFILE_INCOMPLETE notification: ${JSON.stringify(engNotif && { id: engNotif.id, title: engNotif.title, content: engNotif.content, url: engNotif.url, createdAt: engNotif.createdAt })}`);
    results.engNotif = engNotif;

    // /jobs waits on geolocation; headless has none, so grant a fixed position (Lahore) to clear the loading backdrop.
    const ctxE = await browser.newContext({ viewport: { width: 1440, height: 900 }, geolocation: { latitude: 31.4689, longitude: 74.2636 }, permissions: ['geolocation'] });
    const pageE = await ctxE.newPage();
    pageE.setDefaultTimeout(15_000);
    await uiLogin(pageE, engAcc);
    await pageE.waitForTimeout(3_000);
    await shot(pageE, 'engineer-landing-after-incomplete');
    log(`engineer landed on ${pageE.url()}`);
    let bell = pageE.locator('i[class*="fa-bell"], [aria-label*="notification" i]').first();
    if (!(await bell.count())) { await pageE.goto('/analytics').catch(() => { }); await pageE.waitForTimeout(2_000); bell = pageE.locator('i[class*="fa-bell"]').first(); }
    results.engBellVisible = (await bell.count()) > 0 && (await bell.isVisible().catch(() => false));
    if (results.engBellVisible) {
      await bell.click({ timeout: 10_000, force: true }).catch(() => { });
      await pageE.waitForTimeout(2_500);
      await shot(pageE, 'engineer-notification-dropdown');
      results.engUiShowsReason = (await pageE.locator('body').innerText()).includes(engReason.slice(0, 40));
      log(`engineer UI dropdown shows reason: ${results.engUiShowsReason}`);
    } else {
      log('engineer UI: no notification bell on the landing page (completeYourProfile is a full-page route).');
    }
    await ctxE.close();

    // ---------- 3. Mailinator: engineer email ----------
    const ctxM = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageM = await ctxM.newPage();
    pageM.setDefaultTimeout(15_000);
    const engInbox = engAcc.email.split('@')[0];
    const mail1 = await readMailinator(pageM, engInbox, /Important: Action Required|Action Required/i, engReason.slice(0, 40), log);
    await shot(pageM, 'engineer-email-mailinator');
    results.engEmail = mail1;
    log(`engineer email found=${mail1.found} hasReason=${mail1.hasReason}`);

    // ---------- 4. Vendor via API (document-list template) ----------
    // The admin UI login invalidates the earlier API token (single session), so log in again.
    const adminB = await apiLogin(adminAcc);
    const r2 = await adminB.api.post(u('/admin/request/resubmitMissingDocuments'), { data: { emailTemplate: ['ID', 'RATES'], engineerId: vendor0.id } });
    log(`API resubmit (vendor, ID+RATES) -> HTTP ${r2.status()} ${(await r2.text()).slice(0, 300)}`);
    results.vendorApiStatus = r2.status();
    const vendor = await apiLogin(vendorAcc);
    results.vendorStatusAfter = vendor.status;
    const vNotif = await latestProfileIncompleteNotification(vendor);
    log(`vendor PROFILE_INCOMPLETE notification: ${JSON.stringify(vNotif && { id: vNotif.id, title: vNotif.title, content: vNotif.content, url: vNotif.url, createdAt: vNotif.createdAt })}`);
    results.vendorNotif = vNotif;

    const ctxV = await browser.newContext({ viewport: { width: 1440, height: 900 }, geolocation: { latitude: 31.4689, longitude: 74.2636 }, permissions: ['geolocation'] });
    const pageV = await ctxV.newPage();
    pageV.setDefaultTimeout(15_000);
    await uiLogin(pageV, vendorAcc);
    await pageV.waitForTimeout(3_000);
    await shot(pageV, 'vendor-landing-after-incomplete');
    let vbell = pageV.locator('i[class*="fa-bell"]').first();
    if (await vbell.count()) {
      await vbell.click({ timeout: 10_000, force: true }).catch(() => { });
      await pageV.waitForTimeout(2_500);
      await shot(pageV, 'vendor-notification-dropdown');
      results.vendorUiShowsNotif = (await pageV.locator('body').innerText()).includes('Complete Your Profile');
    }
    await ctxV.close();

    const vendorInbox = vendorAcc.email.split('@')[0];
    const mail2 = await readMailinator(pageM, vendorInbox, /Missing Documents|Action Required/i, 'ID', log);
    await shot(pageM, 'vendor-email-mailinator');
    results.vendorEmail = mail2;
    log(`vendor email found=${mail2.found}`);
    await ctxM.close();
  } finally {
    // ---------- 5. Restore (fresh admin token: the earlier one returned 401 after the admin UI login) ----------
    const admin2 = await apiLogin(adminAcc);
    for (const id of [eng0.id, vendor0.id]) {
      const r = await admin2.api.get(u(`/admin/approveProfile/${id}`));
      log(`restore approveProfile/${id} -> HTTP ${r.status()}`);
    }
    const engAfter = await apiLogin(engAcc); const venAfter = await apiLogin(vendorAcc);
    log(`restored: engineer=${engAfter.status} vendor=${venAfter.status}`);
    // History check after re-approval: is the reason still retrievable?
    const engHist = await latestProfileIncompleteNotification(engAfter);
    log(`after re-approval, engineer still has PROFILE_INCOMPLETE notification: ${!!engHist} (content: ${engHist?.content?.slice(0, 80)})`);
    results.historyKept = !!engHist;
    fs.writeFileSync(path.join(EVIDENCE, `TD-41_results_${RUN}.json`), JSON.stringify(results, null, 2));
  }

  // ---------- assertions ----------
  expect.soft(results.engStatusAfter, 'engineer status should be UNAPPROVE (Incomplete) after admin action').toBe('UNAPPROVE');
  expect.soft(results.engNotif?.content, 'engineer in-app notification must carry the admin reason').toContain(engReason.slice(0, 40));
  expect.soft(results.engEmail?.found, 'engineer email should be in Mailinator').toBe(true);
  expect.soft(results.engEmail?.hasReason, 'engineer email must contain the admin reason').toBe(true);
  expect.soft(results.vendorStatusAfter, 'vendor status should be UNAPPROVE after admin action').toBe('UNAPPROVE');
  expect.soft(results.vendorNotif, 'vendor must get a PROFILE_INCOMPLETE notification').toBeTruthy();
  expect.soft(results.vendorEmail?.found, 'vendor email should be in Mailinator').toBe(true);
  expect.soft(results.historyKept, 'reason should remain in history after re-approval').toBe(true);
});
