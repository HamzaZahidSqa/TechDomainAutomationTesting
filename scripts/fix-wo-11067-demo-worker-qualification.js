// WO #11067: add the missing "Cabling Licence" to Demo Worker (user 611) and verify it as Admin.
// Run: node scripts/fix-wo-11067-demo-worker-qualification.js   (env WO_NUMBER / WO_ID override)
const path = require('path'); const fs = require('fs');
const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API = 'https://api.dev.techdomain.com.au/api'; const H = { Origin: 'https://dev.techdomain.com.au', 'Content-Type': 'application/json' };
const WO_NUMBER = Number(process.env.WO_NUMBER || 11067); const WORKER_ID = 611;
const LOG = path.join(__dirname, '..', 'evidence', 'WO-11067-DemoWorkerQualification', 'fix-api-log.txt'); fs.writeFileSync(LOG, '');
const log = (s) => { console.log(s); fs.appendFileSync(LOG, s + '\n'); };
async function call(tok, method, p, data) { const r = await fetch(`${API}${p}`, { method, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = { text: t }; } return { status: r.status, body: b }; }
async function login(role) { const a = accounts.find((x) => x.role === role); const r = await call(null, 'POST', '/auth/login', { email: a.email, password: a.password }); if (!r.body.accessToken) throw new Error(`login ${role} failed ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); return { tok: r.body.accessToken, id: r.body.data?.id }; }
(async () => {
  const td = await login('TechDomain User'), worker = await login('Vendor Engineer'), adm = await login('Admin');
  log(`logins: TD ${td.id}, worker ${worker.id}, admin ${adm.id}`);
  if (worker.id !== WORKER_ID) throw new Error(`Vendor Engineer account is user ${worker.id}, expected ${WORKER_ID}`);
  // 1. find the work order id for #WO_NUMBER (ids run ~9994 below the number on dev)
  let woId = Number(process.env.WO_ID) || 0, wo;
  if (!woId) { for (const cand of [WO_NUMBER - 9994, WO_NUMBER - 9993, WO_NUMBER - 9995, WO_NUMBER - 9992, WO_NUMBER - 9996]) { const r = await call(td.tok, 'GET', `/workOrders/${cand}`); const d = r.body?.data; const num = d?.referenceId ?? d?.workOrderNumber ?? d?.number ?? d?.orderNumber ?? d?.workOrderId; log(`probe GET /workOrders/${cand} -> ${r.status} number=${num} title=${d?.title}`); if (r.status === 200 && (Number(num) === WO_NUMBER || Number(String(num).replace(/\D/g, '')) === WO_NUMBER)) { woId = cand; wo = d; break; } } }
  if (!woId) { log(JSON.stringify((await call(td.tok, 'GET', `/workOrders/${WO_NUMBER - 9994}`)).body).slice(0, 1500)); throw new Error('work order id not found'); }
  if (!wo) wo = (await call(td.tok, 'GET', `/workOrders/${woId}`)).body?.data;
  const required = (wo.qualificationSubTypes || []).map((q) => ({ id: q.id, name: q.name, typeId: q.qualificationType?.id ?? q.qualificationTypeId, type: q.qualificationType?.name }));
  log(`WO #${WO_NUMBER} = id ${woId} status ${wo.status} engineer ${wo.engineer?.id} required=${JSON.stringify(required)}`);
  // 2. worker's current qualifications
  const mine = (await call(worker.tok, 'GET', '/users/qualifications')).body?.data || [];
  log(`worker ${WORKER_ID} qualifications before: ${JSON.stringify(mine.map((x) => ({ id: x.id, sub: x.qualificationSubType?.name ?? x.qualificationSubType, subId: x.qualificationSubType?.id ?? x.qualificationSubTypeId, verified: x.isVerified })))}`);
  for (const req of required) {
    let row = mine.find((x) => (x.qualificationSubType?.id ?? x.qualificationSubTypeId) === req.id || (x.qualificationSubType?.name ?? x.qualificationSubType) === req.name);
    if (!row) { const r = await call(worker.tok, 'POST', '/users/qualifications', { qualificationSubTypeId: req.id }); log(`worker POST /users/qualifications {qualificationSubTypeId:${req.id}} (${req.name}) -> ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); row = r.body?.data; if (!row?.id) throw new Error('could not add qualification'); }
    else log(`worker already has "${req.name}": userQualification ${row.id} isVerified ${row.isVerified}`);
    if (!row.isVerified) { const v = await call(adm.tok, 'POST', '/admin/equipment/verify', { userQualificationId: row.id, isVerified: true }); log(`ADMIN POST /admin/equipment/verify {userQualificationId:${row.id}} -> ${v.status} ${JSON.stringify(v.body).slice(0, 300)}`); }
    const chk = await call(td.tok, 'GET', `/users/qualifications/${WORKER_ID}/${req.typeId}`); log(`TD GET /users/qualifications/${WORKER_ID}/${req.typeId} -> ${chk.status} ${JSON.stringify((chk.body?.data || []).map((x) => ({ id: x.id, sub: x.qualificationSubType?.name ?? x.qualificationSubType, isVerified: x.isVerified })))}`);
  }
  // 3. eligibility check from the Tech Domain side
  const e = await call(td.tok, 'POST', `/offers/engineer/workOrder/${woId}`, { userId: WORKER_ID });
  log(`TD POST /offers/engineer/workOrder/${woId} {userId:${WORKER_ID}} -> ${e.status} isEngineerQualificationsVerified=${e.body?.data?.isEngineerQualificationsVerified} ${JSON.stringify(e.body).slice(0, 400)}`);
})().catch((err) => { log('ERROR ' + err.message); process.exit(1); });
