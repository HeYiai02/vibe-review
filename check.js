#!/usr/bin/env node
/* 契约体检：把 SKILL.md 第 8 节那些「交付前检查」变成可执行断言。
   用法：node check.js <data.json>
   退出码 0 = 全部通过，1 = 有硬错误（warn 不算失败）。 */

const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) { console.error('用法: node check.js <data.json>'); process.exit(2); }
const D = JSON.parse(fs.readFileSync(file, 'utf8'));

const fails = [], warns = [], oks = [];
const ok = m => oks.push(m);
const bad = m => fails.push(m);
const warn = m => warns.push(m);

const T = D.turns || [];
const S = D.sessions || [];

/* --- 1. 基本结构 --- */
if (!D.meta || !D.meta.project) bad('meta.project 缺失');
if (!D.totals) bad('totals 缺失');
['turns', 'tools', 'errors', 'files'].forEach(k => {
  if (typeof D.totals[k] !== 'number') bad('totals.' + k + ' 不是数字');
});
if (D.meta && D.meta.source && !['dsh', 'cc', 'demo'].includes(D.meta.source)) warn('meta.source = ' + D.meta.source + '（不在 dsh/cc 里）');

/* --- 2. 轮次自洽：totals 必须等于 turns 数组的加总 --- */
if (T.length) {
  if (D.totals.turns !== T.length) bad('totals.turns=' + D.totals.turns + ' 但 turns 数组有 ' + T.length + ' 条');
  const tools = T.reduce((a, t) => a + (t.tools || 0), 0);
  const errs = T.reduce((a, t) => a + (t.err || 0), 0);
  if (Math.abs(tools - D.totals.tools) > 0) bad('工具调用加总 ' + tools + ' ≠ totals.tools ' + D.totals.tools);
  if (Math.abs(errs - D.totals.errors) > 0) bad('报错加总 ' + errs + ' ≠ totals.errors ' + D.totals.errors);
  const nums = new Set(T.map(t => t.n));
  if (nums.size !== T.length) bad('轮号有重复（' + nums.size + ' 个唯一 / ' + T.length + ' 条）');
  const badTs = T.filter(t => Number.isNaN(new Date(t.ts).getTime()));
  if (badTs.length) bad(badTs.length + ' 条的 ts 解析不出日期（第一条 T' + badTs[0].n + '）');
  const badQ = T.filter(t => !(t.q >= 0 && t.q <= 100));
  if (badQ.length) bad(badQ.length + ' 条的质量分不在 0–100（第一条 T' + badQ[0].n + '）');
  ok('轮次自洽：' + T.length + ' 轮 / ' + tools + ' 次工具 / ' + errs + ' 次报错');
}

/* --- 3. 会话区间：首尾相接、覆盖全部轮次 --- */
if (S.length) {
  let prevTo = 0;
  S.forEach((s, i) => {
    if (s.from !== prevTo + 1) bad('会话 ' + s.id + ' 的起点 ' + s.from + ' 接不上上一段（应为 ' + (prevTo + 1) + '）');
    if (s.to < s.from) bad('会话 ' + s.id + ' 的区间反了');
    prevTo = s.to;
  });
  const maxN = Math.max(...T.map(t => t.n));
  if (prevTo !== maxN) bad('会话区间只到 ' + prevTo + '，但最大轮号是 ' + maxN);
  const ids = S.map(s => s.id);
  if (new Set(ids).size !== ids.length) bad('会话 id 有重复');
  ok('会话区间：' + S.length + ' 段，覆盖 1–' + prevTo);
} else {
  warn('没有 sessions 字段：分段带会退回「工作段」');
}

/* --- 4. 叙事锚点：每个决策 / 返工案例都要指到真实存在的轮次 --- */
const byN = new Map(T.map(t => [t.n, t]));
const checkTurns = (label, arr) => {
  (arr || []).forEach(n => {
    if (!byN.has(n)) bad(label + ' 指向不存在的 T' + n);
  });
};
(D.decisions || []).forEach(d => {
  if (d.title) {
    if (!byN.has(d.turn)) bad('决策「' + d.title + '」指向不存在的 T' + d.turn);
    if (!d.aiSide) warn('决策「' + d.title + '」没写 aiSide（AI 当时的主张）');
    if (!d.cf) warn('决策「' + d.title + '」没写 cf（照它走的代价）');
  }
});
const trunk = D.trunk || [];
if (trunk.length) checkTurns('trunk', trunk);
const titled = (D.decisions || []).filter(d => d.title).length;
if (titled) {
  if (titled < 3) warn('只有 ' + titled + ' 个决策带了标题，决策段会显得单薄');
  ok('决策：' + titled + ' 条带叙事' + (trunk.length ? '，trunk 标了 ' + trunk.length + ' 个主干' : '（没写 trunk，页面会显示全部带标题的决策）'));
} else {
  warn('没有带标题的决策：决策对照表会整段缺席');
}

/* --- 5. 返工：占比必须 < 100%，且轮次区间在总轮次内 --- */
const RW = D.rework;
if (RW && RW.cases && RW.cases.length) {
  const t = RW.totals || {};
  if (t.shareMinutes > 100) bad('返工占比 ' + t.shareMinutes + '% —— 统计口径一定错了');
  if (t.shareTurns > 100) bad('返工轮次占比 ' + t.shareTurns + '% —— 统计口径一定错了');
  if (t.minutes < 0) bad('返工总分钟数为负');
  RW.cases.forEach(c => {
    checkTurns('返工 ' + c.id, c.turns);
    if (!c.cause) warn('返工 ' + c.id + ' 没写 cause（为什么会来回）');
    if (!c.fix) warn('返工 ' + c.id + ' 没写 fix（下次怎么开口）');
  });
  ok('返工：' + t.episodes + ' 段 / ' + t.turns + ' 轮 / ' + t.minutes + ' 分钟 / 占操作时间 ' + t.shareMinutes + '%');
} else {
  warn('没有 rework.cases：返工分析段会缺席');
}

/* --- 6. 规则库：每条要能指回轮次 --- */
const rules = D.rules || [];
if (rules.length) {
  const noEv = rules.filter(r => !r.ev || !String(r.ev).trim());
  if (noEv.length) bad(noEv.length + ' 条规则没有 ev（证据），其中「' + (noEv[0].title || noEv[0].id) + '」');
  const noSrc = rules.filter(r => !r.src);
  if (noSrc.length) warn(noSrc.length + ' 条规则没写 src（来源轮次）');
  ok('规则：' + rules.length + ' 条，带证据 ' + (rules.length - noEv.length) + ' 条');
} else {
  warn('没有 rules：规则库段会缺席');
}

/* --- 7. 脱敏：正文里不该出现明文密码 / 完整站点 --- */
const leak = [];
const scan = s => {
  if (typeof s !== 'string') return;
  if (/(密码|password|passwd)\s*[:：=]\s*[^\s*，,。；;）)]{3,}/i.test(s)) leak.push(s.slice(0, 50));
  if (/https?:\/\/\d{1,3}(\.\d{1,3}){3}/.test(s)) leak.push(s.slice(0, 50));
};
T.forEach(t => { scan(t.user); });
(rules || []).forEach(r => { scan(r.ev); scan(r.rule); });
(RW && RW.cases ? RW.cases : []).forEach(c => (c.quotes || []).forEach(q => scan(q.text)));
if (leak.length) bad('疑似明文泄漏 ' + leak.length + ' 处：' + JSON.stringify(leak[0])); else ok('脱敏：未发现明文密码 / 裸 IP 站点');

/* --- 输出 --- */
console.log('\n体检对象: ' + path.basename(file) + '  (' + (D.meta ? D.meta.project : '?') + ')');
oks.forEach(m => console.log('  ✓ ' + m));
warns.forEach(m => console.log('  ! ' + m));
fails.forEach(m => console.log('  ✗ ' + m));
console.log('\n' + (fails.length ? '失败 ' + fails.length + ' 项' : '硬错误 0 项') + '，提醒 ' + warns.length + ' 项\n');
process.exit(fails.length ? 1 : 0);
