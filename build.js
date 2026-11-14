// 把 collect.js 的 project.json 变成 render.js 要的 data.json。
// 缺什么补什么：没有人工整理的叙事块（决策标题 / 返工案例 / 规则库）就留空，
// 页面会自动去掉对应板块——这样换一个项目也能先出一份「只有实测」的报告。
const fs = require('fs');
const path = require('path');
const COPY = require('./copy.js');
// 站点 / 账号 / 密码进了 data.json 就会出现在详情面板、卡片和 Markdown 里，
// 所以在这里统一脱敏一次，而不是等每个产物各自处理。
const clean = s => COPY.redact(s);

const IN = process.argv[2] || path.join(__dirname, 'project.json');
const OUT = process.argv[3] || path.join(__dirname, 'data.json');
const CURATED = process.argv[4] || null;   // 可选：人工整理过的决策/返工/规则
const P = JSON.parse(fs.readFileSync(IN, 'utf8'));
const C = CURATED ? JSON.parse(fs.readFileSync(CURATED, 'utf8')) : {};

const DAY = 86400000;
const dayKey = ms => { const d = new Date(ms); return d.toISOString().slice(0, 10); };

// 每日工具量
const byDay = new Map();
for (const t of P.turns) {
  const k = dayKey(t.start);
  const d = byDay.get(k) || { d: k, tools: 0, turns: 0 };
  d.tools += t.toolCount; d.turns++;
  byDay.set(k, d);
}
const days = [...byDay.values()].sort((a, b) => a.d < b.d ? -1 : 1);
const maxDay = Math.max(1, ...days.map(d => d.tools));

const turns = P.turns.map(t => ({
  n: t.turn, nLocal: t.nLocal, ses: t.ses,
  ts: new Date(t.start).toISOString(),
  dur: t.durMin, steps: t.steps,
  q: t.q, err: t.errCount, tools: t.toolCount, writes: t.writes,
  user: clean(t.user), ai: clean(t.ai), files: t.files || [],
  interrupted: !!t.interrupted, compacted: !!t.compacted, ulen: clean(t.user || '').length,
}));

// 会话区间以最终 turns 为准：采集阶段的 sessionList 可能包含「有会话但没有产出轮次」
// 的情况（比如只有一条被过滤掉的系统消息），那样区间会比我实际渲染的轮次多出一号。
const sesRange = new Map();
for (const t of turns) {
  const r = sesRange.get(t.ses) || { from: t.n, to: t.n, turns: 0 };
  r.from = Math.min(r.from, t.n);
  r.to = Math.max(r.to, t.n);
  r.turns++;
  sesRange.set(t.ses, r);
}
const sessions = (P.meta.sessionList || [])
  .map(s => {
    const r = sesRange.get(s.id);
    return r ? { id: s.id, from: r.from, to: r.to, turns: r.turns, start: s.start, end: s.end, key: s.key || null, roots: s.roots || [] } : null;
  })
  .filter(Boolean);

// 工具名分布（页面用它算「跑的次数 / 改的次数」）
const toolCounts = {};
for (const t of P.turns) for (const c of (t.tools || [])) toolCounts[c.n] = (toolCounts[c.n] || 0) + 1;

// 人工整理的叙事用「会话 id:本会话轮号」锚定，而不是全局轮号——
// 项目每多聊一句，全局号就会整体后移，老锚点会静默指错地方。
const anchor2n = new Map();
for (const t of P.turns) if (t.ses && t.nLocal) anchor2n.set(t.ses + ':' + t.nLocal, t.turn);
const R = x => (typeof x === 'string' && anchor2n.has(x)) ? anchor2n.get(x) : x;
const missing = [];
const R2 = x => { const v = R(x); if (typeof v === 'string') missing.push(v); return typeof v === 'number' ? v : null; };
const decRaw = C.decisions || P.decisions || [];
// cf 的「事实 / 推演」标记。日志里只有一条真实路径，凡是「若走另一条会怎样」都是推演，
// 不能和「据日志算出来的对比」混着展示。显式写了 cfKind 就听；没写就按措辞判断，
// 拿不准一律当推演（宁可标得保守，也不要把推演说成事实）。
const HEDGE = /^(若|如果|假如|要是|换作)|推断|推测/;
function cfKindOf(d) {
  if (d.cfKind === 'fact' || d.cfKind === 'infer') return d.cfKind;
  if (d.cf && typeof d.cf === 'object' && (d.cf.kind === 'fact' || d.cf.kind === 'infer')) return d.cf.kind;
  return HEDGE.test(String(d.cf || '')) ? 'infer' : 'fact';
}
const decisions = decRaw.map(d => Object.assign({}, d, {
  turn: d.at != null ? R2(d.at) : R2(d.turn),
  prev: clean(d.prev), ai: clean(d.ai), aiSide: clean(d.aiSide), choice: clean(d.choice), cf: clean(d.cf),
  cfKind: cfKindOf(d),
}));
const trunk = (C.trunkAt ? C.trunkAt.map(R2) : (C.trunk || P.trunk || []).map(R2)).filter(x => x != null);
let reworkOut = null;
if (C.rework) {
  const cw = JSON.parse(JSON.stringify(C.rework));
  for (const c of (cw.cases || [])) {
    c.cause = clean(c.cause); c.fix = clean(c.fix);
    (c.quotes || []).forEach(q => { q.text = clean(q.text); });
    for (const k of ['prompt', 'repro']) if (c[k]) c[k] = clean(c[k]);
  }
  for (const c of (cw.cases || [])) if (Array.isArray(c.ats)) c.turns = c.ats.map(R2).filter(x => x != null);
  if (cw.contrast && Array.isArray(cw.contrast.ats)) cw.contrast.turns = cw.contrast.ats.map(R2).filter(x => x != null);
  reworkOut = withTotals(cw);
}
if (missing.length) console.warn('WARN 找不到锚点:', missing.join(', '));

const data = {
  meta: {
    project: P.meta.project,
    title: (C.meta && C.meta.subtitle) || P.meta.title,
    subtitle: (C.meta && C.meta.subtitle) || '',
    sessions: P.meta.sessions,
    source: P.meta.source || 'dsh',
    generated: P.meta.generated,
  },
  cwd: P.meta.cwd || '',
  projectKey: P.meta.projectKey || '',
  totals: P.totals,
  style: P.style,
  days, maxDay, sessions,
  toolCounts,
  turns,
  decisions,
  hotspots: (P.hotspots || []).slice(0, 30),
  // 以下需要人工整理（读原话写），没有就留空
  ask: (function () {
    const a = C.ask || P.ask || null; if (!a) return null;
    if (a.at != null) a.turn = R2(a.at);
    a.q = clean(a.q); a.answer = clean(a.answer);
    if (Array.isArray(a.options)) a.options = a.options.map(clean);
    return a;
  })(),
  trunk,
  rework: reworkOut || (P.rework || null),
  rules: (C.rules || P.rules || []).map(r => Object.assign({}, r, { rule: clean(r.rule), why: clean(r.why), ev: clean(r.ev) })),
  styleMd: C.styleMd || P.styleMd || '',
  paths: C.paths || P.paths || {},
};

// 返工案例的 n / spanMin / errors 从轮次里算，不手写。
// 注意两种时间口径不能混：
//   spanMin（墙钟）= 该段首轮到末轮的跨度，含段内空闲，用来写「跨 X 分钟」；
//   minutes（动手）= 该段各轮 dur 之和，只算真正在跑的时间，用来算占比。
// 之前的 bug 就在这里：分子用墙钟、分母用 dur，把 16% 说成了 59%。
function withTotals(rw) {
  const byN = new Map(turns.map(t => [t.n, t]));
  const cases = (rw.cases || []).map(c => {
    const ts = c.turns.map(n => byN.get(n)).filter(Boolean);
    const start = Math.min(...ts.map(t => new Date(t.ts).getTime()));
    const end = Math.max(...ts.map(t => new Date(t.ts).getTime() + (t.dur || 0) * 60000));
    return Object.assign({}, c, {
      n: c.turns.length,
      spanMin: Math.max(1, Math.round((end - start) / 60000)),
      activeMin: ts.reduce((a, t) => a + (t.dur || 0), 0),
      errors: ts.reduce((a, t) => a + (t.err || 0), 0),
    });
  });
  const all = cases.reduce((a, c) => a + c.n, 0);
  const mins = cases.reduce((a, c) => a + c.activeMin, 0);
  const errs = cases.reduce((a, c) => a + c.errors, 0);
  const totalMin = turns.reduce((a, t) => a + (t.dur || 0), 0);
  const contrast = rw.contrast ? (() => {
    const ts = rw.contrast.turns.map(n => byN.get(n)).filter(Boolean);
    const s0 = Math.min(...ts.map(t => new Date(t.ts).getTime()));
    const s1 = Math.max(...ts.map(t => new Date(t.ts).getTime() + (t.dur || 0) * 60000));
    return Object.assign({}, rw.contrast, {
      n: rw.contrast.turns.length,
      spanMin: Math.max(1, Math.round((s1 - s0) / 60000)),
      errors: ts.reduce((a, t) => a + (t.err || 0), 0),
    });
  })() : null;
  return Object.assign({}, rw, {
    cases,
    contrast,
    totals: {
      episodes: cases.length, turns: all, minutes: mins, errors: errs,
      shareTurns: +(all / Math.max(1, turns.length) * 100).toFixed(1),
      shareMinutes: +(mins / Math.max(1, totalMin) * 100).toFixed(1),
      shareErrors: +(errs / Math.max(1, P.totals.errors) * 100).toFixed(0),
    },
  });
}

fs.writeFileSync(OUT, JSON.stringify(data));
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
console.log('days', days.length, 'maxDay', maxDay, 'sessions', sessions.length,
  'turns', turns.length, 'decisions', data.decisions.length,
  'has rework', !!data.rework, 'rules', data.rules.length);
