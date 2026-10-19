// After the customer-room send fix: can an engineer who only REQUESTED a work order still open their own chat with
// Tech Domain (API POST /chats/room/group + UI Messages tab)? And after assignment?
// Run: npx playwright test tests/chat-requested-engineer-room.spec.js
const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API_URL = 'https://api.dev.techdomain.com.au/api';
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'ChatModule-Full', `requested-engineer-room-${RUN}`);
test.setTimeout(300_000);

async function apiLogin(account) {
  const c = await pwRequest.newContext({ extraHTTPHeaders: H });
  const r = await c.post(u('/auth/login'), { data: { email: account.email, password: account.password } });
  const b = await r.json(); await c.dispose();
  const api = await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${b.accessToken}` } });
  return { api, id: (b.data || b.user || {}).id, account };
}
async function call(s, m, p, data) { const r = await s.api[m](u(p), data === undefined ? undefined : { data }); return { status: r.status(), body: await r.json().catch(() => ({})) }; }
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

test('requested engineer opens own chat (API + UI), then assigned', async ({ browser }) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => console.log(m);
  const results = { run: RUN, checks: [] };
  const check = (name, ok, detail) => { results.checks.push({ name, ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${name} :: ${JSON.stringify(detail)}`); expect.soft(ok, name).toBe(true); };
  const tdOwner = await apiLogin(accounts.find((a) => a.role === 'TechDomain User'));
  const engAcc = accounts.find((a) => a.role === 'Individual Engineer');
  let eng = await apiLogin(engAcc);
  const t = (await call(tdOwner, 'get', '/workOrders/242')).body?.data || {};
  const start = new Date(Date.now() + 12 * 86_400_000); start.setUTCHours(9, 0, 0, 0); const day = start.toISOString().slice(0, 10);
  const payload = {
    templateId: null, title: `Requested engineer chat ${RUN}`, serviceLevelAgreeement: '', clientId: 104, projectId: t.project?.id || null,
    teamId: '8ae534d5-d80c-49d9-8ac3-849fc63a927f', secondaryTeamId: 'cf0ed3db-521f-4c9f-887b-d5301383f8ce', teamName: 'Service Delivery 3', secondaryTeamName: 'Operation 3',
    isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'retest', confidentialInformation: '',
    categoryId: t.category?.id, workOrderServices: (t.workOrderServices || []).map((s) => ({ serviceId: s.serviceId || s.id })),
    scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T09:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'UTC', addressId: t.address?.id,
    qualificationSubTypes: [], expenses: [], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: 20, minimumHours: 4,
    nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null,
    engineerExpenses: [], engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', engineerHourlyRate: 15, engineerAdditionalHourlyRate: null, engineerHalfDayRate: null, engineerFullDayRate: null, engineerFthRate: null, engineerFixedAmount: null, engineerMinimumHours: 4,
    isDraft: false, tasks: ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] })), contacts: [], workOrderManagerId: null, customerFiles: [],
  };
  const cr = await call(tdOwner, 'post', '/workOrders', payload);
  const wo = cr.body?.data?.id || cr.body?.id;
  const ref = (await call(tdOwner, 'get', `/workOrders/${wo}`)).body?.data?.referenceId;
  results.wo = wo; results.ref = ref;
  log(`WO ${wo} ref ${ref}`);
  const rq = await call(eng, 'post', '/offers/engineer/request', { workOrderId: wo });
  log(`engineer request -> ${rq.status}`);
  await new Promise((r) => setTimeout(r, 2000));

  // REQUESTED: API open
  let open = await call(eng, 'post', '/chats/room/group', { workOrderId: wo, companyId: 9, engineerId: eng.id });
  check('REQUESTED: engineer can open their own room via API (POST /chats/room/group)', open.status < 300, { status: open.status, message: open.body?.message });
  // REQUESTED: UI
  const geo = { geolocation: { latitude: 31.5203696, longitude: 74.3587473 }, permissions: ['geolocation'], viewport: { width: 1440, height: 900 } };
  let ctx = await browser.newContext(geo); let page = await ctx.newPage(); page.setDefaultTimeout(15_000);
  const errs = []; page.on('console', (m) => { if (/joinError|not authorized|403/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
  await uiLogin(page, engAcc);
  await page.goto(`/workOrder/messages/${wo}`); await page.waitForTimeout(7_000);
  await page.screenshot({ path: path.join(EVIDENCE, '01_requested-engineer-messages-tab.png') });
  let composer = page.locator('.ql-editor').first();
  let hasComposer = (await composer.count()) > 0 && (await composer.isVisible().catch(() => false));
  let sent = false;
  if (hasComposer) { await composer.click().catch(() => { }); await composer.fill(`UI msg at REQUESTED ${RUN}`); await page.keyboard.press('Enter'); await page.waitForTimeout(4_000); sent = (await page.locator('body').innerText()).includes(`UI msg at REQUESTED ${RUN}`); await page.screenshot({ path: path.join(EVIDENCE, '02_requested-engineer-after-send.png') }); }
  const toast = await page.locator('.Toastify, [role="alert"]').allInnerTexts().catch(() => []);
  check('REQUESTED: engineer UI Messages tab shows a composer and the message is sent', hasComposer && sent, { hasComposer, sent, consoleErrors: errs.slice(0, 3), toast });
  await ctx.close();
  eng = await apiLogin(engAcc);
  const rooms1 = (await call(tdOwner, 'get', `/chats/users/${wo}/9`)).body?.data?.map((r) => ({ id: r.id, room: r.chatRoomId, name: r.firstName }));
  log(`rooms after REQUESTED UI: ${JSON.stringify(rooms1)}`);
  // can TD see/answer the requested engineer's message?
  const engRoom = rooms1?.find((r) => r.id === eng.id)?.room;
  if (engRoom) { const th = await call(tdOwner, 'get', `/inbox/${engRoom}?limit=0&markAsRead=false`); check('REQUESTED: Tech Domain sees the engineer room and its message', th.status === 200 && JSON.stringify(th.body).includes(`UI msg at REQUESTED ${RUN}`), { status: th.status, room: engRoom }); }
  else check('REQUESTED: an engineer room exists for the requesting engineer', false, { rooms: rooms1 });

  // ASSIGN
  const asg = await call(tdOwner, 'post', '/offers/assign', { workOrderId: wo, userId: eng.id });
  const st = (await call(tdOwner, 'get', `/workOrders/${wo}`)).body?.data;
  log(`assign -> ${asg.status} ${JSON.stringify(asg.body).slice(0, 120)}; status ${st?.status} engineer ${st?.engineerId || st?.engineer?.id}`);
  check('work order assigned to the engineer', st?.status === 'ASSIGNED', { status: st?.status });
  open = await call(eng, 'post', '/chats/room/group', { workOrderId: wo, companyId: 9, engineerId: eng.id });
  check('ASSIGNED: engineer can open their own room via API', open.status < 300, { status: open.status, message: open.body?.message });
  ctx = await browser.newContext(geo); page = await ctx.newPage(); page.setDefaultTimeout(15_000);
  await uiLogin(page, engAcc);
  await page.goto(`/workOrder/messages/${wo}`); await page.waitForTimeout(7_000);
  await page.screenshot({ path: path.join(EVIDENCE, '03_assigned-engineer-messages-tab.png') });
  composer = page.locator('.ql-editor').first();
  hasComposer = (await composer.count()) > 0 && (await composer.isVisible().catch(() => false));
  sent = false;
  if (hasComposer) { await composer.click().catch(() => { }); await composer.fill(`UI msg at ASSIGNED ${RUN}`); await page.keyboard.press('Enter'); await page.waitForTimeout(4_000); sent = (await page.locator('body').innerText()).includes(`UI msg at ASSIGNED ${RUN}`); await page.screenshot({ path: path.join(EVIDENCE, '04_assigned-engineer-after-send.png') }); }
  check('ASSIGNED: engineer UI Messages tab works', hasComposer && sent, { hasComposer, sent });
  await ctx.close();
  eng = await apiLogin(engAcc);
  // and the customer room is still protected
  const custRoom = (await call(tdOwner, 'get', `/chats/users/${wo}/9`)).body?.data?.find((r) => r.isCustomerChat)?.chatRoomId;
  const leak = await call(eng, 'post', `/inbox/${custRoom}/message`, { message: `<p>leak retest ${RUN}</p>` });
  check('ASSIGNED: engineer still cannot post into the customer room', leak.status === 403, { room: custRoom, status: leak.status });
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
});
