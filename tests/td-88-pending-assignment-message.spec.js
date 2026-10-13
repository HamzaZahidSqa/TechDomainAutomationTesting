// TD-88: "Wrong Work Order Message Opens from Pending Assignment"
// https://techdomain.atlassian.net/browse/TD-88
//
// For several PUBLISHED work orders that have pending offers:
//   Work order -> Providers -> Pending Assignments -> "Message" on a provider
//   must open /workOrder/messages/<SAME work order id>?engineerId=<that provider>,
//   the Messages page must show the same reference number, and the chat-users API call
//   must be made for the same work order.
// Evidence: evidence/TD-88-PendingAssignmentMessage/run-<stamp>/TD-88_PendingMsg_NN_<step>.png

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-88-PendingAssignmentMessage', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const byRole = (r) => accounts.find((a) => a.role === r);
// Work orders with offers in Pending Assignments (override: WO_IDS=938,408,763)
const WO_IDS = (process.env.WO_IDS || '938,408,763').split(',').map((s) => Number(s.trim())).filter(Boolean);

test.setTimeout(300_000);

let shotNo = 0;
async function shot(page, name) {
  shotNo += 1;
  await page.screenshot({ path: path.join(EVIDENCE, `TD-88_PendingMsg_${String(shotNo).padStart(2, '0')}_${name}.png`) });
}

async function apiLogin(account) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: { Origin: 'https://dev.techdomain.com.au' } });
  const res = await ctx.post(u('/auth/login'), { data: { email: account.email, password: account.password } });
  const body = await res.json().catch(() => ({}));
  await ctx.dispose();
  if (!body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${res.status()}`);
  return await pwRequest.newContext({ extraHTTPHeaders: { Origin: 'https://dev.techdomain.com.au', Authorization: `Bearer ${body.accessToken}` } });
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

test('TD-88: Message from Pending Assignments opens the chat of the same work order', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 600) }); };
  const clientAcc = byRole('TechDomain User');
  const api = await apiLogin(clientAcc);
  const results = [];

  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1000 }, geolocation: { latitude: 31.4689, longitude: 74.2636 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  await uiLogin(page, clientAcc);

  for (const woId of WO_IDS) {
    const r = { woId };
    // expected data from the API
    const det = await (await api.get(u(`/workOrders/${woId}`))).json().catch(() => ({}));
    const wo = det.data || det;
    r.referenceId = wo.referenceId; r.title = wo.title; r.status = wo.status;
    const offersRes = await (await api.post(u(`/offers/${woId}`), { data: { limit: 50, page: 1 } })).json().catch(() => ({}));
    const offers = offersRes.data?.offers || [];
    r.offerUserIds = offers.map((o) => o.user?.id).filter(Boolean);
    log(`WO ${woId} #${r.referenceId} "${r.title}" status=${r.status} offers=${JSON.stringify(offers.map((o) => `${o.user?.id}:${o.user?.firstName} ${o.user?.lastName} [${o.status}]`))}`);

    // capture chat-users / offers calls made by the Messages page
    const chatCalls = [];
    const onReq = (req) => { const url = req.url(); if (/\/chats\/users\/\d+\/\d+|\/chats\/\d+|\/inbox\//.test(url)) chatCalls.push(url.replace(API_URL, '')); };
    page.on('request', onReq);

    // 1. Providers -> Pending Assignments
    await page.goto(`/workOrder/providers/${woId}?tab=pending`);
    await page.waitForTimeout(4_000);
    await shot(page, `wo${woId}-providers-pending-assignments`);

    // 2. click "Message" for the first provider row
    let clicked = false;
    const direct = page.getByRole('button', { name: /^Message$/i }).first();
    if (await direct.count()) { await direct.click(); clicked = true; }
    if (!clicked) {
      // actions menu: x from the "Action" header, y from the first non-header data row (a row that shows a name link)
      const hdr = await page.getByText(/^Action$/i).first().boundingBox().catch(() => null);
      const rows = page.locator('[role="row"], tr').filter({ hasNot: page.getByText(/REQUESTED OFFERS|COUNTER OFFERS|ROUTED OFFERS/) }).filter({ has: page.locator('a, img, [class*="avatar" i]') });
      const n = await rows.count();
      for (let i = 0; i < n && !clicked; i++) {
        const rb = await rows.nth(i).boundingBox();
        if (!hdr || !rb || rb.y <= hdr.y) continue;
        await page.mouse.click(hdr.x + hdr.width / 2, rb.y + rb.height / 2);
        await page.waitForTimeout(800);
        const item = page.locator('li, [role="menuitem"], button, p, span', { hasText: /^Message$/i }).first();
        if (await item.count()) { await shot(page, `wo${woId}-actions-menu`); await item.click(); clicked = true; }
        else await page.keyboard.press('Escape');
      }
    }
    r.clicked = clicked;
    if (!clicked) { log(`WO ${woId}: could not find a Message action`); page.off('request', onReq); results.push(r); continue; }

    // 3. where did it go?
    await page.waitForURL(/\/workOrder\/messages\//, { timeout: 20_000 }).catch(() => { });
    await page.waitForTimeout(4_000);
    r.url = page.url().replace(/^https?:\/\/[^/]+/, '');
    const m = r.url.match(/\/workOrder\/messages\/(\d+)(?:\?.*engineerId=(\d+))?/);
    r.urlWoId = m ? Number(m[1]) : null;
    r.urlEngineerId = m && m[2] ? Number(m[2]) : null;
    const body = await page.locator('body').innerText();
    r.pageShowsReference = r.referenceId ? body.includes(`#${r.referenceId}`) : null;
    r.pageShowsTitle = r.title ? body.includes(r.title) : null;
    r.chatCalls = [...new Set(chatCalls)];
    r.chatCallsSameWo = r.chatCalls.filter((c) => /\/chats\/users\/\d+\//.test(c)).every((c) => c.includes(`/chats/users/${woId}/`));
    await shot(page, `wo${woId}-messages-page-opened`);
    page.off('request', onReq);
    log(`WO ${woId}: url=${r.url} -> woId=${r.urlWoId} engineerId=${r.urlEngineerId}; page shows #${r.referenceId}=${r.pageShowsReference}, title=${r.pageShowsTitle}; chat calls=${JSON.stringify(r.chatCalls)}`);
    results.push(r);
  }
  await ctx.close();
  fs.writeFileSync(path.join(EVIDENCE, `TD-88_results_${RUN}.json`), JSON.stringify(results, null, 2));

  for (const r of results) {
    expect.soft(r.clicked, `WO ${r.woId}: Message action found`).toBe(true);
    if (!r.clicked) continue;
    expect.soft(r.urlWoId, `WO ${r.woId}: Messages URL must be for the same work order`).toBe(r.woId);
    expect.soft(r.offerUserIds.includes(r.urlEngineerId), `WO ${r.woId}: engineerId ${r.urlEngineerId} should be one of the offer providers ${JSON.stringify(r.offerUserIds)}`).toBe(true);
    expect.soft(r.pageShowsReference, `WO ${r.woId}: Messages page shows reference #${r.referenceId}`).toBe(true);
    expect.soft(r.chatCallsSameWo, `WO ${r.woId}: chat-users API called for the same work order`).toBe(true);
  }
});
