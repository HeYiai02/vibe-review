/* 生成一个完全虚构的示例项目（demo/project.json），供没装 agent 的人也能跑通流水线。
   刻意不读任何真实日志：所有文本、数字都是这里写死的。
   用法： node demo/make-demo.js
*/
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'project.json');

// 12 轮：两天做完一个很小的订单页；第 6~8 轮是一次「上一版被推翻」的返工
const T = [
  { u: '我想做一个卖手冲咖啡豆的小站，先能下单就行。', a: '先确认三件事：支付走哪家、要不要库存、订单发给谁。这三件定了我再动手，不然会白写。', tools: 3, err: 0, files: [], q: 62, dur: 2 },
  { u: '不接支付，先做货到付款；库存要；订单直接发我邮箱。', a: '那就三张表：豆子、订单、订单行。先做后台录入 + 前台下单两个页面。', tools: 9, err: 0, files: ['db/schema.sql', 'app.js'], q: 74, dur: 6 },
  { u: '豆子列表按烘焙度分组，浅烘、中烘、深烘三栏。', a: '列表改成三栏，数据层加一个 roast 字段，默认中烘。', tools: 6, err: 0, files: ['views/list.js', 'db/schema.sql'], q: 76, dur: 4 },
  { u: '下单页要能选克数：100g / 200g / 500g，价格不一样。', a: '价格改成按克数档位算，避免以后改价要动代码，档位放表里。', tools: 11, err: 1, files: ['views/order.js', 'lib/price.js'], q: 68, dur: 9 },
  { u: '邮箱收不到订单，你本地测过吗？', a: '没测。现在补一个走 SMTP 的发送，并在本地用假 SMTP 跑一遍。', tools: 14, err: 3, files: ['lib/mail.js', 'test/mail.test.js'], q: 41, dur: 13 },
  { u: '订单页太丑了，整个重做。我要左边大图、右边表单，像苹果商店那样。', a: '重写下单页布局：左图右表单，窄屏自动上下堆叠。', tools: 16, err: 4, files: ['views/order.js', 'public/order.css'], q: 38, dur: 17 },
  { u: '不对，我要的是能滚动的长图 + 悬浮加购条，不是两张卡片。', a: '推翻上一版：改成整页长图，底部一条常驻加购条。', tools: 18, err: 2, files: ['views/order.js', 'public/order.css'], q: 30, dur: 21 },
  { u: '加购条挡住了页脚，而且手机上点不到。', a: '加购条改 safe-area 内边距，页脚补 padding，移动端按钮加大到 44px。', tools: 7, err: 1, files: ['public/order.css'], q: 52, dur: 8 },
  { u: '后台加一个订单列表，我要能标记「已发货」。', a: '后台列表 + 状态字段（待发货 / 已发货），标记后前台订单页显示进度。', tools: 12, err: 0, files: ['views/admin.js', 'db/schema.sql'], q: 72, dur: 11 },
  { u: '再给每个豆子加一段产地故事，随便写点。', a: '豆子表加 story 字段，后台可编辑，前台详情页展示。', tools: 6, err: 0, files: ['views/detail.js'], q: 70, dur: 5 },
  { u: '部署到我自己那台小机器上，别用 docker。', a: '写一个 systemd unit + 一个部署脚本（rsync + restart），不用容器。', tools: 10, err: 2, files: ['deploy/shop.service', 'deploy/deploy.sh'], q: 58, dur: 12 },
  { u: '上线了，收到第一单。', a: '好。下一版建议先补「库存扣减」——现在是下单不扣库存，会超卖。', tools: 2, err: 0, files: [], q: 80, dur: 1 },
];

const TOOLNAMES = ['pwsh', 'edit', 'read', 'write', 'grep', 'web_search'];
const start = Date.UTC(2026, 2, 3, 1, 10, 0); // 2026-03-03 09:10 北京时间
const starts = [start, start + 3.2 * 3600e3, start + 26 * 3600e3, start + 30 * 3600e3];
const turns = [];
let t0 = start;
let step = 0;
T.forEach((x, i) => {
  const durMs = x.dur * 60000;
  // 第 8 轮之后隔一天，制造一个「工作段」边界
  if (i === 8) t0 += 30 * 3600e3;
  const ts = t0;
  t0 += durMs + (i % 3) * 90000;
  turns.push({
    turn: i + 1,
    nLocal: i + 1,
    ses: 'demo0001',
    start: ts,
    end: ts + durMs,
    durMin: x.dur,
    dur: x.dur,
    steps: Math.max(1, Math.round(x.tools * 0.7)),
    user: x.u,
    ai: x.a,
    q: x.q,
    errCount: x.err,
    toolCount: x.tools,
    tools: Array.from({ length: x.tools }, (_, k) => ({ n: TOOLNAMES[k % TOOLNAMES.length] })),
    writes: x.files.length,
    files: x.files,
    interrupted: false,
    compacted: false,
  });
  step += Math.max(1, Math.round(x.tools * 0.7));
});

const tools = turns.reduce((a, t) => a + t.toolCount, 0);
const errors = turns.reduce((a, t) => a + t.errCount, 0);
const files = [...new Set(turns.flatMap(t => t.files))];
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
const byDay = new Map();
for (const t of turns) {
  const d = dayOf(t.start);
  const cur = byDay.get(d) || { d, tools: 0, turns: 0 };
  cur.tools += t.toolCount; cur.turns += 1; byDay.set(d, cur);
}

const proj = {
  meta: {
    project: 'demo-shop',
    title: '一个卖手冲咖啡豆的小站',
    source: 'demo',
    sessions: 1,
    sessionList: [{ id: 'demo0001', file: 'demo', from: 1, to: turns.length, turns: turns.length, start: turns[0].start, end: turns[turns.length - 1].end, roots: [], key: null }],
    cwd: 'demo-shop',
    projectKey: null,
    projectMismatch: false,
  },
  totals: {
    turns: turns.length,
    tools,
    errors,
    steps: turns.reduce((a, t) => a + t.steps, 0),
    tokens: { in: 412000, out: 96000, cacheR: 3800000, cacheW: 0 },
    startTime: turns[0].start,
    endTime: turns[turns.length - 1].end,
    files: files.length,
    compactions: 0,
  },
  style: {
    humanMessages: turns.length,
    totalTurns: turns.length,
    avgLen: Math.round(turns.reduce((a, t) => a + t.user.length, 0) / turns.length),
    medianLen: 22,
    maxLen: Math.max(...turns.map(t => t.user.length)),
    questionRatio: 0.25,
    nightRatio: 0,
    redirects: 2,
  },
  days: [...byDay.values()].sort((a, b) => (a.d < b.d ? -1 : 1)),
  turns,
  decisions: [],
  hotspots: [
    { file: 'views/order.js', edits: 5, errors: 6 },
    { file: 'public/order.css', edits: 4, errors: 3 },
    { file: 'db/schema.sql', edits: 3, errors: 1 },
    { file: 'views/admin.js', edits: 2, errors: 0 },
  ],
};

fs.writeFileSync(OUT, JSON.stringify(proj));
console.log('demo/project.json', turns.length, '轮', tools, '次工具', errors, '次报错', files.length, '个文件');
