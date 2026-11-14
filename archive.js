/* L2 跨项目档案：读多份 data*.json，输出一页 archive.html
   用法：node archive.js [out.html]            （默认读同目录 data*.json）
        node archive.js out.html a.json b.json */
const fs = require('fs');
const path = require('path');
const P = __dirname;

const args = process.argv.slice(2);
const outArg = args[0] && /\.html$/i.test(args[0]) ? args.shift() : 'archive.html';
const files = args.length ? args : fs.readdirSync(P).filter(f => /^data.*\.json$/.test(f)).sort();

const nf = n => Number(n).toLocaleString('en-US');
const toDate = v => {
  if (v == null || v === '') return new Date(0);
  if (typeof v === 'number') return new Date(v < 1e11 ? v * 1000 : v);
  return new Date(v);
};
const d = s => {
  const x = toDate(s);
  const p2 = n => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`;
};
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const redact = s => String(s || '')
  .replace(/(密码|口令|password|passwd|pwd)\s*[:：]?\s*[^\s，,。；;）)]+/gi, '$1 ***')
  .replace(/(账号|account)\s*[:：]?\s*[A-Za-z0-9_]{3,}/gi, '$1 ***')
  .replace(/https?:\/\/[^\s，,。；;]+/g, '（站点）')
  .replace(/\s+/g, ' ').trim();

const projects = files.map(f => {
  const D = JSON.parse(fs.readFileSync(path.join(P, f), 'utf8'));
  const T = D.turns || [];
  const days = D.days || [];
  const maxDay = Math.max(1, ...days.map(x => x.tools));
  const start = T.length ? T[0].ts : (days[0] && days[0].d) || '';
  const end = T.length ? T[T.length - 1].ts : (days.length && days[days.length - 1].d) || '';
  return {
    file: f,
    name: D.meta.project,
    sub: redact(D.meta.subtitle || '').slice(0, 46),
    start, end,
    span: Math.max(1, Math.round((toDate(end) - toDate(start)) / 86400000) + 1),
    turns: D.totals.turns, tools: D.totals.tools, errors: D.totals.errors,
    files: D.totals.files, tokens: D.totals.tokens,
    sources: (D.sessions || []).length,
    days: days.map(x => ({ d: x.d, tools: x.tools })),
    maxDay,
    rules: (D.rules || []).map(r => ({ id: r.id, title: r.title, rule: r.rule, ev: r.ev })),
    topRework: (D.rework && D.rework.cases && D.rework.cases[0]) || null,
    firstLede: redact((T[0] && T[0].user) || '').slice(0, 90),
  };
});

projects.sort((a, b) => toDate(a.start) - toDate(b.start));

const tot = projects.reduce((a, p) => ({
  turns: a.turns + p.turns, tools: a.tools + p.tools, errors: a.errors + p.errors,
  files: a.files + p.files, out: a.out + (p.tokens.out || 0),
}), { turns: 0, tools: 0, errors: 0, files: 0, out: 0 });

const t0 = toDate(projects[0].start).getTime();
const t1 = Math.max(...projects.map(p => toDate(p.end).getTime()));
const spanAll = Math.max(1, Math.round((t1 - t0) / 86400000) + 1);
const pos = v => 2 + (toDate(v).getTime() - t0) / (t1 - t0) * 96;

/* 规则在几个项目里出现过（按标题去重） */
const ruleMap = new Map();
projects.forEach(p => p.rules.forEach(r => {
  const key = r.title;
  if (!ruleMap.has(key)) ruleMap.set(key, { title: key, rule: r.rule, ev: r.ev, who: [] });
  const e = ruleMap.get(key);
  if (!e.who.includes(p.name)) e.who.push(p.name);
}));
const rules = [...ruleMap.values()].sort((a, b) => b.who.length - a.who.length);

const strip = p => `<div class="strip">${p.days.map(x =>
  `<i class="${x.tools ? '' : 'z'}" style="height:${Math.max(3, Math.round(x.tools / p.maxDay * 100))}%" title="${x.d} · ${x.tools}"></i>`).join('')}</div>`;

const card = p => `<div class="pc">
  <div class="pc-h"><b>${esc(p.name)}</b><a class="pc-l" href="${esc(p.name)}-review.html">打开报告 →</a></div>
  <div class="pc-s">${esc(p.sub)}</div>
  <div class="pc-d">${d(p.start)} → ${d(p.end)} · ${p.span} 天 · ${p.sources} 个会话</div>
  ${strip(p)}
  <div class="pc-n">
    <div><b>${p.turns}</b>轮</div>
    <div><b>${nf(p.tools)}</b>次工具</div>
    <div><b>${p.files}</b>个文件</div>
    <div><b>${p.errors}</b>次报错</div>
    <div><b>${(p.tokens.out / 1e6).toFixed(1)}M</b>输出</div>
  </div>
  <div class="pc-q">第 1 句：${esc(p.firstLede)}…</div>
</div>`;

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>跨项目档案 · ${projects.length} 个项目</title>
<style>
:root{--bg:#0a0b10;--card:#12141c;--card2:#171a24;--line:#232736;--txt:#e8eaf2;--dim:#8b91a6;--dim2:#5f6478;--accent:#7c5cff;--cyan:#2dd4ee;--good:#34d399;--warn:#f5a524;--bad:#f4666a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.75 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;
  background-image:radial-gradient(1000px 520px at 12% -8%,rgba(124,92,255,.20),transparent 62%),radial-gradient(760px 420px at 96% 2%,rgba(45,212,238,.10),transparent 58%);
  background-repeat:no-repeat}
.wrap{max-width:1120px;margin:0 auto;padding:80px 40px 120px}
.kicker{font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:var(--dim2)}
h1{font-size:56px;line-height:1.08;letter-spacing:-.02em;margin:18px 0 14px;font-weight:800}
h1 em{font-style:normal;background:linear-gradient(96deg,#a08cff,#6ee7ff 62%);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:var(--dim);font-size:14px}
.sub b{color:var(--txt);font-weight:600}
.kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px;margin:36px 0 8px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.kpi b{display:block;font-size:30px;letter-spacing:-.02em}
.kpi span{font-size:11.5px;color:var(--dim)}
h2{font-size:22px;margin:64px 0 6px;letter-spacing:-.01em}
h2 .idx{font-size:11px;color:var(--accent);letter-spacing:.2em;margin-right:10px;font-weight:600}
.lede{color:var(--dim);font-size:13.5px;margin:0 0 22px}
.pgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
.pc{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px}
.pc-h{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.pc-h b{font-size:17px}
.pc-l{font-size:11.5px;color:var(--accent);text-decoration:none;border-bottom:1px solid transparent;transition:.18s;white-space:nowrap}
.pc-l:hover{border-bottom-color:var(--accent)}
.pc-s{font-size:11.5px;color:var(--dim);margin-top:4px}
.pc-d{font-size:11px;color:var(--dim2);margin-top:10px;letter-spacing:.04em}
.strip{display:flex;align-items:flex-end;gap:4px;height:56px;margin:14px 0 10px}
.strip i{flex:1 1 0;min-width:0;min-height:3px;border-radius:3px 3px 0 0;background:linear-gradient(180deg,#8f7bff,#4b3bd6);opacity:.85}
.strip i.z{background:#22243a;opacity:1}
.pc-n{display:flex;gap:18px;flex-wrap:wrap}
.pc-n div{font-size:11px;color:var(--dim)}
.pc-n b{color:var(--txt);font-size:17px;margin-right:4px}
.pc-q{margin-top:12px;font-size:11.5px;color:var(--dim2);border-top:1px solid var(--line);padding-top:10px}
.tl{position:relative;height:120px;margin:10px 0 0;border:1px solid var(--line);border-radius:12px;background:var(--card);overflow:hidden}
.tl i{position:absolute;height:16px;border-radius:8px;background:linear-gradient(90deg,rgba(124,92,255,.9),rgba(45,212,238,.65));opacity:.85}
.tl b{position:absolute;font-size:10.5px;color:var(--dim);transform:translateX(-50%)}
.tl .ax{position:absolute;left:0;right:0;bottom:8px;display:flex;justify-content:space-between;padding:0 12px;font-size:10.5px;color:var(--dim2)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim2);font-weight:600;padding:0 10px 10px}
td{padding:12px 10px;border-top:1px solid var(--line);vertical-align:top;color:var(--dim)}
td.n{color:var(--txt);font-weight:600;white-space:nowrap}
td.r{color:var(--txt)}
.who i{display:inline-block;font-style:normal;font-size:10px;padding:1px 8px;border:1px solid var(--line);border-radius:999px;margin:2px 4px 2px 0;color:var(--dim)}
.who i.hot{border-color:rgba(124,92,255,.55);color:#c7bfff}
footer{margin-top:70px;padding-top:22px;border-top:1px solid var(--line);font-size:11.5px;color:var(--dim2);display:flex;justify-content:space-between}
</style></head><body><div class="wrap">

<div class="kicker">Vibe Coding · Cross Project Archive</div>
<h1>一个人写过的 <em>${projects.length}</em> 个项目</h1>
<div class="sub"><b>${nf(tot.turns)}</b> 轮对话 · <b>${nf(tot.tools)}</b> 次工具调用 · <b>${nf(tot.files)}</b> 个文件 · <b>${(tot.out / 1e6).toFixed(1)}M</b> 输出 token · 横跨 <b>${spanAll}</b> 天</div>

<div class="kpis">
  <div class="kpi"><b>${projects.length}</b><span>个项目</span></div>
  <div class="kpi"><b>${nf(tot.turns)}</b><span>轮对话</span></div>
  <div class="kpi"><b>${nf(tot.tools)}</b><span>次工具调用</span></div>
  <div class="kpi"><b>${Math.round(tot.errors / tot.tools * 1000) / 10}%</b><span>工具报错率</span></div>
  <div class="kpi"><b>${rules.length}</b><span>条规则被反复验证</span></div>
</div>

<h2><span class="idx">01</span>项目档案</h2>
<p class="lede">每个项目一张卡：多长的工期、多大强度、留了多少文件。柱子是每天的工具调用量。</p>
<div class="pgrid">${projects.map(card).join('')}</div>

<h2><span class="idx">02</span>编年史</h2>
<p class="lede">同一条时间轴上看，哪些项目是并行的、哪些是接力的。</p>
<div class="tl">
  ${projects.map((p, i) => {
    const l = pos(p.start), r = pos(p.end);
    return `<i style="left:${l}%;width:${Math.max(1.2, r - l)}%;top:${14 + i * 22}px"></i>
      <b style="left:${Math.min(88, Math.max(9, (l + r) / 2))}%;top:${32 + i * 22}px">${esc(p.name)}</b>`;
  }).join('')}
  <div class="ax"><span>${d(t0)}</span><span>${d(t1)}</span></div>
</div>

<h2><span class="idx">03</span>你的偏好画像</h2>
<p class="lede">这些规则不是编的：同一条在几个项目里都被日志验证过，才算数。</p>
<table><thead><tr><th>规则</th><th>它到底在说什么</th><th>被验证</th></tr></thead><tbody>
${rules.map(r => `<tr><td class="n">${esc(r.title)}</td><td class="r">${esc(r.rule)}</td>
  <td class="who">${r.who.map(w => `<i class="${r.who.length > 1 ? 'hot' : ''}">${esc(w)}</i>`).join('')}</td></tr>`).join('')}
</tbody></table>

<footer>
  <span>数据源：各项目会话日志 · 指标由确定性脚本计算</span>
  <span>生成于 ${new Date().toISOString().slice(0, 10)}</span>
</footer>
</div></body></html>`;

fs.writeFileSync(path.join(P, outArg), html, 'utf8');
console.log('wrote', path.join(P, outArg), (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB',
  '| projects=' + projects.length, 'rules=' + rules.length);
