// TD-123: "Enable Direct and Group Chat Between Customer, Customer Sub-user, and Tech Domain"
// https://techdomain.atlassian.net/browse/TD-123  (sub-tasks TD-124, TD-125)
//
// Expected behaviour (from the user's description):
//   Whoever creates the work order (Customer owner, Customer sub-user, Tech Domain owner or a Tech Domain team member),
//   the work order's group chat contains: the customer owner, the customer sub-users, the Tech Domain owner and the
//   Tech Domain team. Any message by any of them reaches all the others and produces a notification for all the others.
//   Nobody outside that group may see the room, the messages or receive a notification.
//
// Scenarios (creator):  S1 customer owner, S2 customer sub-user, S3 Tech Domain owner, S4 Tech Domain team member.
// For every scenario:
//   1. create the work order
//   2. find the customer <-> Tech Domain room and compare its participants with the expected set
//   3. record who received the "work order created" notification
//   4. every participant we control sends one message (REST inbox send = same effects as the socket send)
//   5. every participant sees all messages and has a MESSAGE notification for every message not their own
//   6. non-participants (same-company user outside the team, other-company customer, vendor, engineer):
//      room not in inbox, GET conversation/room 403, cannot send, no notification for that work order / room
//   7. (S1, S2) Tech Domain owner accepts (approvePublish) -> customer owner AND sub-user get the notification
//   8. UI evidence: chat page + bell for the sub-user and the team member; chat URL for the non-team user
//
// One-time setup (persisted in td123-accounts.json): approve customer 103, create a customer sub-user (password read
// from Mailinator), create two Tech Domain company users (one added to team "Service Delivery 3", one in no team).
//
// Run:  npx playwright test tests/td-123-group-chat-notifications.spec.js
// Evidence: evidence/TD-123-GroupChatNotifications/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const TD123_FILE = path.join(__dirname, '..', 'td123-accounts.json');
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-123-GroupChatNotifications', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };

const COMPANY_ID = 9;                 // Tech Domain
const PARENT_CUSTOMER_ID = 103;       // "Customer Company 10090955" (owner = customer-10090955@mailinator.com)
const ENTITY_ID = 104;                // child entity of 103
const TEAM_SD3 = '8ae534d5-d80c-49d9-8ac3-849fc63a927f';   // Service Delivery 3
const TEAM_OP3 = 'cf0ed3db-521f-4c9f-887b-d5301383f8ce';   // Operation 3
const BRANCH_ID = 1;
const DESIGNATION_SERVICE_DELIVERY = 4;
const TEMPLATE_WO = Number(process.env.TEMPLATE_WO || 242);
const DEFAULT_TASKS = ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] }));

test.setTimeout(1_500_000);

// ---------------------------------------------------------------- helpers
let shotNo = 0;
async function shot(page, name) {
  shotNo += 1;
  const file = path.join(EVIDENCE, `TD-123_GroupChat_${String(shotNo).padStart(2, '0')}_${name}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => { });
  return path.basename(file);
}

async function rawLogin(email, password) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: H });
  const res = await ctx.post(u('/auth/login'), { data: { email, password } });
  const body = await res.json().catch(() => ({}));
  await ctx.dispose();
  return { status: res.status(), body };
}

async function apiLogin(account, label) {
  const l = await rawLogin(account.email, account.password);
  if (!l.body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${l.status} ${JSON.stringify(l.body).slice(0, 200)}`);
  const api = await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${l.body.accessToken}` } });
  const user = l.body.data || l.body.user || {};
  const s = { label: label || account.role, account, api, user, id: user.id, role: String(user.role?.role || user.role || '').toUpperCase(), status: user.status };
  // dev invalidates a user's token on any new login for that user; re-login transparently on 401
  s.relogin = async () => {
    const n = await rawLogin(account.email, account.password);
    if (!n.body.accessToken) return false;
    s.api = await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${n.body.accessToken}` } });
    return true;
  };
  return s;
}
async function call(s, method, p, data) {
  const opts = data === undefined ? undefined : { data };
  let r = await s.api[method](u(p), opts);
  if (r.status() === 401 && s.relogin && (await s.relogin())) r = await s.api[method](u(p), opts);
  const body = await r.json().catch(async () => ({ text: await r.text().catch(() => '') }));
  return { status: r.status(), body };
}
const getJson = (s, p) => call(s, 'get', p);
const postJson = (s, p, data) => call(s, 'post', p, data);
const patchJson = (s, p, data) => call(s, 'patch', p, data);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uiLogin(page, account) {
  await page.goto('/login');
  const email = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
  await expect(email).toBeVisible({ timeout: 20_000 });
  await email.fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in")').first().click();
  await expect(page).not.toHaveURL(/\/login|sign-?in/i, { timeout: 30_000 });
  await page.waitForTimeout(2_500);
  // first login of a generated account: the app forces a new password (stored back in td123-accounts.json)
  if (/createNewPassword/i.test(page.url())) {
    const fresh = 'Td123Pass@2026x';
    const pw = page.locator('input[type="password"]');
    await pw.nth(0).fill(fresh);
    await pw.nth(1).fill(fresh);
    await page.locator('button:has-text("Create New Password"), button[type="submit"]').first().click();
    await page.waitForTimeout(4_000);
    account.password = fresh;
    const list = loadTd123();
    const row = list.find((a) => a.email === account.email);
    if (row) { row.password = fresh; row.note = `${row.note || ''}; password changed by first UI login`; saveTd123(list); }
    if (/createNewPassword|\/login/i.test(page.url())) {
      // some builds log the user out after the change: log in again with the new password
      await page.goto('/login');
      await page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first().fill(account.email);
      await page.locator('input[type="password"]').first().fill(fresh);
      await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in")').first().click();
      await expect(page).not.toHaveURL(/\/login|sign-?in/i, { timeout: 30_000 });
      await page.waitForTimeout(2_500);
    }
  }
}

// Newest Mailinator email whose row matches `subject`; returns the visible text of the message body.
async function readMailinator(page, email, subject, log) {
  const inbox = email.split('@')[0];
  for (let attempt = 1; attempt <= 6; attempt++) {
    await page.goto(`https://www.mailinator.com/v4/public/inboxes.jsp?to=${encodeURIComponent(inbox)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4_000);
    const rows = page.locator('tr').filter({ hasText: subject });
    const n = await rows.count();
    log(`Mailinator ${inbox}: attempt ${attempt}, ${n} row(s) matching ${subject}`);
    if (n) {
      await rows.first().click();
      await page.waitForTimeout(4_000);
      let text = '';
      for (const f of page.frames()) { try { text += '\n' + (await f.locator('body').innerText({ timeout: 3_000 })); } catch { } }
      return text;
    }
    await page.waitForTimeout(5_000);
  }
  return '';
}

// Make sure an account can log in; verify the OTP from Mailinator when the API answers 307.
async function ensureVerified(page, acc, log) {
  let l = await rawLogin(acc.email, acc.password);
  if (l.status !== 307) return l;
  log(`${acc.email}: login 307 (unverified) - reading OTP from Mailinator`);
  await page.waitForTimeout(3_000);
  const text = await readMailinator(page, acc.email, /Verify OTP|OTP/i, log);
  const after = text.slice(Math.max(0, text.search(/One Time Password/i)));
  const otp = ((after.match(/(?:\d\s*){6}/) || [''])[0]).replace(/\s+/g, '');
  log(`${acc.email}: otp=${otp || 'not found'}`);
  if (otp) {
    const v = await pwRequest.newContext({ extraHTTPHeaders: H });
    const vr = await v.post(u('/otps/verify'), { data: { email: acc.email, code: otp } });
    log(`${acc.email}: otps/verify -> HTTP ${vr.status()}`);
    await v.dispose();
    l = await rawLogin(acc.email, acc.password);
  }
  return l;
}

function loadTd123() { try { return JSON.parse(fs.readFileSync(TD123_FILE, 'utf8')); } catch { return []; } }
function saveTd123(list) { fs.writeFileSync(TD123_FILE, JSON.stringify(list, null, 2)); }

function clientWoPayload(t, title, clientId) {
  const start = new Date(Date.now() + 3 * 86_400_000); start.setHours(10, 0, 0, 0);
  const day = start.toISOString().slice(0, 10);
  return {
    templateId: null, title, serviceLevelAgreeement: t.serviceLevelAgreeement || '', clientId,
    projectId: t.project?.id || null, teamId: TEAM_SD3, secondaryTeamId: TEAM_OP3, teamName: 'Service Delivery 3', secondaryTeamName: 'Operation 3',
    isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '',
    description: 'TD-123 QA automation (group chat + notifications)', confidentialInformation: '',
    categoryId: t.category?.id, workOrderServices: (t.workOrderServices || []).map((s) => ({ serviceId: s.serviceId || s.id })),
    scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null,
    timeZone: t.timeZone || 'Asia/Karachi', addressId: t.address?.id || t.addressId,
    qualificationSubTypes: (t.qualificationSubTypes || []).map((q) => q.id),
    expenses: [], paymentType: 'HOURLY', paymentTerms: t.paymentTerms || '15 days', currency: t.currency || 'USD', hourlyRate: t.hourlyRate || 20, minimumHours: t.minimumHours || 4,
    nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null,
    engineerExpenses: [], engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', engineerHourlyRate: 15, engineerAdditionalHourlyRate: null, engineerHalfDayRate: null, engineerFullDayRate: null, engineerFthRate: null, engineerFixedAmount: null, engineerMinimumHours: 4,
    isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [],
  };
}
function customerWoPayload(title) {
  const start = new Date(Date.now() + 3 * 86_400_000); start.setHours(10, 0, 0, 0);
  const day = start.toISOString().slice(0, 10);
  return {
    templateId: null, title, serviceLevelAgreeement: '', clientId: ENTITY_ID, projectId: null, teamId: null, secondaryTeamId: null, teamName: '', secondaryTeamName: '',
    isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '',
    description: 'TD-123 QA automation (customer ticket)', confidentialInformation: '',
    categoryId: null, workOrderServices: [],
    scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'Asia/Karachi',
    // location fields are flat on CreateWorkOrderDto (a new Address row is created when there is no addressId)
    addressId: null, isRemote: false, addressLine1: 'Lahore, Pakistan', addressLine2: '', city: 'Lahore', country: 'Pakistan', state: 'Punjab', zipCode: '54000',
    latitude: 31.5203696, longitude: 74.3587473, displayName: 'lahore', locationType: 'RESIDENTIAL',
    qualificationSubTypes: [], expenses: [], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: 45, minimumHours: 5,
    nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null,
    isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [],
  };
}

const notifList = (b) => (Array.isArray(b?.data) ? b.data : (b?.data?.data || b?.data?.notifications || []));
async function woNotifications(s, woId) {
  const r = await getJson(s, '/notifications/others?limit=30');
  return notifList(r.body).filter((n) => n.workOrderId === woId).map((n) => ({ id: n.id, type: n.type, title: n.title, content: String(n.content || '').replace(/<[^>]+>/g, '').slice(0, 120) }));
}
// GET /notifications = MESSAGE notifications (one per message) followed by the others; /notifications/chat is unusable (array-like object)
async function chatNotifications(s, roomId) {
  const r = await getJson(s, '/notifications');
  const list = notifList(r.body);
  return list.filter((n) => n.type === 'MESSAGE' && n.chatRoomId === roomId).map((n) => ({ id: n.id, senderId: n.senderId, url: n.url, text: String(n.content || '').replace(/<[^>]+>/g, '') }));
}
async function conversation(s, convId) {
  const r = await getJson(s, `/inbox/${convId}?limit=0&markAsRead=false`);
  const conv = r.body?.data?.conversation || r.body?.conversation || {};
  const msgs = r.body?.data?.messages || r.body?.messages || [];
  return { status: r.status, participants: (conv.participants || []).map((p) => p.id), texts: msgs.map((m) => String(m.message || m.text || '').replace(/<[^>]+>/g, '')) };
}

// ---------------------------------------------------------------- the test
test('TD-123: work-order group chat participants, message delivery, notifications and no leaks', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 700) }); };
  const results = { run: RUN, setup: {}, scenarios: [], findings: [] };
  const finding = (txt) => { results.findings.push(txt); log(`FINDING: ${txt}`); };

  const byRole = (r) => accounts.find((a) => a.role === r);
  const td123 = loadTd123();
  const saved = (role) => td123.find((a) => a.role === role && a.email && a.password && a.password !== 'see inbox');

  const mailCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mailPage = await mailCtx.newPage();
  mailPage.setDefaultTimeout(15_000);

  // ---------- sessions ----------
  const admin = await apiLogin(byRole('Admin'), 'Admin');
  let tdOwner = await apiLogin(byRole('TechDomain User'), 'TD owner');
  expect(tdOwner.user.isCompanyOwner, 'TechDomain User must be the company owner').toBeTruthy();
  const custOwnerAcc = testAccounts.find((a) => a.role === 'Customer');
  let custOwner = await apiLogin(custOwnerAcc, 'Customer owner');
  log(`TD owner id=${tdOwner.id}; customer owner id=${custOwner.id} status=${custOwner.status}`);

  // ---------- setup 1: approve the customer (needed for ticket creation and for "Add User") ----------
  if (custOwner.status !== 'APPROVED') {
    const ap = await postJson(admin, `/admin/customers/${PARENT_CUSTOMER_ID}/approve`, { branchId: BRANCH_ID, teamId: TEAM_SD3, secondaryTeamId: TEAM_OP3 });
    log(`admin approve customer ${PARENT_CUSTOMER_ID} -> HTTP ${ap.status} ${JSON.stringify(ap.body).slice(0, 200)}`);
    custOwner = await apiLogin(custOwnerAcc, 'Customer owner');
    log(`customer owner status now ${custOwner.status}`);
  }
  results.setup.customerOwner = { id: custOwner.id, email: custOwnerAcc.email, status: custOwner.status };

  // ---------- setup 2: customer sub-user ----------
  let subAcc = saved('Customer Sub-user');
  if (!subAcc) {
    const email = `td123-subuser-${RUN}@mailinator.com`;
    const cr = await postJson(custOwner, '/customerUsers/createUser', { firstName: 'Subuser', lastName: 'Tdtest', phoneNumber: '+61400000123', email });
    log(`create sub-user -> HTTP ${cr.status} ${JSON.stringify(cr.body).slice(0, 200)}`);
    expect(cr.status, 'sub-user created').toBeLessThan(300);
    await mailPage.waitForTimeout(5_000);
    const text = await readMailinator(mailPage, email, /Welcome/i, log);
    await shot(mailPage, 'subuser-welcome-email');
    const m = text.match(/password\s*[:\-–]?\s*([^\s<]+)/i);
    log(`welcome email text around password: ${JSON.stringify(text.slice(Math.max(0, text.search(/password/i) - 40), text.search(/password/i) + 80))}`);
    expect(m, 'generated password found in the welcome email').toBeTruthy();
    subAcc = { role: 'Customer Sub-user', email, password: m[1], note: `created ${new Date().toISOString().slice(0, 10)} under customer ${PARENT_CUSTOMER_ID} by TD-123 test`, inbox: `https://www.mailinator.com/v4/public/inboxes.jsp?to=${email.split('@')[0]}` };
    td123.push(subAcc); saveTd123(td123);
  }
  let subLogin = await ensureVerified(mailPage, subAcc, log);
  expect(subLogin.body.accessToken, `sub-user ${subAcc.email} can log in (HTTP ${subLogin.status})`).toBeTruthy();
  let subUser = await apiLogin(subAcc, 'Customer sub-user');
  log(`sub-user id=${subUser.id} role=${subUser.role} status=${subUser.status} customer=${subUser.user.customer?.id}`);
  results.setup.subUser = { id: subUser.id, email: subAcc.email, status: subUser.status };

  // ---------- setup 3: two Tech Domain company users (team member + non-team control) ----------
  async function ensureCompanyUser(role, firstName, lastName) {
    let acc = saved(role);
    if (!acc) {
      const email = `td123-${role.toLowerCase().replace(/[^a-z]+/g, '')}-${RUN}@mailinator.com`;
      const password = 'Td123User@2026x';
      const cr = await postJson(tdOwner, '/companies/users', { firstName, lastName, designation: DESIGNATION_SERVICE_DELIVERY, password, email, phoneNumber: '+61400000124', country: 'Australia', city: 'Sydney', timeZone: 'Australia/Sydney' });
      log(`create company user ${role} -> HTTP ${cr.status} ${JSON.stringify(cr.body).slice(0, 200)}`);
      expect(cr.status, `${role} created`).toBeLessThan(300);
      acc = { role, email, password, note: `created ${new Date().toISOString().slice(0, 10)} under Tech Domain (company ${COMPANY_ID}) by TD-123 test`, inbox: `https://www.mailinator.com/v4/public/inboxes.jsp?to=${email.split('@')[0]}` };
      td123.push(acc); saveTd123(td123);
    }
    const l = await ensureVerified(mailPage, acc, log);
    expect(l.body.accessToken, `${role} ${acc.email} can log in (HTTP ${l.status})`).toBeTruthy();
    return acc;
  }
  const teamAcc = await ensureCompanyUser('TD Team Member', 'Teammember', 'Tdtest');
  const nonTeamAcc = await ensureCompanyUser('TD Non-team User', 'Nonteam', 'Tdtest');
  let teamMember = await apiLogin(teamAcc, 'TD team member');
  let nonTeam = await apiLogin(nonTeamAcc, 'TD non-team user');
  log(`team member id=${teamMember.id}; non-team user id=${nonTeam.id}`);

  // ---------- setup 4: put the team member into "Service Delivery 3" ----------
  const team = (await getJson(tdOwner, `/teams/${TEAM_SD3}`)).body?.data || {};
  const memberIds = (team.members || []).map((m) => m.teamMemberId || m.teamMember?.id).filter(Boolean);
  if (team.members && team.members[0]?.teamMember?.password) finding('GET /teams/:id returns each member\'s bcrypt password hash (teamMember.password) - should not be exposed');
  if (!memberIds.includes(teamMember.id)) {
    const up = await patchJson(tdOwner, `/teams/${TEAM_SD3}`, { name: team.name, email: team.email, departmentId: team.departmentId, members: [...memberIds, teamMember.id] });
    log(`add team member to SD3 -> HTTP ${up.status} ${JSON.stringify(up.body).slice(0, 200)}`);
  }
  const tm = await getJson(tdOwner, `/teams/teamMembers?teamIds=${TEAM_SD3},${TEAM_OP3}`);
  const teamMemberIds = (tm.body?.data || []).map((x) => x.id);
  log(`members of SD3 + OP3: ${JSON.stringify((tm.body?.data || []).map((x) => `${x.id}:${x.firstName} ${x.lastName}`))}`);
  expect(teamMemberIds, 'team member is in Service Delivery 3').toContain(teamMember.id);
  expect(teamMemberIds, 'non-team user is in no work-order team').not.toContain(nonTeam.id);
  results.setup.teamMember = { id: teamMember.id, email: teamAcc.email };
  results.setup.nonTeamUser = { id: nonTeam.id, email: nonTeamAcc.email };
  results.setup.teamMemberIds = teamMemberIds;

  // ---------- control (non-participant) sessions ----------
  const controls = [];
  for (const [role, label] of [['Customer', 'Other-company customer (Neomeric)'], ['Vendor', 'Vendor owner'], ['Individual Engineer', 'Individual engineer']]) {
    try { controls.push(await apiLogin(byRole(role), label)); } catch (e) { log(`control ${role} skipped: ${e.message.slice(0, 120)}`); }
  }

  // Business rule (confirmed by the user 2026-10-09): the customer sub-user is part of the group chat ONLY when the sub-user
  // created the work order. Otherwise the sub-user must get no chat, no messages and no notifications.
  const expectedParticipants = (withSubUser) => Array.from(new Set([custOwner.id, ...(withSubUser ? [subUser.id] : []), tdOwner.id, ...teamMemberIds])).sort((a, b) => a - b);
  const SKIP_WALK = !!process.env.SKIP_WALK;
  const template = (await getJson(tdOwner, `/workOrders/${TEMPLATE_WO}`)).body?.data;
  expect(template, `template WO ${TEMPLATE_WO} readable`).toBeTruthy();

  // ---------------------------------------------------------------- scenarios
  const scenarios = [
    { key: 'S1', creator: 'customerOwner', title: 'Customer owner creates the work order' },
    { key: 'S2', creator: 'subUser', title: 'Customer sub-user creates the work order' },
    { key: 'S3', creator: 'tdOwner', title: 'Tech Domain owner creates the work order' },
    { key: 'S4', creator: 'teamMember', title: 'Tech Domain team member creates the work order' },
  ];

  // WALK_WO=<id> runs only the status walk on an existing accepted (PUBLISHED) customer work order
  const WALK_WO = Number(process.env.WALK_WO) || null;
  for (const sc of (WALK_WO ? [] : scenarios)) {
    const S = { key: sc.key, title: sc.title, checks: [] };
    results.scenarios.push(S);
    const check = (name, ok, detail) => { S.checks.push({ name, ok: !!ok, detail }); log(`${sc.key} ${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''}`); expect.soft(!!ok, `${sc.key} ${name} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); };
    const sessions = () => ({ customerOwner: custOwner, subUser, tdOwner, teamMember });
    const creator = sessions()[sc.creator];
    log(`\n================ ${sc.key}: ${sc.title} (creator ${creator.label} id=${creator.id}) ================`);

    // 1. create
    const woTitle = `TD123 ${sc.key} ${RUN} by ${creator.label}`;
    const isCustomerCreator = creator.role === 'CUSTOMER';
    const payload = isCustomerCreator ? customerWoPayload(woTitle) : clientWoPayload(template, woTitle, ENTITY_ID);
    const created = await postJson(creator, '/workOrders', payload);
    log(`${sc.key} create WO -> HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
    const wo = created.body?.data?.id || created.body?.id;
    check('work order created', !!wo, { status: created.status, id: wo, message: created.body?.message });
    if (!wo) continue;
    S.workOrderId = wo;
    const woRec = (await getJson(tdOwner, `/workOrders/${wo}`)).body?.data || {};
    S.workOrder = { id: wo, referenceId: woRec.referenceId, status: woRec.status, team: woRec.team?.name, secondaryTeam: woRec.secondaryTeam?.name, clientId: woRec.clientId || woRec.client?.id };
    log(`${sc.key} WO ${wo} ref=${woRec.referenceId} status=${woRec.status} team=${woRec.team?.name}/${woRec.secondaryTeam?.name}`);
    await sleep(2_500);

    // 2. the customer <-> Tech Domain room
    let roomId = null, participantIds = [];
    const cu = await getJson(tdOwner, `/chats/users/${wo}/${COMPANY_ID}`);
    let row = (cu.body?.data || []).find((r) => r.isCustomerChat);
    if (!row) {
      const mk = await postJson(tdOwner, '/chats/room/group', { workOrderId: wo, companyId: COMPANY_ID, engineerId: custOwner.id });
      log(`${sc.key} no customer room listed -> POST /chats/room/group -> HTTP ${mk.status} ${JSON.stringify(mk.body).slice(0, 200)}`);
      const cu2 = await getJson(tdOwner, `/chats/users/${wo}/${COMPANY_ID}`);
      row = (cu2.body?.data || []).find((r) => r.isCustomerChat);
    }
    roomId = row?.chatRoomId || row?.conversationId || null;
    participantIds = (row?.participantIds || (row?.participants || []).map((p) => p.id)).slice().sort((a, b) => a - b);
    check('customer <-> Tech Domain room exists', !!roomId, { roomId, rowName: row?.firstName });
    if (!roomId) continue;
    S.roomId = roomId;
    const subIsCreator = sc.creator === 'subUser';
    const expected = expectedParticipants(subIsCreator);
    const missing = expected.filter((id) => !participantIds.includes(id));
    const extra = participantIds.filter((id) => !expected.includes(id));
    S.participants = { actual: participantIds, expected, missing, extra };
    check(subIsCreator ? 'room participants = customer owner + sub-user (creator) + TD owner + team' : 'room participants = customer owner + TD owner + team (sub-user NOT included)', missing.length === 0 && extra.length === 0, { actual: participantIds, missing, extra });
    if (!subIsCreator) check('customer sub-user is NOT a participant (did not create the work order)', !participantIds.includes(subUser.id), { subUserId: subUser.id });
    check('non-team company user is NOT a participant', !participantIds.includes(nonTeam.id), { nonTeamUserId: nonTeam.id });

    // every controlled participant can open the conversation
    const parts = subIsCreator ? [custOwner, subUser, tdOwner, teamMember] : [custOwner, tdOwner, teamMember];
    // when the sub-user did not create the work order they are treated like an outsider for this room
    const subAsControl = subIsCreator ? null : Object.assign({}, subUser, { label: 'Customer sub-user (not creator)' });
    const outsiders = () => [nonTeam, ...(subAsControl ? [subAsControl] : []), ...controls];
    for (const p of parts) {
      const c = await conversation(p, roomId);
      check(`${p.label} can open the room`, c.status === 200, { status: c.status, participants: c.participants });
    }

    // 3. who got the "work order created" notification
    S.createNotifications = {};
    for (const p of [...parts, ...outsiders()]) S.createNotifications[p.label] = await woNotifications(p, wo);
    log(`${sc.key} create notifications: ${JSON.stringify(S.createNotifications)}`);
    check('creator did not get a notification for their own action', (S.createNotifications[creator.label] || []).length === 0, S.createNotifications[creator.label]);
    if (isCustomerCreator) check('Tech Domain owner notified of the new ticket (TD-124)', (S.createNotifications['TD owner'] || []).length > 0, S.createNotifications['TD owner']);
    else {
      check('customer owner notified of the new work order', (S.createNotifications['Customer owner'] || []).length > 0, S.createNotifications['Customer owner']);
    }
    for (const c of outsiders()) check(`${c.label} got NO notification for this work order`, (S.createNotifications[c.label] || []).length === 0, S.createNotifications[c.label]);

    // 4. everybody sends one message
    const texts = {};
    for (const p of parts) {
      const text = `TD123 ${sc.key} ${RUN} message from ${p.label}`;
      const r = await postJson(p, `/inbox/${roomId}/message`, { message: `<p>${text}</p>`, clientMessageId: `td123-${sc.key}-${RUN}-${p.id}` });
      if (r.status < 300) texts[p.label] = text;
      check(`${p.label} can send a message`, r.status < 300, { status: r.status, message: r.body?.message });
      await sleep(1_500);
    }
    await sleep(3_000);

    // 5. everybody sees every message and has a notification for the others' messages
    S.delivery = {};
    for (const p of parts) {
      const c = await conversation(p, roomId);
      const seen = Object.entries(texts).map(([from, t]) => [from, c.texts.some((x) => x.includes(t))]);
      const notifs = await chatNotifications(p, roomId);
      const notified = Object.entries(texts).filter(([from]) => from !== p.label).map(([from, t]) => [from, notifs.some((n) => n.text.includes(t))]);
      const own = !!texts[p.label] && notifs.some((n) => n.text.includes(texts[p.label]));
      S.delivery[p.label] = { seen: Object.fromEntries(seen), notified: Object.fromEntries(notified), ownNotification: own, notificationUrl: notifs[0]?.url };
      if (p.role === 'CLIENT' && notifs.some((n) => /engineerId=null/.test(n.url || '')) && !results.findings.some((f) => f.includes('engineerId=null'))) finding(`MESSAGE notification url for the customer room is "${notifs.find((n) => /engineerId=null/.test(n.url)).url}" (engineerId=null) - INFO only: the web app navigates via chatRoomId and opens the right room (verified manually 2026-10-09); check the mobile app if it uses this url`);
      check(`${p.label} sees every sent message`, seen.every(([, ok]) => ok), Object.fromEntries(seen));
      check(`${p.label} has a MESSAGE notification for each other sender's message`, notified.every(([, ok]) => ok), Object.fromEntries(notified));
      check(`${p.label} has no notification for their own message`, !own, { own });
    }

    // 6. leak checks for non-participants
    S.leaks = {};
    for (const c of outsiders()) {
      const inbox = await getJson(c, '/inbox?limit=50');
      const listed = (inbox.body?.data || []).some((r) => r.conversationId === roomId || r.chatRoomId === roomId || r.workOrder?.id === wo);
      const conv = await conversation(c, roomId);
      const room = await getJson(c, `/chats/${roomId}?limit=5`);
      const send = await postJson(c, `/inbox/${roomId}/message`, { message: `<p>LEAK TEST ${sc.key} ${RUN} from ${c.label}</p>` });
      const chatN = await chatNotifications(c, roomId);
      const woN = await woNotifications(c, wo);
      const leak = { listedInInbox: listed, conversationStatus: conv.status, roomStatus: room.status, sendStatus: send.status, chatNotifications: chatN.length, woNotifications: woN.length };
      S.leaks[c.label] = leak;
      check(`${c.label}: room not in inbox`, !listed, leak);
      check(`${c.label}: conversation forbidden`, conv.status === 403 || conv.status === 404, leak);
      check(`${c.label}: room messages forbidden`, room.status === 403 || room.status === 404, leak);
      check(`${c.label}: cannot send`, send.status === 403 || send.status === 404, leak);
      check(`${c.label}: no MESSAGE notification for this room`, chatN.length === 0, leak);
      if (send.status < 300) finding(`${sc.key}: ${c.label} (id ${c.id}) could POST a message into room ${roomId} of WO ${wo} (HTTP ${send.status})`);
    }
    // a leaked message must not have reached the participants either
    const afterLeak = await conversation(tdOwner, roomId);
    check('no LEAK TEST message landed in the room', !afterLeak.texts.some((t) => t.includes('LEAK TEST')), { count: afterLeak.texts.filter((t) => t.includes('LEAK TEST')).length });

    // 7. accept the customer ticket (S1, S2): owner AND sub-user must be notified (TD-125)
    if (isCustomerCreator) {
      const beforeO = (await woNotifications(custOwner, wo)).map((n) => n.id);
      const beforeS = (await woNotifications(subUser, wo)).map((n) => n.id);
      const woFull = (await getJson(tdOwner, `/workOrders/${wo}`)).body?.data || {};
      const ap = await postJson(tdOwner, `/workOrders/${wo}/approvePublish`, {});
      log(`${sc.key} approvePublish -> HTTP ${ap.status} ${JSON.stringify(ap.body).slice(0, 300)}`);
      S.approve = { status: ap.status, message: ap.body?.message };
      if (ap.status >= 300) {
        // the API needs the work order to be complete; patch the fields a client would add on "Review & Publish"
        const fix = await patchJson(tdOwner, `/workOrders/${wo}`, { ...clientWoPayload(template, woFull.title || woTitle, ENTITY_ID), addressId: woFull.address?.id || woFull.addressId, address: undefined });
        log(`${sc.key} PATCH WO before re-approve -> HTTP ${fix.status} ${JSON.stringify(fix.body).slice(0, 200)}`);
        const ap2 = await postJson(tdOwner, `/workOrders/${wo}/approvePublish`, {});
        log(`${sc.key} approvePublish (2nd) -> HTTP ${ap2.status} ${JSON.stringify(ap2.body).slice(0, 300)}`);
        S.approve = { status: ap2.status, message: ap2.body?.message, afterPatch: fix.status };
      }
      await sleep(3_000);
      const afterO = (await woNotifications(custOwner, wo)).filter((n) => !beforeO.includes(n.id));
      const afterS = (await woNotifications(subUser, wo)).filter((n) => !beforeS.includes(n.id));
      S.acceptNotifications = { 'Customer owner': afterO, 'Customer sub-user': afterS };
      check('work order accepted by Tech Domain', S.approve.status < 300, S.approve);
      check('customer owner notified of acceptance (TD-125)', afterO.length > 0, afterO);
      if (subIsCreator) check('customer sub-user (creator) notified of acceptance (TD-125)', afterS.length > 0, afterS);
      else check('customer sub-user (not creator) NOT notified of acceptance', afterS.length === 0, afterS);
      for (const c of [nonTeam, ...controls]) { const n = (await woNotifications(c, wo)).filter((x) => x.type !== 'WORK_ORDER_PUBLISHED'); check(`${c.label}: no acceptance notification (marketplace broadcast ignored)`, n.length === 0, n); }
    }

    // 8. UI evidence (UI logins invalidate the API tokens of those users -> re-login afterwards)
    const uiUsers = [
      { acc: subAcc, s: subUser, url: `/workOrder/messages/${wo}`, name: 'subuser' },
      { acc: teamAcc, s: teamMember, url: `/workOrder/messages/${wo}?engineerId=${custOwner.id}`, name: 'teammember' },
      { acc: nonTeamAcc, s: nonTeam, url: `/workOrder/messages/${wo}?engineerId=${custOwner.id}`, name: 'nonteam' },
    ];
    for (const uu of uiUsers) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15_000);
      try {
        await uiLogin(page, uu.acc);
        log(`${sc.key} UI ${uu.name}: after login url=${page.url()}`);
        await shot(page, `${sc.key}-${uu.name}-after-login`);
        await page.goto(uu.url);
        await page.waitForTimeout(6_000);
        log(`${sc.key} UI ${uu.name}: chat url=${page.url()}`);
        const composer = page.locator('.ql-editor').first();
        const hasComposer = (await composer.count()) > 0 && (await composer.isVisible().catch(() => false));
        const bodyText = await page.locator('body').innerText().catch(() => '');
        const allVisible = Object.values(texts).every((t) => bodyText.includes(t));
        const f1 = await shot(page, `${sc.key}-${uu.name}-chat`);
        if (uu.name === 'nonteam') check('UI: non-team user does not get the customer conversation', !allVisible, { composer: hasComposer, messagesVisible: allVisible, shot: f1 });
        else if (uu.name === 'subuser' && !subIsCreator) check('UI: sub-user (not creator) does not get the chat', !allVisible && !hasComposer, { composer: hasComposer, messagesVisible: allVisible, shot: f1 });
        else check(`UI: ${uu.s.label} sees every sent message in the chat page`, allVisible, { composer: hasComposer, shot: f1 });
        const bell = page.locator('i[class*="fa-bell"], [aria-label*="notification" i]').first();
        if (await bell.count()) { await bell.click({ force: true }).catch(() => { }); await page.waitForTimeout(2_000); await shot(page, `${sc.key}-${uu.name}-bell`); }
        const msgIcon = page.locator('i[class*="fa-message"], i[class*="fa-comment"], i[class*="fa-envelope"]').first();
        if (await msgIcon.count()) { await msgIcon.click({ force: true }).catch(() => { }); await page.waitForTimeout(2_000); await shot(page, `${sc.key}-${uu.name}-messages-dropdown`); }
      } catch (e) {
        log(`${sc.key} UI ${uu.name}: ${e.message.slice(0, 200)}`);
        await shot(page, `${sc.key}-${uu.name}-error`);
      }
      await ctx.close();
    }
    subUser = await apiLogin(subAcc, 'Customer sub-user');
    teamMember = await apiLogin(teamAcc, 'TD team member');
    nonTeam = await apiLogin(nonTeamAcc, 'TD non-team user');

    // 9. after the non-team user merely opened the chat URL in the browser: did the socket join make them a participant?
    const cuAfter = await getJson(tdOwner, `/chats/users/${wo}/${COMPANY_ID}`);
    const rowAfter = (cuAfter.body?.data || []).find((r) => r.isCustomerChat);
    const partsAfter = (rowAfter?.participantIds || []).slice().sort((a, b) => a - b);
    const convAfter = await conversation(nonTeam, roomId);
    const probeText = `TD123 ${sc.key} ${RUN} post-UI probe from Customer owner`;
    await postJson(custOwner, `/inbox/${roomId}/message`, { message: `<p>${probeText}</p>` });
    await sleep(3_000);
    const nonTeamNotifs = await chatNotifications(nonTeam, roomId);
    const nonTeamConv = await conversation(nonTeam, roomId);
    S.postUiLeak = { participants: partsAfter, nonTeamIsParticipant: partsAfter.includes(nonTeam.id), nonTeamConversationStatus: convAfter.status, nonTeamSeesProbe: nonTeamConv.texts.some((t) => t.includes(probeText)), nonTeamNotifiedOfProbe: nonTeamNotifs.some((n) => n.text.includes(probeText)) };
    if (!subIsCreator) {
      S.postUiLeak.subUserIsParticipant = partsAfter.includes(subUser.id);
      check('after opening the page the sub-user (not creator) is still NOT a participant', !S.postUiLeak.subUserIsParticipant, S.postUiLeak);
      const subN = await chatNotifications(subUser, roomId);
      check('sub-user (not creator) got NO MESSAGE notification for the probe message', !subN.some((n) => n.text.includes(probeText)), { count: subN.length });
    }
    check('after opening the chat URL the non-team user is still NOT a participant', !S.postUiLeak.nonTeamIsParticipant, S.postUiLeak);
    check('after opening the chat URL the non-team user still cannot read the conversation', convAfter.status === 403 || convAfter.status === 404, S.postUiLeak);
    check('after opening the chat URL the non-team user gets NO notification for new messages', !S.postUiLeak.nonTeamNotifiedOfProbe, S.postUiLeak);
    if (S.postUiLeak.nonTeamIsParticipant || S.postUiLeak.nonTeamSeesProbe) finding(`${sc.key}: a Tech Domain user outside the work-order teams (id ${nonTeam.id}) became a participant of customer room ${roomId} (WO ${wo}) just by opening /workOrder/messages/${wo}?engineerId=${custOwner.id} in the browser; they then read the thread${S.postUiLeak.nonTeamNotifiedOfProbe ? ' and receive MESSAGE notifications' : ''}`);
  }

  await mailCtx.close();

  // ---------------------------------------------------------------- status walk on the S1 work order
  // Submitted -> Accepted (done in S1) -> Requested -> Counter -> Assigned -> Confirmed -> Check-in -> Check-out ->
  // Work done -> Verified -> Approved. At every reached status: room participants, a message round-trip with
  // notifications, no access for the engineer / non-team user / other-company customer / vendor, and who got the
  // status notification.
  let walkSrc = results.scenarios.find((s) => s.key === 'S1' && s.workOrderId && s.approve && s.approve.status < 300) || results.scenarios.find((s) => s.key === 'S2' && s.workOrderId && s.approve && s.approve.status < 300);
  if (WALK_WO) {
    const cuW = await getJson(tdOwner, `/chats/users/${WALK_WO}/${COMPANY_ID}`);
    const rowW = (cuW.body?.data || []).find((r) => r.isCustomerChat);
    walkSrc = rowW ? { key: `env WO ${WALK_WO}`, workOrderId: WALK_WO, roomId: rowW.chatRoomId || rowW.conversationId } : null;
    log(`WALK_WO=${WALK_WO}: customer room ${walkSrc?.roomId || 'not found'}`);
  }
  const engineer = controls.find((c) => c.account.role === 'Individual Engineer');
  const W = { source: walkSrc?.key, workOrderId: walkSrc?.workOrderId, roomId: walkSrc?.roomId, steps: [] };
  results.statusWalk = W;
  if (SKIP_WALK) { walkSrc = null; log('status walk skipped (SKIP_WALK)'); }
  if (!walkSrc || !engineer) {
    log(`status walk skipped: ${!walkSrc ? 'no accepted customer work order' : 'no engineer account'}`);
  } else {
    const wo = walkSrc.workOrderId, roomId = walkSrc.roomId;
    const walkCreator = (await getJson(tdOwner, `/workOrders/${wo}`)).body?.data?.createdBy?.id;
    const walkWithSub = walkCreator === subUser.id;
    log(`WALK: work order created by user ${walkCreator} -> sub-user ${walkWithSub ? 'IS' : 'is NOT'} expected in the room`);
    const parts = () => (walkWithSub ? [custOwner, subUser, tdOwner, teamMember] : [custOwner, tdOwner, teamMember]);
    const seenNotif = new Map(); // label -> ids already counted
    for (const p of [...parts(), nonTeam, ...controls]) seenNotif.set(p.label, new Set((await woNotifications(p, wo)).map((n) => n.id)));

    const walkControls = () => [nonTeam, ...controls]; // the engineer stays a control for the CUSTOMER room
    async function checkpoint(stepName, opts = {}) {
      const step = { step: stepName, checks: [] };
      W.steps.push(step);
      const check = (name, ok, detail) => { step.checks.push({ name, ok: !!ok, detail }); log(`WALK[${stepName}] ${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''}`); expect.soft(!!ok, `WALK[${stepName}] ${name} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); };
      const woRec = (await getJson(tdOwner, `/workOrders/${wo}`)).body?.data || {};
      step.status = { status: woRec.status, subStatus: woRec.subStatus, customerStatus: woRec.customerStatus, engineerId: woRec.engineerId || woRec.engineer?.id };
      if (opts.expectStatus) check(`work order status is ${opts.expectStatus}`, woRec.status === opts.expectStatus, step.status);
      // rooms on the work order
      const cu = await getJson(tdOwner, `/chats/users/${wo}/${COMPANY_ID}`);
      step.rooms = (cu.body?.data || []).map((r) => ({ name: r.firstName, isCustomerChat: !!r.isCustomerChat, room: r.chatRoomId, participantIds: r.participantIds }));
      const custRow = step.rooms.find((r) => r.isCustomerChat);
      const expected = expectedParticipants(walkWithSub);
      const actual = (custRow?.participantIds || []).slice().sort((a, b) => a - b);
      check('customer room still exists', !!custRow && custRow.room === roomId, { custRow, roomId });
      check(walkWithSub ? 'customer room participants unchanged (owner + sub-user + TD owner + team)' : 'customer room participants unchanged (owner + TD owner + team)', expected.every((id) => actual.includes(id)) && actual.every((id) => expected.includes(id)), { actual, expected });
      check('engineer is NOT in the customer room', !actual.includes(engineer.id), { engineerId: engineer.id });
      // message round-trip
      const texts = {};
      for (const p of parts()) {
        const text = `TD123 WALK ${stepName} ${RUN} from ${p.label}`;
        const r = await postJson(p, `/inbox/${roomId}/message`, { message: `<p>${text}</p>` });
        if (r.status < 300) texts[p.label] = text;
        check(`${p.label} can send at ${stepName}`, r.status < 300, { status: r.status, message: r.body?.message });
        await sleep(1_000);
      }
      await sleep(2_500);
      for (const p of parts()) {
        const c = await conversation(p, roomId);
        const notifs = await chatNotifications(p, roomId);
        const seen = Object.values(texts).every((t) => c.texts.some((x) => x.includes(t)));
        const notified = Object.entries(texts).filter(([from]) => from !== p.label).every(([, t]) => notifs.some((n) => n.text.includes(t)));
        check(`${p.label} sees every sent ${stepName} message`, seen, { status: c.status });
        check(`${p.label} notified of the other 3 ${stepName} messages`, notified, { notifCount: notifs.length });
      }
      // leaks (engineer + non-team + other company + vendor) on the customer room
      for (const c of [engineer, ...walkControls().filter((x) => x.id !== engineer.id)]) {
        const conv = await conversation(c, roomId);
        const chatN = await chatNotifications(c, roomId);
        check(`${c.label}: customer room forbidden at ${stepName}`, conv.status === 403 || conv.status === 404, { status: conv.status });
        check(`${c.label}: no MESSAGE notification from the customer room at ${stepName}`, chatN.length === 0, { count: chatN.length });
      }
      // status notifications since the previous checkpoint
      step.notifications = {};
      for (const p of [...parts(), engineer, ...walkControls().filter((x) => x.id !== engineer.id)]) {
        const all = await woNotifications(p, wo);
        const fresh = all.filter((n) => !seenNotif.get(p.label)?.has(n.id));
        for (const n of all) seenNotif.get(p.label)?.add(n.id);
        step.notifications[p.label] = fresh;
      }
      log(`WALK[${stepName}] status notifications: ${JSON.stringify(step.notifications).slice(0, 1500)}`);
      if (opts.customerNotified) {
        check(`customer owner notified at ${stepName}`, (step.notifications['Customer owner'] || []).length > 0, step.notifications['Customer owner']);
        if (walkWithSub) check(`customer sub-user notified at ${stepName}`, (step.notifications['Customer sub-user'] || []).length > 0, step.notifications['Customer sub-user']);
        else check(`customer sub-user (not creator) NOT notified at ${stepName}`, (step.notifications['Customer sub-user'] || []).length === 0, step.notifications['Customer sub-user']);
      }
      if (opts.teamNotified) check(`Tech Domain team member notified at ${stepName}`, (step.notifications['TD team member'] || []).length > 0, step.notifications['TD team member']);
      for (const c of walkControls().filter((x) => x.id !== engineer.id)) check(`${c.label}: no status notification at ${stepName} (marketplace broadcast ignored)`, (step.notifications[c.label] || []).filter((x) => x.type !== 'WORK_ORDER_PUBLISHED').length === 0, step.notifications[c.label]);
      return step;
    }

    const walkStep = async (name, fn) => { try { return await fn(); } catch (e) { log(`WALK ${name} threw: ${e.message.slice(0, 300)}`); return null; } };
    // move the schedule to a slot no other test work order uses, or the engineer gets a schedule conflict (409)
    const minute = Math.floor(Date.now() / 60_000);
    const slot = new Date(Date.now() + (2 + (minute % 25)) * 86_400_000); slot.setUTCHours(6 + (minute % 12), 0, 0, 0);
    const slotDay = slot.toISOString().slice(0, 10), slotHm = slot.toISOString().slice(11, 16);
    const shift = await walkStep('schedule-unique', () => patchJson(tdOwner, `/workOrders/${wo}`, { orderStartDate: `${slotDay}T00:00:00`, orderStartTime: `${slotDay}T${slotHm}:00`, scheduleType: 'HARD_START', timeZone: 'UTC' }));
    log(`WALK schedule shifted to ${slotDay} ${slotHm} UTC -> HTTP ${shift?.status} ${JSON.stringify(shift?.body).slice(0, 150)}`);
    const alreadyAssigned = (await getJson(tdOwner, `/workOrders/${wo}`)).body?.data?.status === 'ASSIGNED';
    if (alreadyAssigned) log('WALK: work order already ASSIGNED - skipping accepted/requested/counter steps (resume)');
    let offerId = null;
    if (!alreadyAssigned) {
    await checkpoint('ACCEPTED (published)', { expectStatus: 'PUBLISHED' });

    // Requested: the engineer sends an offer at the posted rates
    const req = await walkStep('request', () => postJson(engineer, '/offers/engineer/request', { workOrderId: wo }));
    log(`WALK request -> HTTP ${req?.status} ${JSON.stringify(req?.body).slice(0, 300)}`);
    let requested = req && req.status < 300;
    if (!requested) {
      // fallback: the client routes the work order to the engineer and the engineer accepts
      const routed = await walkStep('route', () => postJson(tdOwner, '/offers/route', { workOrderId: wo, userId: engineer.id }));
      log(`WALK route (fallback) -> HTTP ${routed?.status} ${JSON.stringify(routed?.body).slice(0, 300)}`);
      offerId = routed?.body?.data?.id || routed?.body?.id || null;
      if (offerId) { const acc = await walkStep('route/accept', () => postJson(engineer, `/offers/route/accept/${offerId}`, {})); log(`WALK route/accept -> HTTP ${acc?.status} ${JSON.stringify(acc?.body).slice(0, 200)}`); }
    }
    const offers = await getJson(tdOwner, `/offers/${wo}`).catch(() => null);
    const offersList = await postJson(tdOwner, `/offers/${wo}`, { limit: 20, page: 1 });
    log(`WALK offers on WO: ${JSON.stringify(offersList.body?.data?.offers || offersList.body?.data || offers?.body?.data).slice(0, 600)}`);
    await checkpoint(requested ? 'REQUESTED' : 'ROUTED+ACCEPTED (request fallback)', { teamNotified: true });

    // Counter: the engineer counters the rate
    const counter = await walkStep('counter', () => patchJson(engineer, '/offers/engineer/counter', { workOrderId: wo, hourlyRate: 50, minimumHours: 5, additionalHourlyRate: 55, expenses: [], currency: 'USD' }));
    log(`WALK counter -> HTTP ${counter?.status} ${JSON.stringify(counter?.body).slice(0, 300)}`);
    const countered = counter && counter.status < 300;
    if (countered) {
      const ol = await postJson(tdOwner, `/offers/${wo}`, { limit: 20, page: 1 });
      const mine = (ol.body?.data?.offers || ol.body?.data || []).find((o) => (o.userId || o.user?.id || o.engineerId) === engineer.id);
      offerId = mine?.id || offerId;
      await checkpoint('COUNTER', { teamNotified: true });
      if (offerId) { const ca = await walkStep('counter/accept', () => postJson(tdOwner, `/offers/counter/accept/${offerId}`, {})); log(`WALK counter/accept -> HTTP ${ca?.status} ${JSON.stringify(ca?.body).slice(0, 200)}`); }
    } else W.counterSkipped = `counter HTTP ${counter?.status}: ${JSON.stringify(counter?.body).slice(0, 200)}`;

    // Assigned
    } // end of !alreadyAssigned

    // accepting a counter offer already assigns the work order; only call /offers/assign when it is still open
    let asg = null;
    const stBefore = (await getJson(tdOwner, `/workOrders/${wo}`)).body?.data?.status;
    if (stBefore === 'ASSIGNED') { asg = { status: 200, body: { message: 'assigned by counter accept' } }; log('WALK assign: work order already ASSIGNED by the counter accept'); }
    else { asg = await walkStep('assign', () => postJson(tdOwner, '/offers/assign', { workOrderId: wo, userId: engineer.id })); log(`WALK assign -> HTTP ${asg?.status} ${JSON.stringify(asg?.body).slice(0, 300)}`); }
    const assigned = asg && asg.status < 300;
    if (assigned) {
      await sleep(2_000);
      if (!alreadyAssigned) await checkpoint('ASSIGNED', { expectStatus: 'ASSIGNED', customerNotified: true });

      // Confirmed
      const conf = alreadyAssigned ? { status: 200, body: { message: 'resume: already confirmed' } } : await walkStep('confirm', () => patchJson(tdOwner, `/workOrders/${wo}/subStatus`, { subStatus: 'CONFIRMED' }));
      log(`WALK confirm -> HTTP ${conf?.status} ${JSON.stringify(conf?.body).slice(0, 200)}`);
      if (conf && conf.status < 300 && !alreadyAssigned) await checkpoint('CONFIRMED', { customerNotified: true });

      // move the schedule to "now" so the check-in window is open
      const now = new Date(Date.now() - 10 * 60_000);
      const day = now.toISOString().slice(0, 10), hm = now.toISOString().slice(11, 16);
      const sched = await walkStep('schedule', () => patchJson(tdOwner, `/workOrders/${wo}`, { orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T${hm}:00`, scheduleType: 'HARD_START', timeZone: 'UTC' }));
      log(`WALK schedule -> HTTP ${sched?.status} ${JSON.stringify(sched?.body).slice(0, 200)}`);
      const woNow = (await getJson(engineer, `/workOrders/${wo}`)).body?.data || {};
      const tasks = woNow.tasks || woNow.completedTasks || [];
      const taskOf = (type) => { const t = tasks.find((x) => (x.taskType || x.task?.taskType) === type); return t ? { id: t.completedTask?.id || t.id, templateId: t.id } : null; };
      log(`WALK tasks: ${JSON.stringify(tasks.map((t) => ({ completedTaskId: t.completedTask?.id, type: t.taskType || t.task?.taskType, done: t.completedTask?.isCompleted })))}`);
      const lat = woNow.address?.latitude || 31.5203696, lng = woNow.address?.longitude || 74.3587473;

      const ci = await walkStep('checkIn', () => postJson(engineer, '/timeLogs/checkIn', { workOrderId: wo, checkInLatitude: lat, checkInLongitude: lng, taskId: taskOf('CHECK_IN')?.id, checkInTimeZone: 'UTC' }));
      log(`WALK checkIn -> HTTP ${ci?.status} ${JSON.stringify(ci?.body).slice(0, 300)}`);
      if (ci && ci.status < 300) await checkpoint('CHECK_IN (in progress)', { expectStatus: 'INPROGRESS', customerNotified: true });

      const co = await walkStep('checkOut', () => postJson(engineer, '/timeLogs/checkOut', { workOrderId: wo, checkOutLatitude: lat, checkOutLongitude: lng, taskId: taskOf('CHECK_OUT')?.id, checkOutTimeZone: 'UTC' }));
      log(`WALK checkOut -> HTTP ${co?.status} ${JSON.stringify(co?.body).slice(0, 300)}`);
      if (co && co.status < 300) await checkpoint('CHECK_OUT', { customerNotified: true });

      const mc = await walkStep('markComplete', () => patchJson(engineer, `/tasks/${taskOf('MARK_COMPLETE')?.id}`, { isCompleted: true, text: 'TD-123 QA automation complete' }));
      log(`WALK markComplete -> HTTP ${mc?.status} ${JSON.stringify(mc?.body).slice(0, 300)}`);
      if (mc && mc.status < 300) await checkpoint('WORKDONE', { customerNotified: true });

      // Verified -> Approved (client side)
      const rev = await walkStep('reviewed', () => patchJson(tdOwner, `/workOrders/${wo}/subStatus`, { subStatus: 'REVIEWED' }));
      log(`WALK subStatus REVIEWED -> HTTP ${rev?.status} ${JSON.stringify(rev?.body).slice(0, 200)}`);
      const ver = await walkStep('verify', () => postJson(tdOwner, `/workOrders/${wo}/verify`, {}));
      log(`WALK verify -> HTTP ${ver?.status} ${JSON.stringify(ver?.body).slice(0, 300)}`);
      if (ver && ver.status < 300) await checkpoint('VERIFIED', {});
      const apr = await walkStep('approve', () => postJson(tdOwner, `/workOrders/${wo}/approve`, {}));
      log(`WALK approve -> HTTP ${apr?.status} ${JSON.stringify(apr?.body).slice(0, 300)}`);
      if (apr && apr.status < 300) await checkpoint('APPROVED', { expectStatus: 'APPROVED', customerNotified: true });
      W.reached = { assigned, confirmed: conf?.status < 300, checkIn: ci?.status < 300, checkOut: co?.status < 300, complete: mc?.status < 300, verified: ver?.status < 300, approved: apr?.status < 300 };
    } else W.reached = { assigned: false, assignError: JSON.stringify(asg?.body).slice(0, 200) };
    log(`WALK reached: ${JSON.stringify(W.reached)}`);
  }

  // ---------------------------------------------------------------- report
  const summary = results.scenarios.map((s) => {
    const failed = s.checks.filter((c) => !c.ok);
    return `${s.key} ${s.title}: WO ${s.workOrderId || '-'} (ref ${s.workOrder?.referenceId || '-'}), room ${s.roomId || '-'} -> ${s.checks.length - failed.length}/${s.checks.length} checks passed` +
      (failed.length ? '\n   FAILED: ' + failed.map((f) => f.name).join('; ') : '');
  }).join('\n');
  const walkSummary = (results.statusWalk?.steps || []).map((st) => {
    const failed = st.checks.filter((c) => !c.ok);
    return `  ${st.step} [${st.status?.status}/${st.status?.subStatus || '-'}]: ${st.checks.length - failed.length}/${st.checks.length} passed` + (failed.length ? '\n     FAILED: ' + failed.map((f) => f.name).join('; ') : '');
  }).join('\n');
  const full = `${summary}\nSTATUS WALK on WO ${results.statusWalk?.workOrderId || '-'} (${results.statusWalk?.source || '-'}): reached ${JSON.stringify(results.statusWalk?.reached || {})}\n${walkSummary}`;
  log(`\nSUMMARY\n${full}\nFINDINGS: ${results.findings.length ? results.findings.join(' | ') : 'none'}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), full + '\n\nFindings:\n' + (results.findings.join('\n') || 'none') + '\n');
});
