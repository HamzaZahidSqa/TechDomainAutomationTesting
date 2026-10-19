// node scripts/compare-chat-runs.js "<run name>=<results dir>" [...]
// Prints a markdown table of the key chat / notification / HTTP latencies from each run's summary.json
// (written by scripts/Run-ChatLoad.ps1) and saves it to evidence/Chat-Load-JMeter/comparison-table.md.
const fs = require('fs');
const path = require('path');

const runs = process.argv.slice(2).map((arg) => {
  const [name, dir] = arg.split('=');
  const raw = fs.readFileSync(path.join(dir, 'summary.json'), 'utf8').replace(/^﻿/, '');
  const json = JSON.parse(raw);
  const list = Array.isArray(json) ? json : [json];
  return { name, dir, S: Object.fromEntries(list.map((r) => [r.label, r])) };
});

const rows = [
  ['message round-trip (sender echo)', 'Message send to own echo (Tech Domain sender)'],
  ['notification delivered (customer)', 'Notification event at customer (socket)'],
  ['inbox unread-count update (customer)', 'Inbox unread-count push at customer'],
  ['sender ws open', 'New chat socket connect (TLS + upgrade)'],
  ['user GET /inbox', 'HTTP GET /inbox'],
  ['user GET /notifications', 'HTTP GET /notifications'],
  ['user GET /users/me', 'HTTP GET /users/me'],
];

let out = '| Metric | Run | Samples | Errors | p50 ms | p90 ms | p95 ms | max ms |\n|---|---|---|---|---|---|---|---|\n';
for (const [key, title] of rows) {
  for (const r of runs) {
    const x = r.S[key];
    if (!x) continue;
    out += `| ${title} | ${r.name} | ${x.count} | ${x.errors} | ${x.p50} | ${x.p90} | ${x.p95} | ${x.max} |\n`;
  }
}
const outDir = path.join(__dirname, '..', 'evidence', 'Chat-Load-JMeter');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'comparison-table.md'), out);
process.stdout.write(out);
