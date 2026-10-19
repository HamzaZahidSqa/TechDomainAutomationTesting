// Re-test of the "engineer/vendor can POST into the customer <-> Tech Domain room" bug after the API fix.
// Run: node scripts/retest-customer-room-send.js   (writes evidence/ChatModule-Full/retest-customer-room-send-<stamp>.json)
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const accounts = require(path.join(ROOT, 'accounts.json'));
const testAccounts = require(path.join(ROOT, 'test-accounts.json'));
const td123 = require(path.join(ROOT, 'td123-accounts.json'));
const API = 'https://api.dev.techdomain.com.au/api';
const H = { Origin: 'https://dev.techdomain.com.au', 'Content-Type': 'application/json' };
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const results = { run: RUN, date: new Date().toISOString(), checks: [] };
const check = (name, ok, detail) => { results.checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} - ${name} :: ${JSON.stringify(detail)}`); };
async function login(a) { const r = await fetch(API + '/auth/login', { method: 'POST', headers: H, body: JSON.stringify({ email: a.email, password: a.password }) }); const b = await r.json().catch(() => ({})); if (!b.accessToken) throw new Error('login failed ' + a.email); return { token: b.accessToken, id: (b.data || b.user || {}).id, label: a.role }; }
async function req(s, m, p, body) { const r = await fetch(API + p, { method: m, headers: { ...H, Authorization: 'Bearer ' + s.token }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; }
const send = (s, room, text) => req(s, 'POST', `/inbox/${room}/message`, { message: `<p>${text}</p>` });
const blocked = (st) => st === 403 || st === 404;
const strip = (h) => String(h || '').replace(/<[^>]+>/g, '');

(async () => {
  const tdOwner = await login(accounts.find((a) => a.role === 'TechDomain User'));
  const team = await login(td123.find((a) => a.role === 'TD Team Member'));
  const cust = await login(testAccounts.find((a) => a.role === 'Customer'));
  const eng = await login(accounts.find((a) => a.role === 'Individual Engineer'));
  const vendor = await login(accounts.find((a) => a.role === 'Vendor'));
  const veng = await login(accounts.find((a) => a.role === 'Vendor Engineer'));
  const sub = await login(td123.find((a) => a.role === 'Customer Sub-user'));
  const other = await login(accounts.find((a) => a.role === 'Customer'));

  // ---- 1. existing work orders from the full run
  const cases = [
    { wo: 1074, ref: 11068, room: 1921, kind: 'customer room', outsiders: [eng, vendor, veng, sub, other], insiders: [cust, tdOwner, team] },
    { wo: 1075, ref: 11069, room: 1928, kind: 'customer room', outsiders: [vendor, veng, eng, sub, other], insiders: [cust, tdOwner, team] },
    { wo: 1076, ref: 11070, room: 1933, kind: 'customer room', outsiders: [eng, vendor, veng, sub, other], insiders: [cust, tdOwner, team] },
    { wo: 1075, ref: 11069, room: 1929, kind: 'vendor owner room', outsiders: [cust, eng, sub, other], insiders: [vendor, tdOwner, team] },
    { wo: 1074, ref: 11068, room: 1922, kind: 'engineer room', outsiders: [cust, vendor, veng, sub, other], insiders: [eng, tdOwner, team] },
  ];
  for (const c of (process.env.SKIP_OLD ? [] : cases)) {
    for (const o of c.outsiders) {
      const r = await send(o, c.room, `RETEST ${RUN} ${o.label} into ${c.kind} ${c.room}`);
      check(`WO #${c.ref} ${c.kind} ${c.room}: ${o.label} cannot send`, blocked(r.status), { status: r.status, message: r.body?.message });
    }
    for (const i of c.insiders) {
      const r = await send(i, c.room, `RETEST ${RUN} ${i.label} into ${c.kind} ${c.room} (allowed)`);
      check(`WO #${c.ref} ${c.kind} ${c.room}: ${i.label} can still send`, r.status < 300, { status: r.status, message: r.body?.message });
    }
    const thread = await req(tdOwner, 'GET', `/inbox/${c.room}?limit=0&markAsRead=false`);
    const texts = (thread.body?.data?.messages || []).map((m) => strip(m.message));
    const leaked = texts.filter((t) => t.includes(`RETEST ${RUN}`) && !t.includes('(allowed)'));
    check(`WO #${c.ref} ${c.kind} ${c.room}: no outsider message landed in the thread`, leaked.length === 0, { leaked });
  }
  // vendor engineer's own room on 1075 (created when they opened Messages) must still work for them
  const vroom = (await req(tdOwner, 'GET', '/chats/users/1075/9')).body?.data?.find((r) => r.id === veng.id)?.chatRoomId;
  if (vroom) { const r = await send(veng, vroom, `RETEST ${RUN} Vendor Engineer into own room (allowed)`); check(`WO #11069 vendor engineer room ${vroom}: Vendor Engineer can still send`, r.status < 300, { status: r.status, message: r.body?.message }); }

  // ---- 2. fresh work order: engineer with only a REQUEST (never assigned) must not reach the customer room
  const t = (await req(tdOwner, 'GET', '/workOrders/242')).body?.data || {};
  const start = new Date(Date.now() + 9 * 86_400_000); start.setUTCHours(6, 0, 0, 0); const day = start.toISOString().slice(0, 10);
  const payload = {
    templateId: null, title: `RETEST customer-room send ${RUN}`, serviceLevelAgreeement: '', clientId: 104, projectId: t.project?.id || null,
    teamId: '8ae534d5-d80c-49d9-8ac3-849fc63a927f', secondaryTeamId: 'cf0ed3db-521f-4c9f-887b-d5301383f8ce', teamName: 'Service Delivery 3', secondaryTeamName: 'Operation 3',
    isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'retest', confidentialInformation: '',
    categoryId: t.category?.id, workOrderServices: (t.workOrderServices || []).map((s) => ({ serviceId: s.serviceId || s.id })),
    scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T06:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'UTC', addressId: t.address?.id,
    qualificationSubTypes: [], expenses: [], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: 20, minimumHours: 4,
    nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null,
    engineerExpenses: [], engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', engineerHourlyRate: 15, engineerAdditionalHourlyRate: null, engineerHalfDayRate: null, engineerFullDayRate: null, engineerFthRate: null, engineerFixedAmount: null, engineerMinimumHours: 4,
    isDraft: false, tasks: ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] })), contacts: [], workOrderManagerId: null, customerFiles: [],
  };
  const cr = await req(tdOwner, 'POST', '/workOrders', payload);
  const wo = cr.body?.data?.id || cr.body?.id || cr.body?.data?.workOrder?.id;
  if (!wo) console.log('create response:', JSON.stringify(cr.body).slice(0, 400));
  results.freshWo = wo;
  console.log(`fresh WO ${wo} (HTTP ${cr.status}) ref ${(await req(tdOwner, 'GET', `/workOrders/${wo}`)).body?.data?.referenceId}`);
  if (wo) {
    await new Promise((r) => setTimeout(r, 2500));
    const room = (await req(tdOwner, 'GET', `/chats/users/${wo}/9`)).body?.data?.find((r) => r.isCustomerChat)?.chatRoomId;
    check(`fresh WO ${wo}: customer room exists`, !!room, { room });
    let r = await send(eng, room, `RETEST ${RUN} engineer with NO offer into customer room`);
    check(`fresh WO ${wo} PUBLISHED (no offer): engineer cannot send into customer room ${room}`, blocked(r.status), { status: r.status, message: r.body?.message });
    const rq = await req(eng, 'POST', '/offers/engineer/request', { workOrderId: wo });
    console.log(`engineer request -> HTTP ${rq.status}`);
    r = await send(eng, room, `RETEST ${RUN} engineer with REQUEST only into customer room`);
    check(`fresh WO ${wo} REQUESTED: engineer cannot send into customer room ${room}`, blocked(r.status), { status: r.status, message: r.body?.message });
    const own = await req(eng, 'POST', '/chats/room/group', { workOrderId: wo, companyId: 9, engineerId: eng.id });
    const ownRoom = own.body?.id || own.body?.chatRoomId || own.body?.data?.id;
    r = ownRoom ? await send(eng, ownRoom, `RETEST ${RUN} engineer into own room (allowed)`) : { status: 599, body: { message: 'own room could not be opened' } };
    check(`fresh WO ${wo} REQUESTED: engineer can send in their own room ${ownRoom}`, r.status < 300, { openStatus: own.status, status: r.status, message: r.body?.message });
    const asg = await req(tdOwner, 'POST', '/offers/assign', { workOrderId: wo, userId: eng.id });
    console.log(`assign -> HTTP ${asg.status} ${JSON.stringify(asg.body).slice(0, 120)}`);
    r = await send(eng, room, `RETEST ${RUN} ASSIGNED engineer into customer room`);
    check(`fresh WO ${wo} ASSIGNED: engineer cannot send into customer room ${room}`, blocked(r.status), { status: r.status, message: r.body?.message });
    const thread = await req(cust, 'GET', `/inbox/${room}?limit=0&markAsRead=false`);
    const leaked = (thread.body?.data?.messages || []).map((m) => strip(m.message)).filter((x) => x.includes(`RETEST ${RUN}`));
    check(`fresh WO ${wo}: customer thread contains no engineer message`, leaked.length === 0, { leaked });
  }
  const failed = results.checks.filter((c) => !c.ok);
  console.log(`\n${results.checks.length - failed.length}/${results.checks.length} passed${failed.length ? '; FAILED: ' + failed.map((f) => f.name).join('; ') : ''}`);
  fs.writeFileSync(path.join(ROOT, 'evidence', 'ChatModule-Full', `retest-customer-room-send-${RUN}.json`), JSON.stringify(results, null, 2));
})();
