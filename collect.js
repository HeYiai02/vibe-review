// Collect a single-project vibe-events model from an agent's session archive.
// Output: project.json (normalized turns, decisions, hotspots, style, distill).
// 用法: node collect.js <project> [out.json] [--cc]
//   dsh  : 读 ~/.dsh/sessions（可用 DSH_SESSIONS 覆盖）
//   --cc : 读 ~/.claude/projects（可用 CC_PROJECTS 覆盖）
const fs = require('fs');
const path = require('path');
const { readDSH, readCC } = require('./readers');

const ARGS = process.argv.slice(2);
const CC = ARGS.includes('--cc');
const REST = ARGS.filter(a => a !== '--cc');
const PROJECT = REST[0] || '.';
const OUT = REST[1] || path.join(__dirname, 'project.json');
const READ = CC ? readCC : readDSH;
const { events: all, files } = READ(PROJECT);

// 各 agent 共用：哪些"用户消息"其实是系统注入，不该算进人的输入
const INJECT = [
  /^Current runtime context\./,
  /^Time sampled while preparing turn/,
  /^<system-reminder>/,
  /^\[Compressed conversation section\]/,
  /^background job /,
  /^Background subagent /,
  /^A subagent you started/,
];
function isHuman(ev) {
  const txt = (ev.data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  if (!txt) return false;
  if (INJECT.some(re => re.test(txt))) return false;
  return true;
}
all.sort((a, b) => (a.time || 0) - (b.time || 0) || (a.seq || 0) - (b.seq || 0));

// index tool results by callId
const resultByCall = new Map();
for (const ev of all) {
  if (ev.type === 'tool/result') resultByCall.set(ev.data.message.toolCallId, ev);
}
const jobByCall = new Map();
for (const ev of all) {
  if (ev.type === 'job/registered' && ev.data.toolCall) jobByCall.set(ev.data.toolCall.callId, { reg: ev.data });
  if (ev.type === 'job/settled' && ev.data.toolCall) {
    const j = jobByCall.get(ev.data.toolCall.callId) || {};
    j.settled = ev.data;
    jobByCall.set(ev.data.toolCall.callId, j);
  }
}

// ---- turns
// 多会话合并的关键：turn 号在各自会话里从 1 重新开始，直接按号码合并会把
// 第二个会话的第 1 轮塞进第一个会话的第 1 轮里。所以先用 (会话, 本会话轮号)
// 做键，全部读完后再按会话首次出现的时间排成全局序号。
const turns = new Map();
const sesMeta = new Map();
function sesId(file) { return String(file).replace(/^session-/, '').slice(0, 8); }
function T(file, local) {
  const key = file + '#' + local;
  if (!turns.has(key)) {
    if (!sesMeta.has(file)) sesMeta.set(file, { id: sesId(file), file, first: Infinity, last: 0, turns: 0 });
    turns.set(key, {
      turn: 0, nLocal: local, ses: sesId(file), sesFile: file,
      users: [], aiText: [], reasoningChars: 0, tools: [], errors: [], steps: 0,
      usage: { in: 0, out: 0, cacheR: 0, cacheW: 0 },
      start: 0, end: 0, compacted: false, interrupted: false
    });
    sesMeta.get(file).turns++;
  }
  return turns.get(key);
}

const curLocal = new Map();
for (const ev of all) {
  const file = ev.__file;
  if (ev.type === 'turn/start') curLocal.set(file, ev.data.turn);
  const local = (ev.data && ev.data.turn) || curLocal.get(file) || 1;
  const key = file + '#' + local;
  const t = local;
  const M = sesMeta.get(file) || (T(file, local), sesMeta.get(file));
  if (ev.time) { if (ev.time < M.first) M.first = ev.time; if (ev.time > M.last) M.last = ev.time; }
  const tx = () => T(file, local);
  switch (ev.type) {
    case 'turn/start': { const x = tx(); x.start = ev.time; break; }
    case 'turn/end': { const x = tx(); x.end = ev.time; x.interrupted = ev.data.reason && ev.data.reason.kind === 'interrupted'; break; }
    case 'step/start': { tx().steps++; break; }
    case 'user/message': { if (isHuman(ev)) { const x = tx(); x.users.push({ text: (ev.data.content || []).map(c => c.text || '').join('\n'), time: ev.time }); } break; }
    case 'assistant/message': {
      const x = tx();
      if (ev.data.usage) { const u = ev.data.usage; x.usage.in += u.inputTokens || 0; x.usage.out += u.outputTokens || 0; x.usage.cacheR += u.cacheReadTokens || 0; x.usage.cacheW += u.cacheWriteTokens || 0; }
      for (const c of (ev.data.message.content || [])) {
        if (c.type === 'reasoning') x.reasoningChars += (c.text || '').length;
        if (c.type === 'text' && c.text) x.aiText.push(c.text);
      }
      break;
    }
    case 'tool/call': {
      const x = tx();
      const args = safeParse(ev.data.arguments);
      const call = { name: ev.data.name, args, callId: ev.data.callId, time: ev.time, turn: 0, step: ev.data.step };
      const r = resultByCall.get(ev.data.callId);
      const j = jobByCall.get(ev.data.callId);
      call.ok = r ? !r.data.message.isError : true;
      call.text = r ? (r.data.message.content || []).map(c => c.text || '').join('\n') : '';
      call.exit = (call.text.match(/\[exit code: (-?\d+)\]/) || [])[1];
      call.jobStatus = j && j.settled ? j.settled.status : null;
      call.ms = j && j.settled ? (j.settled.finishedAt - j.settled.startedAt) : null;
      call.file = args.file_path || args.path || null;
      if (!call.ok || (call.exit && call.exit !== '0')) x.errors.push({ name: call.name, text: call.text.slice(0, 300), exit: call.exit });
      x.tools.push(call);
      break;
    }
    case 'compaction/summary': { const x = tx(); x.compacted = true; x.compactionSummary = (ev.data.summary || []).map(c => c.text || '').join('\n'); break; }
  }
}

// 会话按首次出现时间排序，会话内按本会话轮号排序，再压成全局序号
const sesOrder = [...sesMeta.values()].sort((a, b) => a.first - b.first);
let gi = 0;
const sessionList = [];
for (const s of sesOrder) {
  const mine = [...turns.values()].filter(x => x.sesFile === s.file).sort((a, b) => a.nLocal - b.nLocal);
  const from = gi + 1;
  for (const x of mine) {
    x.turn = ++gi;
    for (const c of x.tools) c.turn = x.turn;
  }
  sessionList.push({
    id: s.id, file: s.file, from, to: gi, turns: mine.length,
    start: s.first === Infinity ? null : s.first,
    end: s.last || null
  });
}

const seq = [...turns.values()].filter(x => x.users.length || x.tools.length).sort((a, b) => a.turn - b.turn);
for (const x of seq) {
  x.firstUser = x.users.length ? x.users[0] : null;
  x.lastAi = x.aiText.length ? x.aiText[x.aiText.length - 1] : '';
  x.durMin = x.start && x.end ? Math.round((x.end - x.start) / 60000) : 0;
  x.errCount = x.errors.length;
  x.toolCount = x.tools.length;
  x.files = [...new Set(x.tools.filter(c => c.file && /^(edit|write)$/.test(c.name)).map(c => c.file))];
  x.writes = x.tools.filter(c => /^(edit|write)$/.test(c.name)).length;
  x.pwsh = x.tools.filter(c => c.name === 'pwsh').length;
  delete x.compactionSummary;
}

// ---- file hotspots
const hotspots = new Map();
for (const x of seq) for (const c of x.tools) {
  if (!c.file || !/^(edit|write)$/.test(c.name)) continue;
  const h = hotspots.get(c.file) || { file: c.file, edits: 0, errors: 0, turns: [] };
  h.edits++; if (!c.ok) h.errors++; if (!h.turns.includes(x.turn)) h.turns.push(x.turn);
  hotspots.set(c.file, h);
}

// ---- decisions: AI proposal -> human redirect
const POS = /^(好|可以|行|对|嗯|继续|没问题|就这样|是的|ok|OK|okay)/;
const REDIR = /(不对|不是|不要|别|改成|换成|应该是|其实|但是|不过|必须|重新|再改|加一个|再加|去掉|删除)/;
const decisions = [];
for (let i = 1; i < seq.length; i++) {
  const prev = seq[i - 1], cur = seq[i];
  if (!cur.firstUser) continue;
  const u = cur.firstUser.text.trim();
  const asks = /[？?]\s*$/.test(prev.lastAi) || /(要不要|是否|还是|建议|方案|两种|三个选项)/.test(prev.lastAi.slice(-400));
  const redirect = REDIR.test(u.slice(0, 120));
  const positive = POS.test(u) && u.length < 40;
  if (!(asks && (redirect || u.length > 80)) && !redirect) continue;
  decisions.push({
    id: 'd' + decisions.length,
    turn: cur.turn,
    prevTurn: prev.turn,
    proposal: prev.lastAi.slice(-900),
    choice: u,
    kind: redirect ? 'redirect' : 'followup',
    nextErrors: seq.slice(i, i + 3).reduce((a, x) => a + x.errCount, 0),
    nextTools: seq.slice(i, i + 3).reduce((a, x) => a + x.toolCount, 0),
  });
}

// ---- style
const humanMsgs = [];
for (const x of seq) for (const u of x.users) humanMsgs.push(u);
const lens = humanMsgs.map(m => m.text.length).sort((a, b) => a - b);
const night = humanMsgs.filter(m => { const h = new Date(m.time).getHours(); return h >= 22 || h < 6; }).length;
const style = {
  humanMessages: humanMsgs.length,
  totalTurns: seq.length,
  avgLen: Math.round(lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length)),
  medianLen: lens[Math.floor(lens.length / 2)] || 0,
  maxLen: lens[lens.length - 1] || 0,
  questionRatio: +(humanMsgs.filter(m => /[？?]/.test(m.text)).length / Math.max(1, humanMsgs.length)).toFixed(2),
  nightRatio: +(night / Math.max(1, humanMsgs.length)).toFixed(2),
  redirects: decisions.filter(d => d.kind === 'redirect').length,
};

const totals = {
  turns: seq.length,
  tools: seq.reduce((a, x) => a + x.toolCount, 0),
  errors: seq.reduce((a, x) => a + x.errCount, 0),
  steps: seq.reduce((a, x) => a + x.steps, 0),
  tokens: {
    in: seq.reduce((a, x) => a + x.usage.in, 0),
    out: seq.reduce((a, x) => a + x.usage.out, 0),
    cacheR: seq.reduce((a, x) => a + x.usage.cacheR, 0),
    cacheW: seq.reduce((a, x) => a + x.usage.cacheW, 0),
  },
  startTime: seq[0].start,
  endTime: seq[seq.length - 1].end,
  files: hotspots.size,
  compactions: seq.filter(x => x.compacted).length,
};

// ---- quality score per turn (deterministic, documented)
const byFileTurns = new Map();
for (const x of seq) for (const f of x.files) { const a = byFileTurns.get(f) || []; a.push(x.turn); byFileTurns.set(f, a); }
for (let i = 0; i < seq.length; i++) {
  const x = seq[i];
  let s = 70;
  if (x.writes > 0 && x.errCount === 0) s += 10;
  if (x.errCount > 0) s -= Math.min(30, x.errCount * 12);
  if (x.durMin > 40) s -= 5;
  if (x.interrupted) s -= 10;
  const next = seq[i + 1];
  if (next && next.firstUser) {
    const u = next.firstUser.text.trim();
    if (POS.test(u) && u.length < 40) s += 8;
    if (REDIR.test(u.slice(0, 120))) s -= 12;
  }
  let rework = 0;
  for (const f of x.files) {
    const later = (byFileTurns.get(f) || []).filter(t => t > x.turn && t <= x.turn + 3);
    rework += later.length;
  }
  s -= Math.min(20, rework * 6);
  x.q = Math.max(5, Math.min(100, Math.round(s)));
  x.rework = rework;
}

// 项目归属不靠目录猜：按「改动过的文件落在哪个 git 仓库」投票，投不出来才退回 cwd。
// Windows 路径大小写不敏感，比较前统一小写（CC 的日志里出现过 e:/ 与 E:/ 混用）。
const fsx = require('fs');
const repoCache = new Map();
function repoRootOf(absPath) {
  const p0 = String(absPath).replace(/\\/g, '/');
  let d = p0.replace(/\/[^/]*$/, '');
  const seen = [];
  for (let i = 0; i < 10 && d && d !== '/'; i++) {
    // 只缓存「真的找到 .git」这一种结论：把没找到时的兜底值写进祖先目录会污染别的仓库
    if (repoCache.has(d)) return repoCache.get(d);
    seen.push(d);
    try { if (fsx.existsSync(d + '/.git')) { for (const s of seen) repoCache.set(s, d); return d; } } catch (e) {}
    const up = d.replace(/\/[^/]*$/, '');
    if (up === d) break;
    d = up;
  }
  // 没有 .git（或者仓库已经不在本机）：退回「盘符/一级/二级」，保证同目录的文件仍归到一起
  const m = p0.toLowerCase().match(/^([a-z]:\/[^/]+\/[^/]+)/);
  return m ? m[1] : '(other)';
}
const fileRoots = (() => {
  const cnt = new Map();
  for (const t of turns.values()) for (const f of (t.files || [])) {
    const k = repoRootOf(String(f));
    cnt.set(k, (cnt.get(k) || 0) + 1);
  }
  return [...cnt.entries()].sort((a, b) => b[1] - a[1]);
})();
const totalFiles = fileRoots.reduce((a, x) => a + x[1], 0);
const cwdLc = String(PROJECT).replace(/\\/g, '/').toLowerCase();
const dominant = fileRoots[0] && fileRoots[0][1] / Math.max(1, totalFiles) >= 0.6 ? fileRoots[0][0] : cwdLc;

// 每个会话单独判归属：一个会话可能在 cwd 之外干了一整个项目（很常见）。
// 60% 以上的改动落在同一个仓库根，才算判得出来；否则 key = null（改动分散）。
for (const s of sessionList) {
  const c = new Map();
  for (const x of seq) {
    if (x.turn < s.from || x.turn > s.to) continue;
    for (const f of (x.files || [])) {
      const k = repoRootOf(String(f));
      c.set(k, (c.get(k) || 0) + 1);
    }
  }
  const rs = [...c.entries()].sort((a, b) => b[1] - a[1]);
  const tot = rs.reduce((a, x) => a + x[1], 0);
  s.roots = rs.slice(0, 4);
  s.key = rs[0] && rs[0][1] / Math.max(1, tot) >= 0.6 ? rs[0][0] : null;
}

const out = {
  meta: {
    project: PROJECT,
    title: seq[0] && seq[0].firstUser ? seq[0].firstUser.text.slice(0, 40) : PROJECT,
    sessions: files.length, sessionList,
    source: CC ? 'cc' : 'dsh',
    cwd: cwdLc,
    projectKey: dominant,                       // 这段会话实际属于哪个仓库
    projectMismatch: dominant !== cwdLc,        // 主要改动发生在 cwd 之外
    roots: fileRoots.slice(0, 6),
    generated: new Date().toISOString(),
  },
  totals, style,
  turns: seq.map(x => ({
    turn: x.turn, nLocal: x.nLocal, ses: x.ses, start: x.start, end: x.end, durMin: x.durMin, steps: x.steps,
    user: x.users.map(u => u.text).join('\n---\n'), ai: x.aiText.join('\n').slice(0, 1500),
    q: x.q, rework: x.rework, errCount: x.errCount, toolCount: x.toolCount,
    writes: x.writes, pwsh: x.pwsh, files: x.files.slice(0, 12),
    tools: x.tools.map(c => ({ n: c.name, f: c.file, ok: c.ok, exit: c.exit, t: c.text.slice(0, 160), ms: c.ms, s: c.jobStatus })),
    compacted: x.compacted, interrupted: x.interrupted,
    usage: x.usage,
  })),
  decisions,
  hotspots: [...hotspots.values()].sort((a, b) => b.edits - a.edits).slice(0, 30),
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
console.log('turns', totals.turns, 'tools', totals.tools, 'errors', totals.errors, 'decisions', decisions.length, 'files', totals.files);
console.log('style', JSON.stringify(style));
console.log('tokens', JSON.stringify(totals.tokens));

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return {}; } }
