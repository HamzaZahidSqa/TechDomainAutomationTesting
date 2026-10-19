// Browser-side probe for the "engineer posts into the customer room" bug: the engineer logs in to the web app, and from
// that logged-in tab (DevTools console style) calls the inbox send API with the token the web app stores; the customer
// then checks the thread. Also prints where the web app keeps the token so the tester can repeat it manually.
// Run: WO_ID=1074 CUSTOMER_ID=638 ROOM_ID=1921 npx playwright test tests/chat-engineer-customer-room-ui.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const WO = Number(process.env.WO_ID || 1074);
const ROOM = Number(process.env.ROOM_ID || 1921);
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'ChatModule-Full', `ui-probe-${RUN}`);
test.setTimeout(240_000);

async function uiLogin(page, account) {
  await page.goto('/login');
  const email = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
  await expect(email).toBeVisible({ timeout: 20_000 });
  await email.fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in")').first().click();
  await expect(page).not.toHaveURL(/\/login|sign-?in/i, { timeout: 30_000 });
  await page.waitForTimeout(2_500);
}
const dismissFeedback = async (page) => { const c = page.locator('button:has-text("Cancel")').first(); if (await c.count() && await c.isVisible().catch(() => false)) { await c.click().catch(() => { }); await page.waitForTimeout(800); } };

test('engineer sends into the customer room from the logged-in browser tab', async ({ browser }) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => console.log(m);
  const text = `Browser console probe ${RUN} from engineer`;
  const geo = { geolocation: { latitude: 31.5203696, longitude: 74.3587473 }, permissions: ['geolocation'], viewport: { width: 1440, height: 900 } };

  const ctx = await browser.newContext(geo);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  await uiLogin(page, accounts.find((a) => a.role === 'Individual Engineer'));
  await page.goto(`/workOrder/messages/${WO}`);
  await page.waitForTimeout(6_000);
  await dismissFeedback(page);
  await page.screenshot({ path: path.join(EVIDENCE, '01_engineer-messages-tab.png') });
  // where does the web app keep the token?
  const storage = await page.evaluate(() => {
    const out = { local: {}, session: {} };
    for (const [name, st] of [['local', localStorage], ['session', sessionStorage]]) for (let i = 0; i < st.length; i++) { const k = st.key(i); const v = st.getItem(k) || ''; out[name][k] = v.length > 60 ? v.slice(0, 25) + '…(' + v.length + ' chars)' : v; }
    return out;
  });
  log(`storage: ${JSON.stringify(storage)}`);
  const cookies = (await ctx.cookies()).map((c) => c.name);
  log(`cookies: ${JSON.stringify(cookies)}`);
  // the same call a tester can paste into DevTools console in the engineer's tab
  const result = await page.evaluate(async ({ room, text }) => {
    const find = (st) => { for (let i = 0; i < st.length; i++) { const k = st.key(i); const v = st.getItem(k) || ''; const m = v.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/); if (m) return { key: k, token: m[0] }; } return null; };
    const t = find(localStorage) || find(sessionStorage);
    if (!t) return { error: 'no JWT found in storage' };
    const r = await fetch(`https://api.dev.techdomain.com.au/api/inbox/${room}/message`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` }, body: JSON.stringify({ message: `<p>${text}</p>` }) });
    const g = await fetch(`https://api.dev.techdomain.com.au/api/inbox/${room}?limit=0`, { headers: { Authorization: `Bearer ${t.token}` } });
    return { tokenKey: t.key, sendStatus: r.status, sendBody: (await r.text()).slice(0, 120), readStatus: g.status };
  }, { room: ROOM, text });
  log(`engineer from browser tab: ${JSON.stringify(result)}`);
  await ctx.close();

  const c2 = await browser.newContext(geo);
  const p2 = await c2.newPage();
  p2.setDefaultTimeout(15_000);
  await uiLogin(p2, testAccounts.find((a) => a.role === 'Customer'));
  await p2.goto(`/workOrder/messages/${WO}`);
  await p2.waitForTimeout(7_000);
  await dismissFeedback(p2);
  const custBody = await p2.locator('body').innerText().catch(() => '');
  log(`customer sees the engineer's message in the customer room: ${custBody.includes(text)}`);
  await p2.screenshot({ path: path.join(EVIDENCE, '02_customer-room-after-engineer-send.png') });
  const msgIcon = p2.locator('i[class*="fa-message"], i[class*="fa-comment"], i[class*="fa-envelope"]').first();
  if (await msgIcon.count()) { await msgIcon.click({ force: true }).catch(() => { }); await p2.waitForTimeout(2_000); await p2.screenshot({ path: path.join(EVIDENCE, '03_customer-message-notifications.png') }); }
  await c2.close();
});
