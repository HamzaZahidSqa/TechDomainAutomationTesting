// TD-92: "Remove vendor from customer and techdomain chat after assignment"
// https://techdomain.atlassian.net/browse/TD-92
//
// Flow (API + UI evidence):
//   1. CLIENT (Tech Domain, company 9) creates a work order for a customer that has a portal user.
//   2. CLIENT routes it to the Vendor (freelance company owner 609) and assigns the vendor.
//   3. Vendor assigns the work order to its member (Vendor Engineer 611).
//   4. Checks after assignment:
//        - customer <-> Tech Domain room participants do NOT include the vendor owner
//        - vendor's inbox does not list that room, GET /chats/<room> is forbidden for the vendor
//        - vendor UI sidebar on /workOrder/messages/<wo> shows no customer conversation
//   Snapshots are also taken right after routing (before assignment) for comparison.
// Evidence: evidence/TD-92-VendorChatRemoval/run-<stamp>/TD-92_VendorChat_NN_<step>.png + results JSON

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-92-VendorChatRemoval', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const byRole = (r) => accounts.find((a) => a.role === r);
const TEMPLATE_WO = Number(process.env.TEMPLATE_WO || 242);

test.setTimeout(420_000);

let shotNo = 0;
async function shot(page, name) {
  shotNo += 1;
  await page.screenshot({ path: path.join(EVIDENCE, `TD-92_VendorChat_${String(shotNo).padStart(2, '0')}_${name}.png`) });
}

async function apiLogin(account) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: { Origin: 'https://dev.techdomain.com.au' } });
  const res = await ctx.post(u('/auth/login'), { data: { email: account.email, password: account.password } });
  const body = await res.json().catch(() => ({}));
  await ctx.dispose();
  if (!body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${res.status()}`);
  const api = await pwRequest.newContext({ extraHTTPHeaders: { Origin: 'https://dev.techdomain.com.au', Authorization: `Bearer ${body.accessToken}` } });
  const me = await (await api.get(u('/users/me'))).json().catch(() => ({}));
  const user = me.user || me.data || me;
  return { account, api, user, id: user.id, companyId: user.companyId || user.company?.id };
}
async function getJson(s, p) { const r = await s.api.get(u(p)); return { status: r.status(), body: await r.json().catch(() => ({})) }; }
async function postJson(s, p, data) { const r = await s.api.post(u(p), { data }); return { status: r.status(), body: await r.json().catch(async () => ({ text: await r.text().catch(() => '') })) }; }

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

// Rooms on a work order as seen by a session: inbox rows + the client's chat-users list
async function roomsOnWo(session, woId, companyId) {
  const inbox = await getJson(session, '/inbox?limit=50');
  const rows = (inbox.body?.data || []).filter((r) => r.workOrder?.id === woId);
  let chatUsers = [];
  if (companyId) { const cu = await getJson(session, `/chats/users/${woId}/${companyId}`); chatUsers = cu.body?.data || []; }
  return { rows, chatUsers };
}
async function participants(session, convId) {
  const r = await getJson(session, `/inbox/${convId}?limit=1&markAsRead=false`);
  const conv = r.body?.data?.conversation || r.body?.conversation || {};
  return { status: r.status, list: (conv.participants || []).map((p) => ({ id: p.id, name: p.name, role: p.role })) };
}

test('TD-92: vendor is removed from the customer <-> Tech Domain chat after assignment', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 600) }); };
  const results = { run: RUN };

  const client = await apiLogin(byRole('TechDomain User'));
  const vendor = await apiLogin(byRole('Vendor'));
  const member = await apiLogin(byRole('Vendor Engineer'));
  log(`client id=${client.id} company=${client.companyId}; vendor id=${vendor.id}; member id=${member.id}`);

  // ---------- 0. pick a customer with a portal user (needed for the customer <-> TD room) ----------
  const cl = await getJson(client, '/clients?limit=60');
  const customers = cl.body?.data?.data || cl.body?.data || [];
  let customer = null;
  for (const c of customers.slice(0, 40)) {
    const d = await getJson(client, `/clients/${c.id}`);
    const rec = d.body?.data || d.body;
    if (rec?.ownerId || rec?.owner?.id) { customer = { id: rec.id, name: rec.name || rec.clientName, ownerId: rec.ownerId || rec.owner?.id, email: rec.owner?.email || rec.email }; break; }
  }
  log(`customer with portal user: ${JSON.stringify(customer)}`);
  expect(customer, 'need a customer that has a portal user').toBeTruthy();
  results.customer = customer;

  // ---------- 1. create the work order from the template ----------
  const t = (await getJson(client, `/workOrders/${TEMPLATE_WO}`)).body?.data;
  expect(t, `template WO ${TEMPLATE_WO} readable`).toBeTruthy();
  const start = new Date(Date.now() + 3 * 86_400_000); start.setHours(10, 0, 0, 0);
  const day = start.toISOString().slice(0, 10);
  const payload = {
    templateId: null,
    title: `TD92 ${RUN} vendor removed from customer chat`,
    serviceLevelAgreeement: t.serviceLevelAgreeement || '',
    clientId: customer.id,
    projectId: t.project?.id || null,
    teamId: t.team?.id, secondaryTeamId: t.secondaryTeam?.id || null,
    teamName: t.team?.name, secondaryTeamName: t.secondaryTeam?.name || '',
    isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '',
    description: 'TD-92 QA automation', confidentialInformation: '',
    categoryId: t.category?.id,
    workOrderServices: (t.workOrderServices || []).map((s) => ({ serviceId: s.serviceId || s.id })),
    scheduleType: 'HARD_START',
    orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null,
    timeZone: t.timeZone || 'Asia/Karachi',
    addressId: t.address?.id || t.addressId,
    qualificationSubTypes: (t.qualificationSubTypes || []).map((q) => q.id),
    expenses: [], paymentType: 'HOURLY', paymentTerms: t.paymentTerms || '15 days', currency: t.currency || 'USD',
    hourlyRate: t.hourlyRate || 20, minimumHours: t.minimumHours || 4,
    nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null,
    // engineer rates are set so a routed vendor can ACCEPT instead of being forced to counter-offer
    engineerExpenses: [], engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', engineerHourlyRate: 15, engineerAdditionalHourlyRate: null, engineerHalfDayRate: null, engineerFullDayRate: null, engineerFthRate: null, engineerFixedAmount: null, engineerMinimumHours: 4,
    isDraft: false,
    tasks: (t.tasks || []).filter((x) => x.taskType).map((x) => ({ taskType: x.taskType, title: x.title, emailsToNotify: [] })),
    contacts: [], workOrderManagerId: t.workOrderManager?.id || null, customerFiles: [],
  };
  if (!payload.tasks.length) payload.tasks = ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] }));
  let wo = Number(process.env.WO_ID) || null;
  if (!wo) {
    const created = await postJson(client, '/workOrders', payload);
    log(`create WO -> HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
    wo = created.body?.data?.id || created.body?.id;
  } else log(`reusing WO_ID=${wo}`);
  expect(wo, 'work order created').toBeTruthy();
  results.workOrderId = wo;

  // ---------- 2. route to vendor; vendor accepts for its member; client assigns ----------
  const routed = await postJson(client, '/offers/route', { workOrderId: wo, userId: vendor.id });
  log(`route to vendor -> HTTP ${routed.status} ${JSON.stringify(routed.body).slice(0, 200)}`);
  results.routeStatus = routed.status;
  let offerId = routed.body?.data?.id || routed.body?.id || null;
  if (!offerId) {
    const offers = await postJson(client, `/offers/${wo}`, { limit: 20, page: 1 });
    const list = offers.body?.data?.offers || offers.body?.data?.data || offers.body?.data || [];
    offerId = (Array.isArray(list) ? list : []).find((o) => o.userId === vendor.id)?.id || null;
  }
  // The FE calls POST offers/route/accept/:offerId {referredEngineerId} - the vendor accepts on behalf of a member.
  const accepted = offerId ? await postJson(vendor, `/offers/route/accept/${offerId}`, { referredEngineerId: member.id }) : { status: 0, body: 'no offer id' };
  log(`vendor accepts routed offer ${offerId} for member ${member.id} -> HTTP ${accepted.status} ${JSON.stringify(accepted.body).slice(0, 200)}`);
  results.acceptStatus = accepted.status;

  // snapshot BEFORE assignment
  const beforeVendor = await roomsOnWo(vendor, wo, client.companyId);
  const beforeClient = await roomsOnWo(client, wo, client.companyId);
  log(`before assignment - vendor inbox rows on WO: ${JSON.stringify(beforeVendor.rows.map((r) => ({ room: r.chatRoomId, engineerId: r.engineerId, participant: r.participant?.name })))}`);
  log(`before assignment - client chat users: ${JSON.stringify(beforeClient.chatUsers.map((r) => ({ id: r.id, name: `${r.firstName || ''} ${r.lastName || ''}`.trim(), room: r.chatRoomId, isCustomerChat: r.isCustomerChat })))}`);

  let assigned = { status: 0 };
  for (const body of [
    { workOrderId: wo, userId: vendor.id, referredEngineerId: member.id, offerId },
    { workOrderId: wo, userId: vendor.id, referredEngineerId: member.id },
    { workOrderId: wo, userId: member.id, offerId },
    { workOrderId: wo, userId: vendor.id, offerId },
    { workOrderId: wo, userId: vendor.id },
  ]) {
    assigned = await postJson(client, '/offers/assign', body);
    log(`client assign ${JSON.stringify(body)} -> HTTP ${assigned.status} ${JSON.stringify(assigned.body).slice(0, 200)}`);
    if (assigned.status < 300) break;
  }
  results.assignVendorStatus = assigned.status;

  // ---------- 3. if the WO is assigned to the vendor company but not yet to a member, the vendor assigns its member ----------
  let woDetail = (await getJson(client, `/workOrders/${wo}`)).body?.data;
  if (woDetail?.status === 'ASSIGNED' && woDetail?.engineer?.id !== member.id) {
    const members = await getJson(vendor, '/freelanceCompany/members?page=1&limit=20');
    const mem = (members.body?.data?.data || members.body?.data || []).find((m) => (m.userId || m.user?.id) === member.id);
    const memberAssigned = mem ? await postJson(vendor, '/freelanceCompany/assign', { workOrderId: wo, memberId: mem.id }) : { status: 0, body: 'no member' };
    log(`vendor assigns member -> HTTP ${memberAssigned.status} ${JSON.stringify(memberAssigned.body).slice(0, 300)}`);
    results.assignMemberStatus = memberAssigned.status;
    woDetail = (await getJson(client, `/workOrders/${wo}`)).body?.data;
  }
  log(`WO after assignment: status=${woDetail?.status} engineer=${woDetail?.engineer?.id} engineerCompany=${woDetail?.engineerCompany?.id}`);
  results.woStatus = woDetail?.status;

  // ---------- 4. checks after assignment ----------
  // 4a. open/backfill the customer room from the client side and find its id
  const afterClient = await roomsOnWo(client, wo, client.companyId);
  log(`after assignment - client chat users: ${JSON.stringify(afterClient.chatUsers.map((r) => ({ id: r.id, name: `${r.firstName || ''} ${r.lastName || ''}`.trim(), room: r.chatRoomId, isCustomerChat: r.isCustomerChat })))}`);
  let customerRow = afterClient.chatUsers.find((r) => r.isCustomerChat) || null;
  let customerRoomId = customerRow?.chatRoomId || customerRow?.conversationId || null;
  if (!customerRoomId) {
    // materialise the room: target = customer portal user
    const room = await postJson(client, '/chats/room/group', { workOrderId: wo, companyId: client.companyId, engineerId: customer.ownerId });
    log(`fetchOrCreate customer room -> HTTP ${room.status} ${JSON.stringify(room.body).slice(0, 200)}`);
    customerRoomId = room.body?.data?.id || room.body?.id || null;
  }
  results.customerRoomId = customerRoomId;
  log(`customer <-> TD room id: ${customerRoomId}`);

  // 4b. participants of the customer room (client view) must not include the vendor
  let parts = { status: 0, list: [] };
  if (customerRoomId) parts = await participants(client, customerRoomId);
  log(`customer room participants (client view): HTTP ${parts.status} ${JSON.stringify(parts.list)}`);
  results.customerRoomParticipants = parts.list;
  results.vendorInCustomerRoom = parts.list.some((p) => p.id === vendor.id);

  // 4c. vendor side: inbox rows on this WO and direct read of the customer room
  const afterVendor = await roomsOnWo(vendor, wo, client.companyId);
  log(`after assignment - vendor inbox rows on WO: ${JSON.stringify(afterVendor.rows.map((r) => ({ room: r.chatRoomId, engineerId: r.engineerId, participant: r.participant?.name })))}`);
  results.vendorInboxHasCustomerRoom = afterVendor.rows.some((r) => r.engineerId == null);
  const vendorRead = customerRoomId ? await getJson(vendor, `/chats/${customerRoomId}?limit=1`) : { status: 0 };
  log(`vendor GET /chats/${customerRoomId} -> HTTP ${vendorRead.status}`);
  results.vendorReadCustomerRoomStatus = vendorRead.status;
  const vendorJoin = customerRoomId ? await postJson(vendor, '/chats/room/group', { workOrderId: wo, companyId: client.companyId, engineerId: customer.ownerId }) : { status: 0 };
  log(`vendor POST /chats/room/group (customer room) -> HTTP ${vendorJoin.status}`);
  results.vendorJoinCustomerRoomStatus = vendorJoin.status;

  // 4d. member (assigned engineer) side, informational
  const afterMember = await roomsOnWo(member, wo, client.companyId);
  log(`after assignment - member inbox rows on WO: ${JSON.stringify(afterMember.rows.map((r) => ({ room: r.chatRoomId, engineerId: r.engineerId, participant: r.participant?.name })))}`);

  // ---------- 5. UI evidence ----------
  const geo = { geolocation: { latitude: 31.4689, longitude: 74.2636 }, permissions: ['geolocation'], viewport: { width: 1440, height: 900 } };
  for (const [label, acc] of [['vendor', byRole('Vendor')], ['client', byRole('TechDomain User')], ['member', byRole('Vendor Engineer')]]) {
    const ctx = await browser.newContext(geo);
    const page = await ctx.newPage();
    page.setDefaultTimeout(15_000);
    try {
      await uiLogin(page, acc);
      await page.goto(`/workOrder/messages/${wo}`);
      await page.waitForTimeout(5_000);
      await shot(page, `${label}-messages-tab-after-assignment`);
      const text = await page.locator('body').innerText();
      results[`${label}SidebarText`] = text.slice(0, 400);
      if (label === 'vendor') results.vendorUiShowsCustomer = text.includes(customer.name);
      if (label === 'client') { results.clientUiShowsCustomer = text.includes(customer.name); results.clientUiShowsVendor = /Demo CompanyOwner|Demo Field Services/.test(text); }
    } catch (e) { log(`${label} UI step failed: ${e.message.slice(0, 200)}`); }
    await ctx.close();
  }

  fs.writeFileSync(path.join(EVIDENCE, `TD-92_results_${RUN}.json`), JSON.stringify(results, null, 2));
  log(`RESULTS: ${JSON.stringify(results)}`);

  // ---------- assertions ----------
  expect.soft(results.woStatus, 'work order should be ASSIGNED').toBe('ASSIGNED');
  expect.soft(customerRoomId, 'customer <-> Tech Domain room should exist').toBeTruthy();
  expect.soft(results.vendorInCustomerRoom, 'vendor must NOT be a participant of the customer <-> TD room').toBe(false);
  expect.soft(results.vendorInboxHasCustomerRoom, 'vendor inbox must NOT list the customer <-> TD room').toBe(false);
  expect.soft([401, 403, 404].includes(results.vendorReadCustomerRoomStatus), `vendor GET /chats/<customer room> should be forbidden (got ${results.vendorReadCustomerRoomStatus})`).toBe(true);
  expect.soft(results.vendorUiShowsCustomer, 'vendor Messages tab must not show the customer conversation').toBe(false);
});
