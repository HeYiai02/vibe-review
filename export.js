/* 衍生导出：同一份 data.json → metrics.json / Markdown 摘要 / 分享卡 HTML
   用法：node export.js <data.json> [outdir]
   只做确定性的事：所有数字来自 data，叙事文案只从 data 里已有的字段取，不在这里编。 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
if (!SRC) { console.error('usage: node export.js <data.json> [outdir]'); process.exit(1); }
const D = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const OUT = process.argv[3] || path.dirname(SRC);
fs.mkdirSync(OUT, { recursive: true });
const NAME = (D.meta && D.meta.project) || 'project';

const COPY = require('./copy.js');
const nf = COPY.nf;
const redact = COPY.redact;
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const dayOf = ts => String(ts || '').slice(0, 10);

/* 注入进对话的系统提示不是用户说的话：截断掉 */
const CUTS = ['Current runtime context.', 'Time sampled while preparing', '<system-reminder>',
  '[Compressed conversation section]', 'This is an automatically generated checkpoint',
  '<compacted-summary>', 'The approval policy changed'];
const clean = s => {
  let t = String(s || '');
  for (const c of CUTS) { const i = t.indexOf(c); if (i >= 0) t = t.slice(0, i); }
  return t.trim();
};
const brief = (s, n) => COPY.brief(redact(clean(s)), n);
/* 标题优先用人工写的那句；没有就把首轮原话脱敏后再用 */
const SAFE_TITLE = (() => {
  const sub = (D.meta && D.meta.subtitle) || '';
  const raw = String((D.meta && D.meta.title) || '');
  if (sub && sub.length > 4) return sub;
  if (raw.length > 4 && !/https?:|密码|账号/.test(raw)) return raw;
  return NAME;
})();

/* ---------- 1. metrics.json：机器可读，只有实测 ---------- */
const toolRank = Object.entries(D.toolCounts || {}).sort((a, b) => b[1] - a[1]);
const qs = (D.turns || []).map(t => t.q).filter(x => typeof x === 'number').sort((a, b) => a - b);
const med = arr => arr.length ? arr[Math.floor(arr.length / 2)] : 0;

const metrics = {
  schema: 'vibe-review.metrics/1',
  generated: new Date().toISOString(),
  project: {
    name: NAME,
    title: D.meta.subtitle || D.meta.project,
    cwd: D.cwd || '',
    repo: D.projectKey || '',
    source: (D.meta && D.meta.source) || 'dsh',
    sessions: (D.sessions || []).length,
    sessionIds: (D.sessions || []).map(s => s.id),
  },
  span: {
    start: D.totals && D.totals.startTime,
    end: D.totals && D.totals.endTime,
    activeDays: (D.days || []).filter(d => d.tools > 0).length,
    calendarDays: (D.days || []).length,
  },
  turns: {
    count: (D.turns || []).length,
    withUserText: (D.turns || []).filter(t => t.user).length,
    totalMinutes: (D.turns || []).reduce((a, t) => a + (t.dur || 0), 0),
    longestMinutes: Math.max(0, ...(D.turns || []).map(t => t.dur || 0)),
    quality: { min: qs[0] || 0, median: med(qs), max: qs[qs.length - 1] || 0 },
  },
  tools: {
    calls: D.totals && D.totals.tools,
    errors: D.totals && D.totals.errors,
    errorRate: D.totals && D.totals.tools ? +(D.totals.errors / D.totals.tools * 100).toFixed(2) : 0,
    distinct: toolRank.length,
    top: toolRank.slice(0, 12).map(([name, n]) => ({ name, calls: n })),
  },
  files: { touched: D.totals && D.totals.files },
  tokens: {
    input: D.totals && D.totals.tokens && D.totals.tokens.in,
    output: D.totals && D.totals.tokens && D.totals.tokens.out,
    cacheRead: D.totals && D.totals.tokens && D.totals.tokens.cacheR,
  },
  human: D.style ? {
    messages: D.style.humanMessages,
    avgChars: D.style.avgLen,
    medianChars: D.style.medianLen,
    maxChars: D.style.maxLen,
    questionRatio: +(D.style.questionRatio * 100).toFixed(0),
    nightRatio: +(D.style.nightRatio * 100).toFixed(0),
    redirects: D.style.redirects,
  } : null,
  decisions: {
    count: (D.decisions || []).length,
    titled: (D.decisions || []).filter(d => d.title).length,
    turns: (D.decisions || []).map(d => d.turn),
    // cfKind 是「这条对照是日志里的事实，还是推演」。机器读的时候必须能过滤掉推演，
    // 否则把「若当时…」当实测数字二次创作。
    inferTurns: (D.decisions || []).filter(d => d.cfKind === 'infer').map(d => d.turn),
  },
  rework: D.rework ? {
    episodes: D.rework.totals.episodes,
    turns: D.rework.totals.turns,
    minutes: D.rework.totals.minutes,
    errors: D.rework.totals.errors,
    shareTurns: D.rework.totals.shareTurns,
    shareMinutes: D.rework.totals.shareMinutes,
    cases: (D.rework.cases || []).map(c => ({ id: c.id, title: c.name || c.title, kind: c.tag || c.kind, turns: c.turns })),
  } : null,
  rules: { count: (D.rules || []).length, ids: (D.rules || []).map(r => r.id) },
  days: (D.days || []).map(d => ({ date: d.d, calls: d.tools, turns: d.turns })),
};

fs.writeFileSync(path.join(OUT, NAME + '.metrics.json'), JSON.stringify(metrics, null, 2));

/* ---------- 2. Markdown 摘要：给 README / 博客 / issue ---------- */
const T = D.turns || [];
// 只拿「真有用户原话」的轮次排最好/最差：注入消息（approval policy changed 之类）会污染评分
const said = T.filter(t => brief(t.user, 100));
const topQ = said.slice().sort((a, b) => b.q - a.q).slice(0, 3);
const lowQ = said.slice().sort((a, b) => a.q - b.q).slice(0, 3);
const md = [];
const P = s => md.push(s);

P(`# ${SAFE_TITLE}`);
P('');
if (D.meta.subtitle && D.meta.subtitle !== SAFE_TITLE) { P(`> ${D.meta.subtitle}`); P(''); }
P(`${nf(D.totals.turns)} 轮对话 · ${nf(D.totals.tools)} 次工具调用 · ${nf(D.totals.errors)} 次报错 · `
  + `${(D.days || []).filter(d => d.tools > 0).length} 个活跃日 · ${(D.sessions || []).length} 个会话`);
P('');
P('> 数字由脚本从会话日志算出；叙事部分读原话写成。推测内容在页面里单独标注。');
P('');

P('## 数字');
P('');
P('| 项目 | 值 |');
P('|---|---|');
P(`| 轮次 | ${nf(D.totals.turns)} |`);
P(`| 工具调用 | ${nf(D.totals.tools)} |`);
P(`| 报错 | ${nf(D.totals.errors)}（占 ${pct(D.totals.errors, D.totals.tools)}%）|`);
P(`| 改动文件 | ${nf(D.totals.files)} |`);
P(`| 输出 token | ${(D.totals.tokens.out / 1e6).toFixed(1)}M |`);
if (D.style) P(`| 你说的话 | ${nf(D.style.humanMessages)} 条，中位数 ${D.style.medianLen} 字 |`);
P('');

const t0 = T[0];
if (t0) {
  P('## 起手式');
  P('');
  P(COPY.startLede(D));
  P('');
  P('第 1 轮原话：`' + brief(t0.user, 78) + '`');
  P('');
}

if (topQ.length) {
  P('## 最好的三轮');
  P('');
  topQ.forEach(t => P('- **T' + t.n + '**（质量分 ' + t.q + '，' + t.tools + ' 次工具）— ' + brief(t.user, 60)));
  P('');
}
if (lowQ.length) {
  P('## 最差的三轮');
  P('');
  lowQ.forEach(t => P('- **T' + t.n + '**（质量分 ' + t.q + '，' + t.err + ' 次报错）— ' + brief(t.user, 60)));
  P('');
}

const dec = (D.decisions || []).filter(d => d.title);
if (dec.length) {
  const nInf = dec.filter(d => d.cfKind === 'infer').length;
  P('## ' + dec.length + ' 个岔路口');
  P('');
  if (nInf) P('> 标 † 的决策对比是**推演**：另一条路没有真的发生过，结论是从后面的数据倒推的。共 ' + nInf + ' 条。');
  if (nInf) P('');
  P('| 轮次 | 当时的分歧 | 你怎么选 |');
  P('|---|---|---|');
  dec.forEach(d => {
    P('| T' + d.turn + (d.cfKind === 'infer' ? ' †' : '') + ' | ' + brief(d.aiSide || d.ai, 78).replace(/\|/g, '/')
      + ' | ' + brief(d.choice, 78).replace(/\|/g, '/') + ' |');
  });
  P('');
}

if (D.rework && D.rework.totals) {
  const rw = D.rework.totals;
  P('## 返工');
  P('');
  P(`${rw.episodes} 段真返工，${rw.turns} 轮，${rw.minutes} 分钟（占操作时间 ${rw.shareMinutes}%），${rw.errors} 次报错。`);
  P('');
  (D.rework.cases || []).forEach(c => {
    P('### ' + c.id + '｜' + (c.name || c.title || ''));
    P('');
    P('- 轮次：' + ((c.turns || []).map(n => 'T' + n).join('、') || '—'));
    if (c.tag) P('- 类型：' + c.tag);
    P('- 为什么来回：' + (c.cause || c.why || ''));
    P('- 下次这么用：' + (c.fix || c.next || ''));
    P('');
  });
}

if ((D.rules || []).length) {
  P('## 你的规则库');
  P('');
  D.rules.forEach(r => P(`- **${r.title}**：${r.rule}`));
  P('');
}

P('---');
P('');
P(`由 vibe-review 生成 · ${dayOf(metrics.generated)}`);

fs.writeFileSync(path.join(OUT, NAME + '.md'), md.join('\n'));

/* ---------- 3. 分享卡：两种尺寸，各一个文件，方便直接截图 ---------- */
function fillDays(D) {
  const have = new Map((D.days || []).map(x => [x.d, x]));
  if (!have.size) return [];
  const keys = [...have.keys()].sort();
  const s = new Date(keys[0] + 'T00:00:00'), e = new Date(keys[keys.length - 1] + 'T00:00:00');
  const out = [];
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    out.push(have.get(k) || { d: k, tools: 0, turns: 0 });
  }
  return out;
}
function toDate(v) {
  if (v == null || v === '') return new Date(0);
  if (typeof v === 'number') return new Date(v < 1e11 ? v * 1000 : v);
  return new Date(v);
}
const dA = (D.turns && D.turns.length) ? toDate(D.turns[0].ts) : toDate((D.days || [])[0] ? (D.days || [])[0].d : 0);
const dB = (D.turns && D.turns.length) ? toDate(D.turns[D.turns.length - 1].ts) : dA;
const spanDays = Math.max(1, Math.round((dB - dA) / 86400000) + 1);
const fmtD = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
const hero = {
  title: D.meta.subtitle || D.meta.project,
  sub: `${spanDays} 天 · ${(D.days || []).length} 个活跃日`,
  // 日期区间由下方时间条的两个端点承担，副标题不重复它
  // 大海报放「输出 token」而不是「工具调用次数」：不同 agent 的工具名和粒度差异很大，
  // token 是各家统一的计量单位，跨项目比「工程规模」时更可比。
  big: (D.totals.tokens.out >= 1e6
    ? (D.totals.tokens.out / 1e6).toFixed(1) + 'M'
    : Math.round(D.totals.tokens.out / 1e3) + 'K'),
  bigLabel: '输出 token',
  stats: [
    [nf(D.totals.turns), '轮对话'],
    [nf(D.totals.files), '个文件被改'],
    [nf(D.totals.tools), '次工具调用'],
  ],
  lines: topQ.slice(0, 3).map(t => 'T' + t.n + ' · 质量分 ' + t.q + ' · ' + brief(t.user, 34) + '…'),
  foot: NAME,
  days: fillDays(D),
  maxDay: D.maxDay || Math.max(1, ...(D.days || []).map(d => d.tools)),
  firstDay: (D.days || [])[0] ? (D.days || [])[0].d : '',
  lastDay: (D.days || []).length ? (D.days || [])[(D.days || []).length - 1].d : '',
};
const cardCSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{background:#08080c;color:#e8e9f0;font-family:"HarmonyOS Sans SC","Noto Sans SC","Microsoft YaHei",-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased}
.card{position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between}
.card:before{content:"";position:absolute;left:-20%;top:-30%;width:80%;height:70%;
  background:radial-gradient(circle,rgba(124,92,255,.28),transparent 68%);filter:blur(30px)}
.k{font-size:13px;letter-spacing:.22em;color:#8b87b8;text-transform:uppercase}
h1{font-size:64px;line-height:1.06;letter-spacing:-.02em;
  background:linear-gradient(100deg,#fff 20%,#a99bff 70%,#6d5cff);-webkit-background-clip:text;
  -webkit-text-fill-color:transparent;background-clip:text}
.sub{margin-top:14px;font-size:17px;color:#9aa0b5}
.big{font-size:120px;font-weight:700;line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.bl{font-size:15px;color:#8b87b8;margin-top:6px}
.row{display:flex;gap:44px}
.row div{font-size:15px;color:#9aa0b5}
.row b{display:block;font-size:34px;color:#fff;font-variant-numeric:tabular-nums;margin-bottom:4px}
.lines{font-size:15px;color:#b9bccd;line-height:1.85}
.lines i{color:#7c5cff;font-style:normal;margin-right:8px}
.foot{font-size:13px;color:#5d5f78;letter-spacing:.1em}
.strip{display:flex;align-items:flex-end;gap:5px;height:150px;margin-top:44px;overflow:hidden}
.strip i{flex:1 1 0;min-width:0;border-radius:4px 4px 0 0;background:linear-gradient(180deg,#8f7bff,#4b3bd6);opacity:.85;min-height:3px}
.strip i.z{background:#23243a;opacity:1}
.axis{display:flex;justify-content:space-between;font-size:12px;color:#54566e;margin-top:10px;letter-spacing:.06em}
.bw{margin:0}
.bot{margin-top:28px}
`;
const strip = `<div class="strip">`
  + hero.days.map(d => `<i class="${d.tools ? '' : 'z'}" style="height:${Math.max(3, Math.round(d.tools / hero.maxDay * 100))}%" title="${d.d} · ${d.tools} 次"></i>`).join('')
  + `</div><div class="axis"><span>${hero.firstDay}</span><span>${hero.lastDay}</span></div>`;
const layoutH = `
.card.h{flex-direction:row;gap:56px;align-items:stretch}
.h .left{flex:1.25;display:flex;flex-direction:column;justify-content:center}
.h .right{flex:1;display:flex;flex-direction:column;justify-content:center;gap:30px}
.h .big{margin-top:54px}
`;
function cardHTML(w, h, vertical) {
  const n = hero.title.length;
  const titleSize = vertical ? (n > 20 ? 48 : n > 16 ? 54 : n > 12 ? 60 : 68) : (n > 20 ? 40 : n > 16 ? 44 : n > 12 ? 50 : 56);
  if (!vertical) {
    // 横版：数字当作图形元素，从底边出画（bleed），左列只留标题与副标题。
    // 之前在左列里竖着堆到 62% 就结束，下缘 38% 全是黑的，发到 16:9 的渠道像没做完。
    return `<!doctype html><meta charset="utf-8"><style>${cardCSS}${layoutH}
.card{width:${w}px;height:${h}px;padding:64px 72px 0}
h1{font-size:${titleSize - 10}px}
.left{padding-bottom:0;justify-content:flex-start}
.left .k{margin-bottom:18px}
.card.h{position:relative}
.num{position:absolute;left:72px;bottom:34px;z-index:1}
.num b{display:block;font-size:196px;line-height:.92;letter-spacing:-.05em;color:#fff;font-weight:700}
.num span{display:block;font-size:13px;letter-spacing:.16em;color:#8b8fb0;margin-bottom:2px}
.right{justify-content:center}
</style>
<div class="card h">
  <div class="left">
    <div class="k">Project Review</div>
    <h1 style="margin-top:18px">${hero.title}</h1>
    <div class="sub">${hero.sub}</div>
  </div>
  <div class="num"><span>${hero.bigLabel}</span><b>${hero.big}</b></div>
  <div class="right">
    <div class="row">${hero.stats.map(([a, b]) => `<div><b>${a}</b>${b}</div>`).join('')}</div>
    <div class="lines">${hero.lines.map(l => `<div><i>·</i>${l}</div>`).join('')}</div>
    <div class="foot">${hero.foot}</div>
  </div>
</div>`;
  }
  return `<!doctype html><meta charset="utf-8"><style>${cardCSS}
.card{width:${w}px;height:${h}px;padding:${vertical ? '90px 80px' : '64px 72px'}}
h1{font-size:${titleSize}px}
.strip{height:${vertical ? 250 : 0}px}
.big{font-size:196px}
.row b{font-size:${vertical ? 40 : 32}px}

</style>
<div class="card">
  <div>
    <div class="k">Project Review</div>
    <h1 style="margin-top:${vertical ? 26 : 18}px">${hero.title}</h1>
    <div class="sub">${hero.sub}</div>
    ${vertical ? strip : ''}
  </div>
  <div class="bw">
    <div class="big">${hero.big}</div>
    <div class="bl">${hero.bigLabel}</div>
  </div>
  <div class="bot">
    <div class="row" style="margin-bottom:${vertical ? 40 : 26}px">
      ${hero.stats.map(([a, b]) => `<div><b>${a}</b>${b}</div>`).join('')}
    </div>
    <div class="lines">${hero.lines.map(l => `<div><i>·</i>${l}</div>`).join('')}</div>
  </div>
  <div class="foot">${hero.foot}</div>
</div>`;
}
fs.writeFileSync(path.join(OUT, NAME + '-card-v.html'), cardHTML(1200, 1600, true));
fs.writeFileSync(path.join(OUT, NAME + '-card-h.html'), cardHTML(1600, 900, false));

console.log('wrote', [
  NAME + '.metrics.json',
  NAME + '.md',
  NAME + '-card-v.html',
  NAME + '-card-h.html',
].join(' | '));
