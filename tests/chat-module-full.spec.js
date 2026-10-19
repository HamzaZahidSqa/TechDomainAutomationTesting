// Chat module - full regression on dev (work-order chat rooms, participants per role, message delivery,
// MESSAGE + status notifications, and leak checks) across every work-order state.
//
// Rules under test (FUNCTIONALITY_CHECKLIST.md §1.2 + §4, and the sub-user rule agreed with the tester on 2026-10-09):
//   customer room  = customer owner (+ sub-user ONLY when the sub-user created the WO) + Tech Domain owner + both WO teams
//   engineer room  = the engineer + Tech Domain owner + both WO teams            (never the customer)
//   vendor rooms   = vendor owner's own room (owner + TD owner + teams) and, after assignment, the member's room
//                    (member + vendor owner + TD owner + teams)                   (never the customer)
//   Every message reaches every other participant with a MESSAGE notification; nobody outside the room can list,
//   read, join or post in it, and never receives a MESSAGE notification for it (no cross-room leaks either).
//   Status notifications go to the expected roles only.
//
// Flows:
//   A  Tech Domain creates WO for the customer -> engineer 575 requests -> counters -> assigned -> confirmed -> check-in ->
//      check-out -> work done -> verified -> approved
//   B  Tech Domain creates WO -> routed to vendor 609 -> vendor accepts for member 611 -> assigned -> confirmed -> ... -> approved
//   C  Customer owner raises a ticket (PENDING_APPROVAL) -> accepted -> routed to engineer -> accepted -> assigned ->
//      un-assigned -> re-assigned -> cancelled by client
//
// Run:  npx playwright test tests/chat-module-full.spec.js   (env FLOWS=A,B,C to pick flows, SKIP_UI=1 to skip screenshots)
// Evidence: evidence/ChatModule-Full/run-<stamp>/  (ChatModule_<NN>_<step>.png, results.json, summary.txt)

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const td123 = require(path.join(__dirname, '..', 'td123-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'ChatModule-Full', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const FLOWS = (process.env.FLOWS || 'A,B,C').split(',').map((s) => s.trim().toUpperCase());
const SKIP_UI = !!process.env.SKIP_UI;

const COMPANY_ID = 9;                 // Tech Domain
const ENTITY_ID = 104;                // customer entity of "Customer Company 10090955" (parent 103, owner user 638)
const TEAM_SD3 = '8ae534d5-d80c-49d9-8ac3-849fc63a927f';
const TEAM_OP3 = 'cf0ed3db-521f-4c9f-887b-d5301383f8ce';
const TEMPLATE_WO = Number(process.env.TEMPLATE_WO || 242);
const DEFAULT_TASKS = ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] }));
const BROADCAST_TYPES = ['WORK_ORDER_PUBLISHED']; // marketplace broadcast to nearby engineers/vendors: ignored in leak checks

test.setTimeout(3_600_000);

// ---------------------------------------------------------------- helpers
let shotNo = 0;
async function shot(page, name) {
  shotNo += 1;
  const file = path.join(EVIDENCE, `ChatModule_${String(shotNo).padStart(2, '0')}_${name}.png`);
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
  const s = { label, account, api, user, id: user.id, role: String(user.role?.role || user.role || '').toUpperCase() };
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
const strip = (h) => String(h || '').replace(/<[^>]+>/g, '');

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

function clientWoPayload(t, title, clientId, dayOffset) {
  const start = new Date(Date.now() + dayOffset * 86_400_000); start.setUTCHours(6, 0, 0, 0);
  const day = start.toISOString().slice(0, 10);
  return {
    templateId: null, title, serviceLevelAgreeement: t.serviceLevelAgreeement || '', clientId,
    projectId: t.project?.id || null, teamId: TEAM_SD3, secondaryTeamId: TEAM_OP3, teamName: 'Service Delivery 3', secondaryTeamName: 'Operation 3',
    isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '',
    description: 'Chat module QA automation', confidentialInformation: '',
    categoryId: t.category?.id, workOrderServices: (t.workOrderServices || []).map((s) => ({ serviceId: s.serviceId || s.id })),
    scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T06:00:00`, orderEndDate: null, orderEndTime: null,
    timeZone: 'UTC', addressId: t.address?.id || t.addressId,
    qualificationSubTypes: [], // no qualifications, so Accept & Assign is not blocked by verification
    expenses: [], paymentType: 'HOURLY', paymentTerms: t.paymentTerms || '15 days', currency: t.currency || 'USD', hourlyRate: t.hourlyRate || 20, minimumHours: t.minimumHours || 4,
    nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null,
    engineerExpenses: [], engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', engineerHourlyRate: 15, engineerAdditionalHourlyRate: null, engineerHalfDayRate: null, engineerFullDayRate: null, engineerFthRate: null, engineerFixedAmount: null, engineerMinimumHours: 4,
    isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [],
  };
}
function customerWoPayload(title, dayOffset) {
  const start = new Date(Date.now() + dayOffset * 86_400_000); start.setUTCHours(6, 0, 0, 0);
  const day = start.toISOString().slice(0, 10);
  return {
    templateId: null, title, serviceLevelAgreeement: '', clientId: ENTITY_ID, projectId: null, teamId: null, secondaryTeamId: null, teamName: '', secondaryTeamName: '',
    isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '',
    description: 'Chat module QA automation (customer ticket)', confidentialInformation: '',
    categoryId: null, workOrderServices: [],
    scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T06:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'UTC',
    addressId: null, isRemote: false, addressLine1: 'Lahore, Pakistan', addressLine2: '', city: 'Lahore', country: 'Pakistan', state: 'Punjab', zipCode: '54000',
    latitude: 31.5203696, longitude: 74.3587473, displayName: 'lahore', locationType: 'RESIDENTIAL',
    qualificationSubTypes: [], expenses: [], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: 45, minimumHours: 5,
    nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null,
    isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [],
  };
}

const notifList = (b) => (Array.isArray(b?.data) ? b.data : (b?.data?.data || b?.data?.notifications || []));
async function woNotifications(s, woId) {
  const r = await getJson(s, '/notifications/others?limit=40');
  return notifList(r.body).filter((n) => n.workOrderId === woId).map((n) => ({ id: n.id, type: n.type, title: n.title, content: strip(n.content).slice(0, 120) }));
}
async function messageNotifications(s) {
  const r = await getJson(s, '/notifications');
  return notifList(r.body).filter((n) => n.type === 'MESSAGE').map((n) => ({ id: n.id, roomId: n.chatRoomId, senderId: n.senderId, url: n.url, text: strip(n.content) }));
}
async function conversation(s, convId) {
  const r = await getJson(s, `/inbox/${convId}?limit=0&markAsRead=false`);
  const conv = r.body?.data?.conversation || r.body?.conversation || {};
  const msgs = r.body?.data?.messages || r.body?.messages || [];
  return { status: r.status, participants: (conv.participants || []).map((p) => p.id), texts: msgs.map((m) => strip(m.message || m.text)) };
}

// ---------------------------------------------------------------- the test
test('Chat module: rooms, participants, messages, notifications and leaks across every work-order state', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 700) }); };
  const results = { run: RUN, date: new Date().toISOString(), sessions: {}, flows: [], findings: [], info: [] };
  const finding = (txt) => { if (!results.findings.includes(txt)) { results.findings.push(txt); log(`FINDING: ${txt}`); } };
  const info = (txt) => { if (!results.info.includes(txt)) { results.info.push(txt); log(`INFO: ${txt}`); } };
  const byRole = (r) => accounts.find((a) => a.role === r);
  const td = (r) => td123.find((a) => a.role === r);

  // ---------- sessions ----------
  const tdOwner = await apiLogin(byRole('TechDomain User'), 'TD owner');
  const teamMember = await apiLogin(td('TD Team Member'), 'TD team member');
  const nonTeam = await apiLogin(td('TD Non-team User'), 'TD non-team user');
  const custOwner = await apiLogin(testAccounts.find((a) => a.role === 'Customer'), 'Customer owner');
  const subUser = await apiLogin(td('Customer Sub-user'), 'Customer sub-user');
  const engineer = await apiLogin(byRole('Individual Engineer'), 'Individual engineer');
  const vendor = await apiLogin(byRole('Vendor'), 'Vendor owner');
  const vendorEng = await apiLogin(byRole('Vendor Engineer'), 'Vendor engineer');
  const otherCust = await apiLogin(byRole('Customer'), 'Other-company customer');
  const ALL = [tdOwner, teamMember, nonTeam, custOwner, subUser, engineer, vendor, vendorEng, otherCust];
  for (const s of ALL) results.sessions[s.label] = { id: s.id, email: s.account.email, role: s.role };
  log(`sessions: ${ALL.map((s) => `${s.label}=${s.id}`).join(', ')}`);
  expect(tdOwner.user.isCompanyOwner, 'TechDomain User must be the company owner').toBeTruthy();

  const tm = await getJson(tdOwner, `/teams/teamMembers?teamIds=${TEAM_SD3},${TEAM_OP3}`);
  const teamIds = (tm.body?.data || []).map((x) => x.id);
  results.teamIds = teamIds;
  log(`members of SD3 + OP3: ${JSON.stringify((tm.body?.data || []).map((x) => `${x.id}:${x.firstName} ${x.lastName}`))}`);
  expect(teamIds, 'team member is in the WO teams').toContain(teamMember.id);
  expect(teamIds, 'non-team user is in no WO team').not.toContain(nonTeam.id);
  const template = (await getJson(tdOwner, `/workOrders/${TEMPLATE_WO}`)).body?.data;
  expect(template, `template WO ${TEMPLATE_WO} readable`).toBeTruthy();

  const labelOf = (id) => (ALL.find((s) => s.id === id) || {}).label || `user ${id}`;
  // Business rule confirmed by the tester 2026-10-15: every Tech Domain company user (owner, team members and users in
  // no team) may open and message every room of a Tech Domain work order; they join the room on first open.
  // So the non-team TD user is neither a required participant nor an outsider.
  const ON_DEMAND = [nonTeam];
  const expectedSet = {
    customer: (withSub) => Array.from(new Set([custOwner.id, ...(withSub ? [subUser.id] : []), tdOwner.id, ...teamIds])),
    engineer: () => Array.from(new Set([engineer.id, tdOwner.id, ...teamIds])),
    vendorOwner: () => Array.from(new Set([vendor.id, tdOwner.id, ...teamIds])),
    vendorMember: () => Array.from(new Set([vendorEng.id, vendor.id, tdOwner.id, ...teamIds])),
  };
  const sendersOf = {
    customer: (withSub) => [custOwner, ...(withSub ? [subUser] : []), tdOwner, teamMember],
    engineer: () => [engineer, tdOwner, teamMember],
    vendorOwner: () => [vendor, tdOwner, teamMember],
    vendorMember: () => [vendorEng, vendor, tdOwner, teamMember],
  };

  // all rooms of a work order as the Tech Domain owner sees them, with full participant lists
  async function listRooms(wo) {
    const cu = await getJson(tdOwner, `/chats/users/${wo}/${COMPANY_ID}`);
    const rows = [];
    for (const r of cu.body?.data || []) {
      const roomId = r.chatRoomId || r.conversationId || null;
      let participants = r.participantIds ? r.participantIds.slice() : null;
      if (!participants && roomId) {
        // engineer rows carry no participantIds: union of the participant lists seen by two viewers (each list excludes its viewer)
        const a = await conversation(tdOwner, roomId), b = await conversation(teamMember, roomId);
        participants = Array.from(new Set([...a.participants, ...b.participants, ...(a.status === 200 ? [tdOwner.id] : []), ...(b.status === 200 ? [teamMember.id] : [])]));
      }
      rows.push({ roomId, name: `${r.firstName || ''} ${r.lastName || ''}`.trim(), userId: r.id, isCustomerChat: !!r.isCustomerChat, isDisabled: !!r.isDisabled, participants: (participants || []).sort((x, y) => x - y) });
    }
    return rows;
  }

  // ---------------------------------------------------------------- one checkpoint = full chat + notification audit at one state
  // seen: Map(label -> Set of status-notification ids already counted) kept per flow
  async function checkpoint(F, stepName, opts) {
    const step = { step: stepName, checks: [], rooms: [], messages: {}, statusNotifications: {} };
    F.steps.push(step);
    const check = (name, ok, detail) => { step.checks.push({ name, ok: !!ok, detail }); log(`${F.key}[${stepName}] ${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''}`); expect.soft(!!ok, `${F.key}[${stepName}] ${name} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); };
    const wo = F.wo;
    const woRec = (await getJson(tdOwner, `/workOrders/${wo}`)).body?.data || {};
    step.status = { status: woRec.status, subStatus: woRec.subStatus, engineerId: woRec.engineerId || woRec.engineer?.id || null, assignedFreelanceCompanyId: woRec.assignedFreelanceCompanyId || null };
    if (opts.expectStatus) check(`work order status is ${opts.expectStatus}`, woRec.status === opts.expectStatus, step.status);
    if (opts.expectSubStatus) check(`work order sub-status is ${opts.expectSubStatus}`, woRec.subStatus === opts.expectSubStatus, step.status);

    // ----- rooms: open on demand where the rule says the engineer side may, then list
    const preRooms = await listRooms(wo);
    for (const er of opts.rooms) {
      if (er.openAs) {
        const already = preRooms.find((r) => (er.key === 'customer' ? r.isCustomerChat : (!r.isCustomerChat && r.userId === er.engineerId)));
        if (er.expectProactive && !already) { info(`${F.key} WO ${wo} ${stepName}: ${er.key} room was NOT created proactively by the assignment; it only exists once ${er.openAs.label} opens the chat`); }
        const r = await postJson(er.openAs, '/chats/room/group', { workOrderId: wo, companyId: COMPANY_ID, engineerId: er.engineerId });
        log(`${F.key}[${stepName}] ${er.openAs.label} opens ${er.key} room (POST /chats/room/group engineerId=${er.engineerId}) -> HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
        if (er.mustOpen) check(`${er.openAs.label} can open their ${er.key} room (offer/assignment gives access)`, r.status < 300, { status: r.status, message: r.body?.message });
      }
    }
    await sleep(1_500);
    const rooms = await listRooms(wo);
    step.rooms = rooms;
    log(`${F.key}[${stepName}] rooms: ${JSON.stringify(rooms)}`);
    const matched = new Map();
    for (const er of opts.rooms) {
      const row = rooms.find((r) => (er.key === 'customer' ? r.isCustomerChat : (!r.isCustomerChat && r.userId === er.engineerId)));
      if (row) matched.set(row.roomId, er);
      check(`${er.key} room exists`, !!row, { roomId: row?.roomId, name: row?.name });
      if (!row) continue;
      er.roomId = row.roomId; F.roomIds[er.key] = row.roomId;
      const expected = er.participants.slice().sort((a, b) => a - b);
      const missing = expected.filter((id) => !row.participants.includes(id));
      const extra = row.participants.filter((id) => !expected.includes(id) && !ON_DEMAND.some((s) => s.id === id));
      check(`${er.key} room participants = ${er.participantsLabel}`, missing.length === 0 && extra.length === 0, { actual: row.participants, missing: missing.map(labelOf), extra: extra.map(labelOf) });
      if (extra.length) finding(`${F.key} WO ${wo} ${stepName}: ${er.key} room ${row.roomId} has EXTRA participant(s) ${extra.map(labelOf).join(', ')}`);
      if (missing.length) finding(`${F.key} WO ${wo} ${stepName}: ${er.key} room ${row.roomId} is MISSING ${missing.map(labelOf).join(', ')}`);
    }
    const unexpected = rooms.filter((r) => !matched.has(r.roomId));
    check('no unexpected room on the work order', unexpected.length === 0, unexpected.map((r) => ({ roomId: r.roomId, name: r.name, participants: r.participants.map(labelOf) })));
    for (const r of unexpected) info(`${F.key} WO ${wo} ${stepName}: unexpected room ${r.roomId} "${r.name}" participants ${r.participants.map(labelOf).join(', ')}`);

    // ----- messages: every controlled participant posts in every room; delivery + MESSAGE notifications; leaks
    const sentByRoom = {};
    for (const er of opts.rooms.filter((e) => e.roomId)) {
      const texts = {};
      for (const p of er.senders) {
        const text = `CHAT ${F.key} ${stepName} ${RUN} ${er.key}-room msg from ${p.label}`;
        const r = await postJson(p, `/inbox/${er.roomId}/message`, { message: `<p>${text}</p>`, clientMessageId: `cm-${RUN}-${F.key}-${er.key}-${stepName.replace(/\W/g, '')}-${p.id}`.slice(0, 64) });
        check(`${p.label} can send in the ${er.key} room`, r.status < 300, { status: r.status, message: r.body?.message });
        if (r.status < 300) texts[p.label] = text;
        await sleep(800);
      }
      sentByRoom[er.key] = texts;
    }
    await sleep(3_500);
    const msgNotifCache = new Map();
    const msgNotifs = async (s) => { if (!msgNotifCache.has(s.label)) msgNotifCache.set(s.label, await messageNotifications(s)); return msgNotifCache.get(s.label); };
    step.messages = {};
    for (const er of opts.rooms.filter((e) => e.roomId)) {
      const texts = sentByRoom[er.key];
      const allTexts = Object.values(texts);
      const members = ALL.filter((s) => er.participants.includes(s.id));
      const outsiders = ALL.filter((s) => !er.participants.includes(s.id) && !ON_DEMAND.includes(s));
      const R = { roomId: er.roomId, delivery: {}, leaks: {} };
      step.messages[er.key] = R;
      for (const p of members) {
        const c = await conversation(p, er.roomId);
        const n = (await msgNotifs(p)).filter((x) => x.roomId === er.roomId);
        const seen = allTexts.every((t) => c.texts.some((x) => x.includes(t)));
        const others = Object.entries(texts).filter(([from]) => from !== p.label);
        const notified = others.map(([from, t]) => [from, n.some((x) => x.text.includes(t))]);
        const own = !!texts[p.label] && n.some((x) => x.text.includes(texts[p.label]));
        R.delivery[p.label] = { convStatus: c.status, seesAll: seen, notified: Object.fromEntries(notified), ownNotification: own };
        check(`${p.label} can read the ${er.key} room`, c.status === 200, { status: c.status });
        check(`${p.label} sees every ${er.key}-room message`, seen, { missing: allTexts.filter((t) => !c.texts.some((x) => x.includes(t))).length });
        check(`${p.label} has a MESSAGE notification for each other sender in the ${er.key} room`, notified.every(([, ok]) => ok), Object.fromEntries(notified));
        check(`${p.label} has no MESSAGE notification for their own ${er.key}-room message`, !own, { own });
      }
      for (const o of outsiders) {
        const inbox = await getJson(o, '/inbox?limit=50');
        const listed = (inbox.body?.data || []).some((r) => r.conversationId === er.roomId || r.chatRoomId === er.roomId);
        const conv = await conversation(o, er.roomId);
        const room = await getJson(o, `/chats/${er.roomId}?limit=5`);
        const send = await postJson(o, `/inbox/${er.roomId}/message`, { message: `<p>LEAK TEST ${F.key} ${stepName} ${RUN} ${er.key} from ${o.label}</p>` });
        const n = await msgNotifs(o);
        const byRoom = n.filter((x) => x.roomId === er.roomId).length;
        const byText = n.filter((x) => allTexts.some((t) => x.text.includes(t))).length;
        const L = { listedInInbox: listed, conversationStatus: conv.status, roomStatus: room.status, sendStatus: send.status, msgNotifsForRoom: byRoom, msgNotifsWithTheseTexts: byText };
        R.leaks[o.label] = L;
        const blocked = (st) => st === 403 || st === 404 || st === 400;
        check(`${o.label}: ${er.key} room not listed in inbox`, !listed, L);
        check(`${o.label}: ${er.key} conversation forbidden`, blocked(conv.status), L);
        check(`${o.label}: ${er.key} room history forbidden`, blocked(room.status), L);
        check(`${o.label}: cannot post in the ${er.key} room`, blocked(send.status), L);
        check(`${o.label}: no MESSAGE notification for the ${er.key} room`, byRoom === 0 && byText === 0, L);
        if (send.status < 300) finding(`${F.key} WO ${wo} ${stepName}: ${o.label} (id ${o.id}) could POST into the ${er.key} room ${er.roomId} (HTTP ${send.status})`);
        if (conv.status === 200) finding(`${F.key} WO ${wo} ${stepName}: ${o.label} (id ${o.id}) can read the ${er.key} room ${er.roomId}`);
        if (byRoom || byText) finding(`${F.key} WO ${wo} ${stepName}: ${o.label} (id ${o.id}) received MESSAGE notification(s) for the ${er.key} room ${er.roomId}`);
      }
      const after = await conversation(tdOwner, er.roomId);
      check(`no LEAK TEST message landed in the ${er.key} room`, !after.texts.some((t) => t.includes('LEAK TEST')), { count: after.texts.filter((t) => t.includes('LEAK TEST')).length });
      // cross-room: messages of this room must not appear in the other rooms of the work order
      for (const other of opts.rooms.filter((e) => e.roomId && e.key !== er.key)) {
        const oc = await conversation(tdOwner, other.roomId);
        check(`${er.key}-room messages did not leak into the ${other.key} room`, !allTexts.some((t) => oc.texts.some((x) => x.includes(t))), { otherRoom: other.roomId });
      }
    }

    // ----- status notifications since the previous checkpoint
    const fresh = {};
    for (const s of ALL) {
      const all = await woNotifications(s, wo);
      const set = F.seen.get(s.label);
      // WORK_ORDER_PUBLISHED is the marketplace broadcast for FREELANCERs (ignored); for the customer it is the real
      // "published / accepted" notification. "Schedule has been updated" is caused by this test's own schedule patch.
      fresh[s.label] = all.filter((n) => !set.has(n.id) && !(s.role === 'FREELANCER' && BROADCAST_TYPES.includes(n.type)) && !/Schedule has been updated/i.test(n.content || ''));
      for (const n of all) set.add(n.id);
    }
    step.statusNotifications = fresh;
    log(`${F.key}[${stepName}] status notifications: ${JSON.stringify(Object.fromEntries(Object.entries(fresh).filter(([, v]) => v.length).map(([k, v]) => [k, v.map((n) => `${n.type}: ${n.content || n.title}`)])))}`);
    const must = opts.notify || [], may = opts.mayNotify || [];
    for (const lbl of must) check(`${lbl} notified at ${stepName}`, (fresh[lbl] || []).length > 0, fresh[lbl]);
    for (const lbl of may) if (!(fresh[lbl] || []).length) info(`${F.key} ${stepName}: ${lbl} got no status notification (allowed by the code rules, but worth a product decision)`);
    for (const s of ALL) {
      if (must.includes(s.label) || may.includes(s.label) || s.label === opts.actor) continue;
      check(`${s.label}: no status notification at ${stepName} (not an expected recipient)`, (fresh[s.label] || []).length === 0, fresh[s.label]);
      if ((fresh[s.label] || []).length) finding(`${F.key} WO ${wo} ${stepName}: ${s.label} (id ${s.id}) received an unexpected notification: ${fresh[s.label].map((n) => `${n.type} "${n.content || n.title}"`).join('; ')}`);
    }
    if (opts.actor && (fresh[opts.actor] || []).length) { check(`${opts.actor} (actor) not notified of their own action`, false, fresh[opts.actor]); finding(`${F.key} WO ${wo} ${stepName}: actor ${opts.actor} was notified of their own action`); }
    return step;
  }

  // REST join probe for outsiders (same rule as the socket join): nobody outside the group may enter a room by "opening" it
  async function joinProbe(F, rooms) {
    const step = { step: 'JOIN PROBE (outsiders try POST /chats/room/group)', checks: [], results: {} };
    F.steps.push(step);
    const check = (name, ok, detail) => { step.checks.push({ name, ok: !!ok, detail }); log(`${F.key}[join-probe] ${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 300) : ''}`); expect.soft(!!ok, `${F.key}[join-probe] ${name}`).toBe(true); };
    for (const er of rooms.filter((e) => e.roomId)) {
      const target = er.key === 'customer' ? custOwner.id : er.engineerId;
      for (const o of ALL.filter((s) => !er.participants.includes(s.id) && !ON_DEMAND.includes(s))) {
        const r = await postJson(o, '/chats/room/group', { workOrderId: F.wo, companyId: COMPANY_ID, engineerId: target });
        const after = (await listRooms(F.wo)).find((x) => x.roomId === er.roomId);
        const joined = !!after && after.participants.includes(o.id);
        step.results[`${o.label} -> ${er.key}`] = { status: r.status, joined };
        check(`${o.label} cannot join the ${er.key} room via POST /chats/room/group`, r.status >= 400 && !joined, { status: r.status, joined, message: r.body?.message });
        if (joined) finding(`${F.key} WO ${F.wo}: ${o.label} (id ${o.id}) became a participant of the ${er.key} room ${er.roomId} by calling POST /chats/room/group (HTTP ${r.status})`);
      }
    }
  }

  async function uiEvidence(F, users) {
    if (SKIP_UI) return;
    const step = { step: 'UI evidence', checks: [], shots: [] };
    F.steps.push(step);
    for (const uu of users) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, geolocation: { latitude: 31.5203696, longitude: 74.3587473 }, permissions: ['geolocation'] });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15_000);
      try {
        await uiLogin(page, uu.s.account);
        await page.goto(uu.url);
        await page.waitForTimeout(6_000);
        const body = await page.locator('body').innerText().catch(() => '');
        const composer = page.locator('.ql-editor').first();
        const hasComposer = (await composer.count()) > 0 && (await composer.isVisible().catch(() => false));
        const texts = uu.expectTexts || [];
        const visible = texts.filter((t) => body.includes(t));
        const file = await shot(page, `${F.key}-${uu.name}-chat`);
        step.shots.push({ user: uu.s.label, url: uu.url, file, composer: hasComposer, visible: visible.length, expected: texts.length });
        const ok = uu.expectAccess ? (visible.length === texts.length) : (visible.length === 0);
        step.checks.push({ name: `UI ${uu.s.label}: ${uu.expectAccess ? 'sees the room messages' : 'sees NO room messages'}`, ok, detail: { composer: hasComposer, visible: visible.length, expected: texts.length, file } });
        log(`${F.key}[ui] ${ok ? 'PASS' : 'FAIL'} - ${uu.s.label} ${uu.expectAccess ? 'sees' : 'must not see'} messages (visible ${visible.length}/${texts.length}, composer=${hasComposer}) -> ${file}`);
        expect.soft(ok, `${F.key} UI ${uu.s.label}`).toBe(true);
        if (uu.bell) { const bell = page.locator('i[class*="fa-bell"], [aria-label*="notification" i]').first(); if (await bell.count()) { await bell.click({ force: true }).catch(() => { }); await page.waitForTimeout(2_000); await shot(page, `${F.key}-${uu.name}-bell`); } }
      } catch (e) {
        log(`${F.key}[ui] ${uu.s.label}: ${e.message.slice(0, 200)}`);
        await shot(page, `${F.key}-${uu.name}-error`);
      }
      await ctx.close();
      await uu.s.relogin(); // the UI login invalidated this user's API token
    }
  }

  async function createFlow(key, title, creator, payload) {
    const F = { key, title, steps: [], roomIds: {}, seen: new Map(ALL.map((s) => [s.label, new Set()])) };
    results.flows.push(F);
    const woTitle = `CHAT ${key} ${RUN}`;
    const created = await postJson(creator, '/workOrders', payload(woTitle));
    log(`\n================ Flow ${key}: ${title} ================\n${key} create WO -> HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
    F.wo = created.body?.data?.id || created.body?.id || null;
    F.created = { status: created.status, by: creator.label };
    if (!F.wo) { log(`${key}: work order not created, flow skipped`); return F; }
    const rec = (await getJson(tdOwner, `/workOrders/${F.wo}`)).body?.data || {};
    F.workOrder = { id: F.wo, referenceId: rec.referenceId, status: rec.status, title: woTitle };
    log(`${key} WO ${F.wo} ref=${rec.referenceId} status=${rec.status}`);
    await sleep(3_000);
    return F;
  }
  const walkStep = async (F, name, fn) => { try { const r = await fn(); log(`${F.key} ${name} -> HTTP ${r?.status} ${JSON.stringify(r?.body).slice(0, 220)}`); return r; } catch (e) { log(`${F.key} ${name} threw: ${e.message.slice(0, 200)}`); return null; } };
  const ok = (r) => r && r.status < 300;
  const offersOf = async (wo) => { const ol = await postJson(tdOwner, `/offers/${wo}`, { limit: 20, page: 1 }); return ol.body?.data?.offers || ol.body?.data || []; };
  const offerBy = async (wo, userId) => (await offersOf(wo)).find((o) => (o.userId || o.user?.id || o.engineerId) === userId);
  async function scheduleNow(F) { const now = new Date(Date.now() - 10 * 60_000); const day = now.toISOString().slice(0, 10), hm = now.toISOString().slice(11, 16); return walkStep(F, 'schedule -> now', () => patchJson(tdOwner, `/workOrders/${F.wo}`, { orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T${hm}:00`, scheduleType: 'HARD_START', timeZone: 'UTC' })); }
  async function taskIds(F, who) { const w = (await getJson(who, `/workOrders/${F.wo}`)).body?.data || {}; const tasks = w.tasks || []; const t = (type) => { const x = tasks.find((y) => (y.taskType || y.task?.taskType) === type); return x ? (x.completedTask?.id || x.id) : null; }; return { lat: w.address?.latitude || 31.5203696, lng: w.address?.longitude || 74.3587473, checkIn: t('CHECK_IN'), checkOut: t('CHECK_OUT'), complete: t('MARK_COMPLETE') }; }

  // room descriptors
  const custRoom = (withSub) => ({ key: 'customer', participants: expectedSet.customer(withSub), participantsLabel: withSub ? 'customer owner + sub-user (creator) + TD owner + teams' : 'customer owner + TD owner + teams (no sub-user)', senders: sendersOf.customer(withSub) });
  const engRoom = (openAs, mustOpen) => ({ key: 'engineer', engineerId: engineer.id, participants: expectedSet.engineer(), participantsLabel: 'engineer + TD owner + teams', senders: sendersOf.engineer(), openAs, mustOpen });
  const vendorOwnerRoom = (openAs, mustOpen) => ({ key: 'vendorOwner', engineerId: vendor.id, participants: expectedSet.vendorOwner(), participantsLabel: 'vendor owner + TD owner + teams', senders: sendersOf.vendorOwner(), openAs, mustOpen });
  const vendorMemberRoom = (openAs, mustOpen) => ({ key: 'vendorMember', engineerId: vendorEng.id, participants: expectedSet.vendorMember(), participantsLabel: 'vendor engineer + vendor owner + TD owner + teams', senders: sendersOf.vendorMember(), openAs, mustOpen });
  const TEAM = ['TD owner', 'TD team member'];
  const CUST = ['Customer owner'];

  // pre-offer: the engineer side must NOT be able to open a room yet
  async function noRoomYet(F, who, engineerId) {
    const r = await postJson(who, '/chats/room/group', { workOrderId: F.wo, companyId: COMPANY_ID, engineerId });
    const st = F.steps[F.steps.length - 1];
    const ok1 = r.status >= 400;
    st.checks.push({ name: `${who.label} cannot open a room before having an offer`, ok: ok1, detail: { status: r.status, message: r.body?.message } });
    log(`${F.key}[${st.step}] ${ok1 ? 'PASS' : 'FAIL'} - ${who.label} cannot open a room before having an offer :: HTTP ${r.status}`);
    expect.soft(ok1, `${F.key} ${who.label} pre-offer room open`).toBe(true);
    if (!ok1) finding(`${F.key} WO ${F.wo}: ${who.label} (id ${who.id}) opened/created a chat room (POST /chats/room/group) without any offer or assignment (HTTP ${r.status})`);
  }

  // ================================================================ Flow A: individual engineer
  if (FLOWS.includes('A')) {
    const F = await createFlow('A', 'Tech Domain creates the WO; individual engineer requests, counters, gets assigned and completes', tdOwner, (t) => clientWoPayload(template, t, ENTITY_ID, 3));
    if (F.wo) {
      await checkpoint(F, 'PUBLISHED', { expectStatus: 'PUBLISHED', actor: 'TD owner', rooms: [custRoom(false)], notify: CUST, mayNotify: ['TD team member'] });
      await noRoomYet(F, engineer, engineer.id);
      await noRoomYet(F, vendor, vendor.id);

      const req = await walkStep(F, 'engineer requests', () => postJson(engineer, '/offers/engineer/request', { workOrderId: F.wo }));
      await sleep(2_500);
      if (ok(req)) await checkpoint(F, 'REQUESTED', { expectStatus: 'PUBLISHED', actor: 'Individual engineer', rooms: [custRoom(false), engRoom(engineer, true)], notify: TEAM });

      const counter = await walkStep(F, 'engineer counters', () => patchJson(engineer, '/offers/engineer/counter', { workOrderId: F.wo, hourlyRate: 50, minimumHours: 5, additionalHourlyRate: 55, expenses: [], currency: 'USD' }));
      await sleep(2_500);
      if (ok(counter)) await checkpoint(F, 'COUNTER', { expectStatus: 'PUBLISHED', actor: 'Individual engineer', rooms: [custRoom(false), engRoom()], notify: TEAM });

      const offer = await offerBy(F.wo, engineer.id);
      let asg = null;
      if (ok(counter) && offer) asg = await walkStep(F, `counter accept (offer ${offer.id})`, () => postJson(tdOwner, `/offers/counter/accept/${offer.id}`, {}));
      if (!ok(asg)) asg = await walkStep(F, 'assign', () => postJson(tdOwner, '/offers/assign', { workOrderId: F.wo, userId: engineer.id }));
      await sleep(3_000);
      if (ok(asg)) {
        await checkpoint(F, 'ASSIGNED', { expectStatus: 'ASSIGNED', actor: 'TD owner', rooms: [custRoom(false), engRoom()], notify: ['Individual engineer', ...CUST], mayNotify: ['TD team member'] });
        let conf = await walkStep(F, 'engineer confirms', () => patchJson(engineer, `/workOrders/${F.wo}/subStatus`, { subStatus: 'CONFIRMED' }));
        let confActor = 'Individual engineer';
        if (!ok(conf)) { conf = await walkStep(F, 'TD owner confirms (fallback)', () => patchJson(tdOwner, `/workOrders/${F.wo}/subStatus`, { subStatus: 'CONFIRMED' })); confActor = 'TD owner'; }
        await sleep(3_000);
        if (ok(conf)) await checkpoint(F, 'CONFIRMED', { expectSubStatus: 'CONFIRMED', actor: confActor, rooms: [custRoom(false), engRoom()], notify: ['TD team member', ...CUST], mayNotify: ['TD owner'] });
        await scheduleNow(F);
        const T = await taskIds(F, engineer);
        const ci = await walkStep(F, 'check-in', () => postJson(engineer, '/timeLogs/checkIn', { workOrderId: F.wo, checkInLatitude: T.lat, checkInLongitude: T.lng, taskId: T.checkIn, checkInTimeZone: 'UTC' }));
        await sleep(3_000);
        if (ok(ci)) await checkpoint(F, 'CHECK_IN', { expectStatus: 'INPROGRESS', actor: 'Individual engineer', rooms: [custRoom(false), engRoom()], notify: ['TD team member', ...CUST], mayNotify: ['TD owner'] });
        const co = await walkStep(F, 'check-out', () => postJson(engineer, '/timeLogs/checkOut', { workOrderId: F.wo, checkOutLatitude: T.lat, checkOutLongitude: T.lng, taskId: T.checkOut, checkOutTimeZone: 'UTC' }));
        await sleep(3_000);
        if (ok(co)) await checkpoint(F, 'CHECK_OUT', { actor: 'Individual engineer', rooms: [custRoom(false), engRoom()], notify: ['TD team member', ...CUST], mayNotify: ['TD owner'] });
        const mc = await walkStep(F, 'mark complete', () => patchJson(engineer, `/tasks/${T.complete}`, { isCompleted: true, text: 'Chat module QA automation complete' }));
        await sleep(3_000);
        if (ok(mc)) await checkpoint(F, 'WORKDONE', { expectStatus: 'WORKDONE', actor: 'Individual engineer', rooms: [custRoom(false), engRoom()], notify: ['TD team member', ...CUST], mayNotify: ['TD owner'] });
        await walkStep(F, 'sub-status REVIEWED', () => patchJson(tdOwner, `/workOrders/${F.wo}/subStatus`, { subStatus: 'REVIEWED' }));
        const ver = await walkStep(F, 'verify', () => postJson(tdOwner, `/workOrders/${F.wo}/verify`, {}));
        await sleep(3_000);
        if (ok(ver)) await checkpoint(F, 'VERIFIED', { expectStatus: 'VERIFIED', actor: 'TD owner', rooms: [custRoom(false), engRoom()], notify: [], mayNotify: ['Individual engineer', 'TD team member', ...CUST] });
        const apr = await walkStep(F, 'approve', () => postJson(tdOwner, `/workOrders/${F.wo}/approve`, {}));
        await sleep(3_000);
        if (ok(apr)) await checkpoint(F, 'APPROVED', { expectStatus: 'APPROVED', actor: 'TD owner', rooms: [custRoom(false), engRoom()], notify: [...CUST, 'Individual engineer'], mayNotify: ['TD team member'] });
      }
      await joinProbe(F, [custRoom(false), { ...engRoom(), roomId: F.roomIds.engineer }].map((r) => ({ ...r, roomId: r.roomId || F.roomIds[r.key] })));
      const lastTexts = (key) => { const st = F.steps.slice().reverse().find((s) => s.messages && s.messages[key]); return st ? Object.keys(st.messages[key].delivery || {}).map((lbl) => `CHAT ${F.key} ${st.step} ${RUN} ${key}-room msg from ${lbl}`) : []; };
      await uiEvidence(F, [
        { s: engineer, name: 'engineer', url: `/workOrder/messages/${F.wo}`, expectAccess: true, expectTexts: lastTexts('engineer'), bell: true },
        { s: custOwner, name: 'customer-owner', url: `/workOrder/messages/${F.wo}`, expectAccess: true, expectTexts: lastTexts('customer'), bell: true },
        { s: tdOwner, name: 'td-owner', url: `/workOrder/messages/${F.wo}?engineerId=${engineer.id}`, expectAccess: true, expectTexts: lastTexts('engineer') },
        { s: subUser, name: 'subuser', url: `/workOrder/messages/${F.wo}`, expectAccess: false, expectTexts: [...lastTexts('customer'), ...lastTexts('engineer')] },
        { s: vendor, name: 'vendor', url: `/workOrder/messages/${F.wo}`, expectAccess: false, expectTexts: [...lastTexts('customer'), ...lastTexts('engineer')] },
      ]);
    }
  }

  // ================================================================ Flow B: vendor (freelance company) path
  if (FLOWS.includes('B')) {
    const F = await createFlow('B', 'Tech Domain creates the WO; routed to the vendor, vendor accepts for its engineer, assigned and completed', tdOwner, (t) => clientWoPayload(template, t, ENTITY_ID, 5));
    if (F.wo) {
      await checkpoint(F, 'PUBLISHED', { expectStatus: 'PUBLISHED', actor: 'TD owner', rooms: [custRoom(false)], notify: CUST, mayNotify: ['TD team member'] });
      await noRoomYet(F, vendor, vendor.id);
      await noRoomYet(F, vendorEng, vendorEng.id);

      const routed = await walkStep(F, 'route to vendor owner', () => postJson(tdOwner, '/offers/route', { workOrderId: F.wo, userId: vendor.id }));
      const offerId = routed?.body?.data?.id || routed?.body?.id || null;
      await sleep(2_500);
      if (ok(routed)) await checkpoint(F, 'ROUTED', { expectStatus: 'PUBLISHED', actor: 'TD owner', rooms: [custRoom(false), vendorOwnerRoom(vendor, true)], notify: ['Vendor owner'], mayNotify: ['TD team member'] });

      const acc = offerId ? await walkStep(F, 'vendor accepts for member', () => postJson(vendor, `/offers/route/accept/${offerId}`, { referredEngineerId: vendorEng.id })) : null;
      await sleep(2_500);
      if (ok(acc)) await checkpoint(F, 'ROUTE ACCEPTED (for member)', { expectStatus: 'PUBLISHED', actor: 'Vendor owner', rooms: [custRoom(false), vendorOwnerRoom()], notify: TEAM, mayNotify: ['Vendor engineer'] });

      const asg = await walkStep(F, 'assign vendor member', () => postJson(tdOwner, '/offers/assign', { workOrderId: F.wo, userId: vendor.id, referredEngineerId: vendorEng.id }));
      await sleep(3_000);
      if (ok(asg)) {
        // the member room must be created proactively by the assignment (no open needed)
        await checkpoint(F, 'ASSIGNED', { expectStatus: 'ASSIGNED', actor: 'TD owner', rooms: [custRoom(false), vendorOwnerRoom(), { ...vendorMemberRoom(vendorEng, true), expectProactive: true }], notify: ['Vendor engineer', 'Vendor owner', ...CUST], mayNotify: ['TD team member'] });
        let conf = await walkStep(F, 'vendor engineer confirms', () => patchJson(vendorEng, `/workOrders/${F.wo}/subStatus`, { subStatus: 'CONFIRMED' }));
        let confActor = 'Vendor engineer';
        if (!ok(conf)) { conf = await walkStep(F, 'TD owner confirms (fallback)', () => patchJson(tdOwner, `/workOrders/${F.wo}/subStatus`, { subStatus: 'CONFIRMED' })); confActor = 'TD owner'; }
        await sleep(3_000);
        if (ok(conf)) await checkpoint(F, 'CONFIRMED', { expectSubStatus: 'CONFIRMED', actor: confActor, rooms: [custRoom(false), vendorOwnerRoom(), vendorMemberRoom()], notify: ['TD team member', 'Vendor owner', ...CUST], mayNotify: ['TD owner'] });
        await scheduleNow(F);
        const T = await taskIds(F, vendorEng);
        const ci = await walkStep(F, 'check-in (vendor engineer)', () => postJson(vendorEng, '/timeLogs/checkIn', { workOrderId: F.wo, checkInLatitude: T.lat, checkInLongitude: T.lng, taskId: T.checkIn, checkInTimeZone: 'UTC' }));
        await sleep(3_000);
        if (ok(ci)) await checkpoint(F, 'CHECK_IN', { expectStatus: 'INPROGRESS', actor: 'Vendor engineer', rooms: [custRoom(false), vendorOwnerRoom(), vendorMemberRoom()], notify: ['TD team member', 'Vendor owner', ...CUST], mayNotify: ['TD owner'] });
        const co = await walkStep(F, 'check-out (vendor engineer)', () => postJson(vendorEng, '/timeLogs/checkOut', { workOrderId: F.wo, checkOutLatitude: T.lat, checkOutLongitude: T.lng, taskId: T.checkOut, checkOutTimeZone: 'UTC' }));
        await sleep(3_000);
        if (ok(co)) await checkpoint(F, 'CHECK_OUT', { actor: 'Vendor engineer', rooms: [custRoom(false), vendorOwnerRoom(), vendorMemberRoom()], notify: ['TD team member', 'Vendor owner', ...CUST], mayNotify: ['TD owner'] });
        const mc = await walkStep(F, 'mark complete (vendor engineer)', () => patchJson(vendorEng, `/tasks/${T.complete}`, { isCompleted: true, text: 'Chat module QA automation complete' }));
        await sleep(3_000);
        if (ok(mc)) await checkpoint(F, 'WORKDONE', { expectStatus: 'WORKDONE', actor: 'Vendor engineer', rooms: [custRoom(false), vendorOwnerRoom(), vendorMemberRoom()], notify: ['TD team member', ...CUST], mayNotify: ['TD owner', 'Vendor owner'] });
        await walkStep(F, 'sub-status REVIEWED', () => patchJson(tdOwner, `/workOrders/${F.wo}/subStatus`, { subStatus: 'REVIEWED' }));
        const ver = await walkStep(F, 'verify', () => postJson(tdOwner, `/workOrders/${F.wo}/verify`, {}));
        await sleep(3_000);
        if (ok(ver)) await checkpoint(F, 'VERIFIED', { expectStatus: 'VERIFIED', actor: 'TD owner', rooms: [custRoom(false), vendorOwnerRoom(), vendorMemberRoom()], notify: [], mayNotify: ['Vendor engineer', 'Vendor owner', 'TD team member', ...CUST] });
        const apr = await walkStep(F, 'approve', () => postJson(tdOwner, `/workOrders/${F.wo}/approve`, {}));
        await sleep(3_000);
        if (ok(apr)) await checkpoint(F, 'APPROVED', { expectStatus: 'APPROVED', actor: 'TD owner', rooms: [custRoom(false), vendorOwnerRoom(), vendorMemberRoom()], notify: [...CUST, 'Vendor engineer'], mayNotify: ['Vendor owner', 'TD team member'] });
      }
      await joinProbe(F, [custRoom(false), vendorOwnerRoom(), vendorMemberRoom()].map((r) => ({ ...r, roomId: F.roomIds[r.key] })));
      const lastTexts = (key) => { const st = F.steps.slice().reverse().find((s) => s.messages && s.messages[key]); return st ? Object.keys(st.messages[key].delivery || {}).map((lbl) => `CHAT ${F.key} ${st.step} ${RUN} ${key}-room msg from ${lbl}`) : []; };
      await uiEvidence(F, [
        { s: vendorEng, name: 'vendor-engineer', url: `/workOrder/messages/${F.wo}`, expectAccess: true, expectTexts: lastTexts('vendorMember'), bell: true },
        { s: vendor, name: 'vendor-owner', url: `/workOrder/messages/${F.wo}?engineerId=${vendorEng.id}`, expectAccess: true, expectTexts: lastTexts('vendorMember'), bell: true },
        { s: custOwner, name: 'customer-owner', url: `/workOrder/messages/${F.wo}`, expectAccess: true, expectTexts: lastTexts('customer') },
        { s: tdOwner, name: 'td-owner', url: `/workOrder/messages/${F.wo}?engineerId=${vendorEng.id}`, expectAccess: true, expectTexts: lastTexts('vendorMember') },
        { s: engineer, name: 'other-engineer', url: `/workOrder/messages/${F.wo}`, expectAccess: false, expectTexts: [...lastTexts('customer'), ...lastTexts('vendorMember')] },
      ]);
    }
  }

  // ================================================================ Flow C: customer ticket, un-assign and cancel
  if (FLOWS.includes('C')) {
    const F = await createFlow('C', 'Customer owner raises a ticket; accepted, routed to the engineer, assigned, un-assigned, re-assigned, cancelled', custOwner, (t) => customerWoPayload(t, 7));
    if (F.wo) {
      await checkpoint(F, 'PENDING_APPROVAL (submitted)', { expectStatus: 'PENDING_APPROVAL', actor: 'Customer owner', rooms: [custRoom(false)], notify: ['TD owner'], mayNotify: ['TD team member'] });
      await noRoomYet(F, engineer, engineer.id);

      let ap = await walkStep(F, 'approvePublish', () => postJson(tdOwner, `/workOrders/${F.wo}/approvePublish`, {}));
      if (!ok(ap)) {
        const full = (await getJson(tdOwner, `/workOrders/${F.wo}`)).body?.data || {};
        await walkStep(F, 'PATCH WO before re-approve', () => patchJson(tdOwner, `/workOrders/${F.wo}`, { ...clientWoPayload(template, full.title || F.workOrder.title, ENTITY_ID, 7), addressId: full.address?.id || full.addressId }));
        ap = await walkStep(F, 'approvePublish (2nd)', () => postJson(tdOwner, `/workOrders/${F.wo}/approvePublish`, {}));
      }
      await sleep(3_000);
      if (ok(ap)) await checkpoint(F, 'PUBLISHED (accepted)', { expectStatus: 'PUBLISHED', actor: 'TD owner', rooms: [custRoom(false)], notify: CUST, mayNotify: ['TD team member'] });

      const routed = await walkStep(F, 'route to engineer', () => postJson(tdOwner, '/offers/route', { workOrderId: F.wo, userId: engineer.id }));
      const offerId = routed?.body?.data?.id || routed?.body?.id || null;
      await sleep(2_500);
      if (ok(routed)) await checkpoint(F, 'ROUTED', { expectStatus: 'PUBLISHED', actor: 'TD owner', rooms: [custRoom(false), engRoom(engineer, true)], notify: ['Individual engineer'], mayNotify: ['TD team member'] });
      const acc = offerId ? await walkStep(F, 'engineer accepts routed offer', () => postJson(engineer, `/offers/route/accept/${offerId}`, {})) : null;
      await sleep(2_500);
      if (ok(acc)) await checkpoint(F, 'ROUTE ACCEPTED', { expectStatus: 'PUBLISHED', actor: 'Individual engineer', rooms: [custRoom(false), engRoom()], notify: TEAM });
      const asg = await walkStep(F, 'assign', () => postJson(tdOwner, '/offers/assign', { workOrderId: F.wo, userId: engineer.id }));
      await sleep(3_000);
      if (ok(asg)) {
        await checkpoint(F, 'ASSIGNED', { expectStatus: 'ASSIGNED', actor: 'TD owner', rooms: [custRoom(false), engRoom()], notify: ['Individual engineer', ...CUST], mayNotify: ['TD team member'] });
        const offer = await offerBy(F.wo, engineer.id);
        const un = await walkStep(F, `un-assign (offers/status PENDING, offer ${offer?.id})`, () => postJson(tdOwner, '/offers/status', { status: 'PENDING', offerId: offer?.id, userId: engineer.id, workOrderId: F.wo }));
        await sleep(3_000);
        // after un-assign the offer is PENDING again: by the code rules the engineer may still open/use their own room
        if (ok(un)) await checkpoint(F, 'UNASSIGNED (offer back to PENDING)', { expectStatus: 'PUBLISHED', actor: 'TD owner', rooms: [custRoom(false), engRoom()], notify: ['Individual engineer'], mayNotify: ['TD team member', ...CUST] });
        const re = await walkStep(F, 're-assign', () => postJson(tdOwner, '/offers/assign', { workOrderId: F.wo, userId: engineer.id }));
        await sleep(3_000);
        if (ok(re)) await checkpoint(F, 'RE-ASSIGNED', { expectStatus: 'ASSIGNED', actor: 'TD owner', rooms: [custRoom(false), engRoom()], notify: ['Individual engineer', ...CUST], mayNotify: ['TD team member'] });
        const can = await walkStep(F, 'client cancels', () => postJson(tdOwner, `/workOrders/client/cancel/${F.wo}`, { cancellationReason: 'OTHER', reason: 'Chat module QA automation' }));
        await sleep(3_000);
        if (ok(can)) await checkpoint(F, 'CANCELLED', { expectStatus: 'CANCELLED', actor: 'TD owner', rooms: [custRoom(false), engRoom()], notify: ['Individual engineer'], mayNotify: ['TD team member', ...CUST] });
      }
      await joinProbe(F, [custRoom(false), engRoom()].map((r) => ({ ...r, roomId: F.roomIds[r.key] })));
      const lastTexts = (key) => { const st = F.steps.slice().reverse().find((s) => s.messages && s.messages[key]); return st ? Object.keys(st.messages[key].delivery || {}).map((lbl) => `CHAT ${F.key} ${st.step} ${RUN} ${key}-room msg from ${lbl}`) : []; };
      await uiEvidence(F, [
        { s: custOwner, name: 'customer-owner', url: `/workOrder/messages/${F.wo}`, expectAccess: true, expectTexts: lastTexts('customer'), bell: true },
        { s: engineer, name: 'engineer', url: `/workOrder/messages/${F.wo}`, expectAccess: true, expectTexts: lastTexts('engineer') },
        // by design: any Tech Domain user may open the customer chat (joins on first open) and message in it
        { s: nonTeam, name: 'nonteam', url: `/workOrder/messages/${F.wo}?engineerId=${custOwner.id}`, expectAccess: true, expectTexts: lastTexts('customer') },
      ]);
      const after = (await listRooms(F.wo)).find((r) => r.isCustomerChat);
      const joined = !!after && after.participants.includes(nonTeam.id);
      F.steps.push({ step: 'Non-team TD user opened the customer chat URL (by design: joins on open)', checks: [{ name: 'non-team TD user joined the customer room by opening it', ok: joined, detail: { participants: after?.participants?.map(labelOf) } }] });
      expect.soft(joined, 'non-team TD user joins the customer room on open (by design)').toBe(true);
    }
  }

  // ---------------------------------------------------------------- report
  const lines = [];
  for (const F of results.flows) {
    const all = F.steps.flatMap((s) => s.checks || []);
    const failed = all.filter((c) => !c.ok);
    lines.push(`Flow ${F.key} - ${F.title}: WO ${F.wo || '-'} (ref ${F.workOrder?.referenceId || '-'}) rooms ${JSON.stringify(F.roomIds)} -> ${all.length - failed.length}/${all.length} checks passed`);
    for (const s of F.steps) {
      const f = (s.checks || []).filter((c) => !c.ok);
      lines.push(`   ${s.step} [${s.status?.status || '-'}/${s.status?.subStatus || '-'}]: ${(s.checks || []).length - f.length}/${(s.checks || []).length}` + (f.length ? ' FAILED: ' + f.map((x) => x.name).join('; ') : ''));
    }
  }
  const full = lines.join('\n') + `\n\nFindings:\n${results.findings.map((f) => '- ' + f).join('\n') || 'none'}\n\nInfo:\n${results.info.map((f) => '- ' + f).join('\n') || 'none'}\n`;
  log(`\nSUMMARY\n${full}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), full);
});
