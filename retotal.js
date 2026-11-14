/* 修口径：把已有 data_*.json 的返工统计从「墙钟 span / Σdur」改为「Σdur / Σdur」，
   并补 totals.durSum、cfKind、给 aiSide 等字段补脱敏。用法：
     node retotal.js data.json [data2.json ...]
*/
const fs = require('fs');
const path = require('path');
const COPY = require('./copy.js');

const HEDGE = /^(若|如果|假如|要是|换作)|推断|推测/;
function cfKindOf(cf, explicit) {
  if (explicit === 'fact' || explicit === 'infer') return explicit;
  return HEDGE.test(String(cf || '')) ? 'infer' : 'fact';
}

function redacted(s) { return COPY.redact(s); }

for (const file of process.argv.slice(2)) {
  const p = path.resolve(file);
  const D = JSON.parse(fs.readFileSync(p, 'utf8'));
  const T = D.turns || [];
  const byN = new Map(T.map(t => [t.n, t]));
  const durSum = T.reduce((a, t) => a + (t.dur || 0), 0);
  D.totals = D.totals || {};
  D.totals.durSum = durSum;

  let changed = 0;
  if (D.rework && Array.isArray(D.rework.cases)) {
    const all = D.rework.contrast ? D.rework.cases.concat([D.rework.contrast]) : D.rework.cases;
    for (const c of all) {
      const ts = (c.turns || []).map(n => byN.get(n)).filter(Boolean);
      if (!ts.length) continue;
      const start = Math.min(...ts.map(t => new Date(t.ts).getTime()));
      const end = Math.max(...ts.map(t => new Date(t.ts).getTime() + (t.dur || 0) * 60000));
      c.n = c.turns.length;
      c.spanMin = Math.max(1, Math.round((end - start) / 60000));
      c.activeMin = ts.reduce((a, t) => a + (t.dur || 0), 0);
      c.errors = ts.reduce((a, t) => a + (t.err || 0), 0);
      changed++;
    }
    const real = D.rework.cases;
    const minutes = real.reduce((a, c) => a + (c.activeMin || 0), 0);
    const turnsN = real.reduce((a, c) => a + c.n, 0);
    const errors = real.reduce((a, c) => a + (c.errors || 0), 0);
    D.rework.totals = {
      episodes: real.length,
      turns: turnsN,
      minutes,
      errors,
      shareTurns: +((turnsN / Math.max(1, T.length)) * 100).toFixed(1),
      shareMinutes: +((minutes / Math.max(1, durSum)) * 100).toFixed(1),
      shareErrors: +((errors / Math.max(1, D.totals.errors || 1)) * 100).toFixed(0),
    };
  }

  // 脱敏：AI 侧建议、决策、返工引语都要过一遍
  for (const t of T) { t.user = redacted(t.user); t.ai = redacted(t.ai); }
  for (const d of (D.decisions || [])) {
    d.prev = redacted(d.prev); d.ai = redacted(d.ai); d.aiSide = redacted(d.aiSide);
    d.choice = redacted(d.choice); d.cf = redacted(d.cf);
    d.cfKind = cfKindOf(d.cf);   // 旧数据里没有「显式声明」的痕迹，一律按措辞重判
  }
  if (D.rework) {
    for (const c of (D.rework.cases || []).concat(D.rework.contrast ? [D.rework.contrast] : [])) {
      c.cause = redacted(c.cause); c.fix = redacted(c.fix);
      for (const q of (c.quotes || [])) q.text = redacted(q.text);
    }
  }

  fs.writeFileSync(p, JSON.stringify(D));
  console.log(`${path.basename(p)}: durSum=${durSum}min cases=${changed} ` +
    (D.rework ? `rework=${D.rework.totals.minutes}min(${D.rework.totals.shareMinutes}%)` : 'rework=-'));
}
