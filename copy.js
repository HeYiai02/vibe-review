/* 三份产物共用的文案与数字口径：报告 / 分享卡 / Markdown 都从这里取。
   改一句话只改这一处，避免同一句在三个文件里各写一遍、彼此走样。
   句子按 LANG 分叉：中文句子是原文，英文是同一件事的另一种说法（不是直译）。 */

const { LANG } = require('./i18n');
const EN = LANG === 'en';

const CN = ['', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '二十一', '二十二', '二十三', '二十四', '二十五', '二十六', '二十七', '二十八', '二十九', '三十'];

const nf = n => Number(n || 0).toLocaleString('en-US');
const pct = (x, d = 0) => (Number(x || 0) * 100).toFixed(d) + '%';
const dayOf = d => String(d).slice(5);          // 2026-10-30 → 10-30
const tsOf = v => (typeof v === 'number' ? new Date(v) : new Date(v));
const daysOf = D => Math.round((tsOf(D.turns[D.turns.length - 1].ts) - tsOf(D.turns[0].ts)) / 86400000) + 1;
const spanCN = D => (EN ? String(daysOf(D)) : (CN[daysOf(D)] || daysOf(D)));

const brief = (s, n) => {
  const x = String(s || '').replace(/\s+/g, ' ').trim();
  return x.length > n ? x.slice(0, n) + '…' : x;
};

/* 脱敏：站点、账号、密码一律不落到纸面上 */
const redact = s => String(s || '')
  .replace(/(密码|口令|password|passwd|pwd)\s*[:：]?\s*[^\s，,。；;）)]+/gi, '$1 ***')
  .replace(/(账号|account)\s*[:：]?\s*[A-Za-z0-9_]{3,}/gi, '$1 ***')
  .replace(/https?:\/\/[^\s，,。；;]+/g, EN ? '(site)' : '（站点）');

/* 起手式：从数据推，不写死某个项目的剧情 */
function startLede(D) {
  const T = D.turns;
  const idx = T.findIndex(t => t.writes > 0);
  if (idx > 0) {
    const quiet = T.slice(1, idx).filter(t => !t.tools).length;
    if (EN) {
      const mid = quiet > 0 ? `then ${quiet} turns with zero tool calls — ` : '';
      const tail = quiet > 0
        ? `the first line of code only landed on turn ${T[idx].n}`
        : `the first file was only touched on turn ${T[idx].n}`;
      return `Turn 1 spent ${T[0].tools} tool calls ${mid}working out whether this could be done at all; ${tail}. That is not slow — it is failing before you pay for it.`;
    }
    // 中间没有「零工具轮」时就别硬写「接着 0 轮零工具调用」
    const mid = quiet > 0 ? `接着 ${quiet} 轮零工具调用——` : '';
    const tail = quiet > 0 ? `第 ${T[idx].n} 轮才写出第一行代码` : `第 ${T[idx].n} 轮才落到文件上`;
    return `第 1 轮就调了 ${T[0].tools} 次工具，${mid}先把「能不能做」问清楚，${tail}。这不算慢，是把失败成本压在动手之前。`;
  }
  if (idx === 0) {
    return EN
      ? `Turn 1 went straight to work (${T[0].tools} tool calls) with no feasibility pass — the price shows up later, in the rework.`
      : `第 1 轮就直接动手了（${T[0].tools} 次工具调用），没有先论证可行性——代价会在后面的返工里显形。`;
  }
  return EN ? 'Front-loaded: ask first, then build.' : '整体节奏偏前期：先问清楚，再动手。';
}

/* 两条主日：主体工作量落在哪两天 */
function dayNote(D) {
  const top = [...D.days].sort((a, b) => b.tools - a.tools).slice(0, 2);
  if (top.length >= 2) {
    return EN
      ? `${dayOf(top[0].d)} and ${dayOf(top[1].d)} alone account for ${nf(top[0].tools)} and ${nf(top[1].tools)} calls — the body of the work stands up right there.`
      : `${dayOf(top[0].d)} 和 ${dayOf(top[1].d)} 两天就是 ${nf(top[0].tools)} 与 ${nf(top[1].tools)} 次——主体在这里立起来。`;
  }
  return EN
    ? `${nf(top[0].tools)} calls, all on ${dayOf(top[0].d)}.`
    : `${nf(top[0].tools)} 次集中在 ${dayOf(top[0].d)} 一天里。`;
}

/* 只统计有真实用户原话的轮次：否则注入文本会被当成“最差的一轮” */
const said = D => (D.turns || []).filter(t => t.user && t.user.length > 1);
const topTurns = (D, n = 3) => said(D).slice().sort((a, b) => b.q - a.q).slice(0, n);
const lowTurns = (D, n = 3) => said(D).slice().sort((a, b) => a.q - b.q).slice(0, n);

/* 庆祝页三条：每条都挂数字，不用形容词 */
function cheer(D) {
  const T = D.turns;
  const longest = T.filter(t => t.dur > 0).sort((a, b) => b.dur - a.dur)[0] || T[0];
  const big = [...D.days].sort((a, b) => b.tools - a.tools)[0] || { d: T[0].ts, tools: 0, turns: 0 };
  if (EN) {
    return [
      { n: `${longest.dur} min`, t: 'one unbroken stretch', d: `Turn T${longest.n} ran on its own for ${longest.tools} tool calls without stopping to ask you anything.` },
      { n: `${nf(big.tools)} calls`, t: 'the strongest single day', d: `${dayOf(big.d)}: ${big.turns} turns and ${nf(big.tools)} tool calls in one day.` },
      { n: `${D.totals.files} files`, t: 'that actually landed on disk', d: `${D.totals.turns} turns produced changes in ${D.totals.files} files — not just a plan in chat.` },
    ];
  }
  return [
    { n: `${longest.dur} 分钟`, t: '一口气没断过', d: `T${longest.n} 连续自主执行，中间 ${longest.tools} 次工具调用，没有停下来等你拍板。` },
    { n: `${nf(big.tools)} 次`, t: '单日最强推进', d: `${dayOf(big.d)} 这一天跑完 ${big.turns} 轮、${nf(big.tools)} 次工具调用。` },
    { n: `${D.totals.files} 个`, t: '真正落地的文件', d: `${D.totals.turns} 轮对话改到了 ${D.totals.files} 个文件，不是只聊了个方案。` },
  ];
}

module.exports = {
  CN, nf, pct, dayOf, daysOf, spanCN, brief, redact, startLede, dayNote, cheer,
  topTurns, lowTurns, said, LANG, EN,
};
