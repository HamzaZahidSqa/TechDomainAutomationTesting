// Builds the TD-111 verification report (PDF in ~/Downloads + HTML next to the evidence) from a run's results.json.
// usage: node scripts/build-td111-report.js [run-folder]   (default: newest evidence/TD-111-CustomerCounterOffer/run-*)
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'evidence', 'TD-111-CustomerCounterOffer');
const runArg = process.argv.filter((a) => !a.startsWith('--'))[2];
const outIdx = process.argv.indexOf('--out'); const OUT_NAME = outIdx > -1 ? process.argv[outIdx + 1] : 'TD-111-Verification-Report.pdf';
const isRegression = /^regression/.test(runArg || '');
const run = runArg || fs.readdirSync(DIR).filter((f) => f.startsWith('run-')).sort().pop();
const RUN = path.join(DIR, run);
const r = JSON.parse(fs.readFileSync(path.join(RUN, 'results.json'), 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const scen = { R1: 'R1. Individual engineer counter offer -> Tech Domain accepts', R2: 'R2. Vendor counters for a member engineer -> Tech Domain accepts', R3: 'R3. "Disable counter offers" work order: plain Request path', A: 'A. Happy path + full lifecycle calculation (HOURLY)', B: 'B. Customer declines', C: 'C. Tech Domain edits, then withdraws', D: 'D. Several Tech Domain users counter the same work order', E: 'E. Negative, edge and boundary cases', F: 'F. FIXED payment type', G: 'G. Customer notification' };
const groups = {};
for (const c of r.checks) { const k = c.id.split('-')[0]; (groups[k] = groups[k] || []).push(c); }
const total = r.checks.filter((c) => !c.info).length, pass = r.checks.filter((c) => !c.info && c.ok).length, fail = r.checks.filter((c) => !c.ok && !c.blocked).length, blockedN = r.checks.filter((c) => c.blocked).length;
const verdict = fail === 0 && blockedN === 0 ? 'PASS' : blockedN > 0 ? 'FAIL (customer side blocked)' : fail <= 3 ? 'PASS WITH FINDINGS' : 'FAIL';
const img = (f) => { const p = path.join(RUN, f); return fs.existsSync(p) ? `<img src="file:///${p.replace(/\\/g, '/')}" style="max-width:100%;border:1px solid #ddd;margin:4px 0">` : ''; };
const st = (c) => c.info ? 'INFO' : c.blocked ? 'BLOCKED' : c.ok ? 'PASS' : 'FAIL';
const rows = (list) => list.map((c) => `<tr class="${st(c).toLowerCase()}"><td>${esc(c.id)}</td><td>${esc(c.type)}</td><td>${esc(c.title)}${c.note ? `<br><i class="small">${esc(c.note)}</i>` : ''}</td><td class="small">${esc(c.expected)}</td><td class="small">${esc(c.actual)}</td><td><b>${st(c)}</b></td></tr>`).join('');
const wos = Object.entries(r.workOrders || {}).map(([k, w]) => `<li><b>${k}</b>: WO ${w.id} (#${w.ref}) – ${esc(w.title)}</li>`).join('');
const shots = fs.readdirSync(RUN).filter((f) => f.endsWith('.png')).sort();
const html = `<!doctype html><html><head><meta charset="utf-8"><title>TD-111 Verification Report</title><style>
body{font-family:Segoe UI,Arial,sans-serif;font-size:11px;color:#222;margin:0 10px}h1{font-size:20px;margin:8px 0}h2{font-size:15px;margin:18px 0 6px;border-bottom:1px solid #ccc}h3{font-size:12px;margin:10px 0 4px}
table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #ccc;padding:3px 5px;vertical-align:top;text-align:left}th{background:#eef}tr.pass td:last-child{color:#0a7a2f}tr.fail td:last-child{color:#b00020}tr.fail{background:#fff3f3}tr.blocked{background:#fff8e6}tr.blocked td:last-child{color:#b36b00}tr.info td:last-child{color:#555}.small{font-size:9.5px;word-break:break-word;max-width:260px}
.verdict{display:inline-block;padding:4px 10px;border-radius:4px;color:#fff;background:${fail === 0 && blockedN === 0 ? '#0a7a2f' : blockedN > 0 || fail > 3 ? '#b00020' : '#c77700'};font-weight:bold}.shot{page-break-inside:avoid;margin-bottom:10px}.shot p{margin:2px 0;font-weight:bold}
</style></head><body>
<h1>TD-111 – ${isRegression ? 'Regression: existing engineer-side counter offer still works' : 'Counter offer from Tech Domain to the customer'}</h1>
<p>Ticket: https://techdomain.atlassian.net/browse/TD-111 · Environment: ${esc(r.env.ui)} (frontend build main.16fe721c.js, deployed 2026-10-14) · Run: ${esc(r.run)} · ${esc(r.date)}</p>
<p><span class="verdict">${verdict}</span> &nbsp; ${pass} of ${total} checks passed, ${fail} failed, ${blockedN} blocked (could not be executed because an earlier step is broken), ${r.checks.filter((c) => c.info).length} informational observations.</p>
${(r.summaryNotes || []).map((n) => `<p>${esc(n)}</p>`).join('')}
<h2>What was tested (in plain words)</h2>
<p>A customer creates a work order and submits it to Tech Domain. Tech Domain opens it and can send a <b>Counter Offer</b> with different rates and extra expenses. The customer sees it under a new <b>Proposals</b> tab and can <b>Accept</b> or <b>Decline</b>. If accepted, the work order carries on with the accepted rates and expenses, and every later amount (Payment tab, estimated payment, completion totals) is calculated from them. Tech Domain can also <b>Edit</b> or <b>Withdraw</b> a pending counter offer. When several Tech Domain users send counter offers, the latest one replaces the earlier one and the customer only answers the latest; after acceptance nobody can counter any more. All actions were performed through the web UI with a screenshot per step; the API was used only to create the test work orders, to move the engineer through the job and to read back the calculated amounts.</p>
<ul>${wos}</ul>
${Object.keys(groups).sort().map((k) => `<h2>${esc(scen[k] || k)}</h2><table><tr><th>ID</th><th>Type</th><th>Check</th><th>Expected</th><th>Actual</th><th>Result</th></tr>${rows(groups[k])}</table>`).join('')}
<h2>Findings</h2>${fail ? `<ol>${r.checks.filter((c) => !c.ok).map((c) => `<li><b>${esc(c.id)}</b> ${esc(c.title)}<br><span class="small">expected: ${esc(c.expected)}<br>actual: ${esc(c.actual)}</span></li>`).join('')}</ol>` : '<p>No failed checks.</p>'}
<h2>Screenshots (${shots.length})</h2>
${shots.map((f) => `<div class="shot"><p>${esc(f)}</p>${img(f)}</div>`).join('')}
</body></html>`;
const htmlPath = path.join(RUN, 'report.html'); fs.writeFileSync(htmlPath, html);
console.log(`html: ${htmlPath}  verdict=${verdict} pass=${pass}/${total} fail=${fail}`);
(async () => {
  const { chromium } = require('@playwright/test');
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file:///' + htmlPath.replace(/\\/g, '/')); await p.waitForTimeout(1500);
  const pdfPath = path.join(os.homedir(), 'Downloads', OUT_NAME);
  await p.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' }, displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#777">TD-111 verification report · page <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  await b.close(); console.log(`pdf: ${pdfPath}`);
})();
