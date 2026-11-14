/* 生成单项目复盘页：读 data.json + styles.css + app.js，输出单文件 HTML */
const fs = require('fs');
const path = require('path');
const P = __dirname;
// 用 DATA=path/to/data.json 指定输入，别去覆盖目录里的 data.json——
// 多个项目并行渲染时，那个共享文件会被互相踩。
const DATAFILE = process.env.DATA ? path.resolve(process.env.DATA) : path.join(P, 'data.json');
const D = JSON.parse(fs.readFileSync(DATAFILE, 'utf8'));
const CSS = fs.readFileSync(path.join(P, 'styles.css'), 'utf8');
const APP = fs.readFileSync(path.join(P, 'app.js'), 'utf8');
const zlib = require('zlib');
const PACKED = zlib.gzipSync(Buffer.from(JSON.stringify(D), 'utf8'), { level: 9 }).toString('base64');

const COPY = require('./copy.js');
const { LANG, t: T, DICT } = require('./i18n');
const nf = COPY.nf;
const fmtD = COPY.dayOf;
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TURNS = D.turns;
const first = TURNS[0];
const redact = COPY.redact;
const heroQ0 = redact(first.user || '').replace(/\s+/g, ' ');
const at = heroQ0.indexOf('这是一个');
const heroQ = (at > 0 ? heroQ0.slice(at) : heroQ0).slice(0, 112);
const twoDay = (D.days[0] ? D.days[0].tools : 0) + (D.days[1] ? D.days[1].tools : 0);
const twoDayShare = Math.round(twoDay / D.totals.tools * 100);
const spanDays = COPY.daysOf(D);

/* ---- 01 起手式 / 庆祝三条：口径与分享卡、Markdown 共用 copy.js ---- */
const startLede = COPY.startLede(D);
const dayNote = COPY.dayNote(D);
const cheer = COPY.cheer(D);
const topErr = (D.hotspots || []).slice().sort((a, b) => b.errors - a.errors)[0];
const RC1 = (D.rework && D.rework.cases && D.rework.cases.length) ? D.rework.cases[0] : null;
const coach = [];
if (RC1) {
  coach.push(LANG === 'en'
    ? { n: `${RC1.n} turns`, t: `The biggest rework: ${RC1.name}`, d: `${RC1.errors} errors across ${RC1.spanMin} minutes. ${RC1.fix || RC1.cause}` }
    : { n: `${RC1.n} 轮`, t: `最大的一次返工：${RC1.name}`, d: `${RC1.errors} 次报错、跨 ${RC1.spanMin} 分钟。${RC1.fix || RC1.cause}` });
}
if (topErr && topErr.errors) {
  coach.push(LANG === 'en'
    ? { n: `${topErr.errors} errors`, t: `Where you slip most often: ${topErr.file}`, d: `${topErr.edits} edits and ${topErr.errors} errors on this file — next time, read the whole function through before touching it.` }
    : { n: `${topErr.errors} 次`, t: `最容易失手的地方：${topErr.file}`, d: `这个文件被改过 ${topErr.edits} 次、报错 ${topErr.errors} 次——下次动它之前，先把相关函数整段读完再落手。` });
}
if (D.style && D.style.humanMessages) {
  coach.push(LANG === 'en'
    ? {
      n: `${D.style.medianLen} chars`,
      t: 'Most instructions are one line',
      d: `${D.style.humanMessages} messages, median ${D.style.medianLen} chars, only ${Math.round(D.style.questionRatio * 100)}% questions — the binding constraint usually arrives as a follow-up sentence, and that is exactly where rework starts.`,
    }
    : {
      n: `${D.style.medianLen} 字`,
      t: '多数指令只有一行',
      d: `${D.style.humanMessages} 条消息里中位数 ${D.style.medianLen} 字，问句只占 ${Math.round(D.style.questionRatio * 100)}%——关键约束常常是后面补的一句，这正好是返工的起点。`,
    });
}
const CN = ['', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];
const spanCN = LANG === 'en' ? String(spanDays) : (CN[spanDays] || spanDays);
const tSub = T('h.sub', { turns: D.totals.turns, tools: nf(D.totals.tools), days: D.days.length });
const tFirst = T('h.first', { m: new Date(first.ts).getMonth() + 1, d: new Date(first.ts).getDate() });

/* ---- 04 返工 ---- */
const RW = D.rework || { totals: { episodes: 0, turns: 0, minutes: 0, errors: 0, shareTurns: 0, shareMinutes: 0, shareErrors: 0 }, cases: [], contrast: null };
function caseCard(c, contrast) {
  const quotes = (c.quotes || []).map(q =>
    `<blockquote class="rw-q">${esc((q.text || '').slice(0, 190))}${(q.text || '').length > 190 ? '…' : ''}<span>T${q.turn}</span></blockquote>`
  ).join('');
  const meta = `T${c.turns[0]}–T${c.turns[c.turns.length - 1]} · ${c.n} 轮 · 跨 ${c.spanMin} 分钟 · ${c.errors} 次报错`;
  const pr = c.prompt;
  const prBlock = pr ? `<div class="pr"><button class="prb">${T('rw.prompt')}</button>
      <pre class="prc">${esc(pr)}</pre></div>` : '';
  const pr2 = c.repro;
  const pr2Block = pr2 ? `<div class="pr pr2"><button class="prb">${T('rw.repro')}</button>
      <pre class="prc">${esc(pr2)}</pre></div>` : '';
  return `<div class="rw ${contrast ? 'rw-c' : ''}">
    <div class="rw-h"><span class="rw-id">${c.id}</span><b>${esc(c.name)}</b>
      <span class="tag">${esc(c.tag)}</span><span class="rw-meta">${meta}</span></div>
    ${quotes}
    ${contrast
      ? `<p class="rw-p">${esc(c.cause)}</p>`
      : `<div class="rw-2">
          <div><h5>${T('rw.why')}</h5><p>${esc(c.cause)}</p></div>
          <div class="fix"><h5>${T('rw.fix')}</h5><p>${esc(c.fix)}</p></div>
        </div>${prBlock}${pr2Block}`}
  </div>`;
}
const activeMinutes = (D.totals && D.totals.durSum) || TURNS.reduce((a, x) => a + (x.dur || 0), 0);
const rwTot = RW ? RW.totals : { episodes: 0, turns: 0, minutes: 0, errors: 0, shareTurns: 0, shareMinutes: 0, shareErrors: 0 };
const hot = D.hotspots.slice(0, 12);
const maxHot = Math.max(1, ...hot.map(h => h.edits));

/* ---- 哪些板块有料 ---- */
const HAS_DEC = !!(D.decisions && D.decisions.filter(d => d.title).length);
const HAS_RW = !!(RW && RW.cases && RW.cases.length);
const HAS_RULES = !!(D.rules && D.rules.length);
const TC = D.toolCounts || {};
const runN = TC.pwsh || 0, editN = (TC.edit || 0) + (TC.write || 0);
const s6Instr = (() => {
  const st = D.style;
  const short = st.medianLen < 60;
  let out = T('s6.instrA', { n: st.humanMessages, avg: st.avgLen, med: st.medianLen });
  out += short ? T('s6.instrShort') : T('s6.instrLong');
  if (st.maxLen > 5000) out += T(short ? 's6.instrShortPaste' : 's6.instrLongPaste', { k: Math.round(st.maxLen / 1000) });
  out += T(short ? 's6.instrEndShort' : 's6.instrEndLong');
  return out;
})();
const askN = TC.ask_user_question || 0;
const SRC_NAME = { dsh: 'DeepSeek Harness', cc: 'Claude Code' }[D.meta.source] || D.meta.source || '会话日志';

function askBoxHtml() {
  if (!D.ask) return '';
  const opts = (D.ask.options || []).map((o, i) =>
    `<div class="opt ${i + 1 === D.ask.pick ? 'pick' : ''}"><span class="k">${i + 1}</span><span>${esc(o)}${i + 1 === D.ask.pick ? T('ask.pick') : ''}</span></div>`).join('');
  return `<div class="sbox askbox">
    <h4>${T('ask.title')}</h4>
    <div class="q">${T('ask.q', { turn: D.ask.turn, n: (D.ask.options || []).length, q: esc(D.ask.q) })}</div>
    ${opts}
  </div>`;
}
const SUBTITLE = D.meta.subtitle || '';
const DEGRADE = D.meta.source === 'cc' ? `<div class="degrade">
  <b>${T('deg.title')}</b>${T('deg.body')}
</div>` : '';

/* ---- 06 规则库 ---- */
const targets = [
  ['dsh', T('tg.dsh.t'), T('tg.dsh.d'), true],
  ['agents', T('tg.agents.t'), T('tg.agents.d'), false],
  ['project', T('tg.project.t'), T('tg.project.d', { path: (D.paths && D.paths.project ? D.paths.project : T('tg.project.default')) }), false],
  ['none', T('tg.none.t'), T('tg.none.d'), false]
];

const html = `<!doctype html>
<html lang="${T('html.lang')}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${D.meta.project} · ${T('title.pre')}${spanCN}${T('title.post')}</title>
<style>${CSS}</style>
</head><body>
<div class="wrap">

<header>
  <div class="kicker">Project Review · Single Project</div>
  <h1>${T('title.pre')}<em>${spanCN}</em>${T('title.post')}</h1>
  <div class="sub"><b>${esc(D.meta.project)}</b> · ${SUBTITLE} · ${tSub}</div>
  <div class="firstq"><span class="who">${tFirst}</span>${esc(heroQ)}…</div>
</header>

${DEGRADE}

<section id="s1">
  <div class="stats">
    <div class="stat"><b data-v="${D.totals.turns}">${D.totals.turns}</b><span>${T('st.turns')}</span></div>
    <div class="stat"><b data-v="${D.totals.tools}">${nf(D.totals.tools)}</b><span>${T('st.tools')}</span></div>
    <div class="stat"><b data-v="${D.totals.files}">${D.totals.files}</b><span>${T('st.files')}</span></div>
    <div class="stat"><b data-v="${D.totals.errors}">${D.totals.errors}</b><span>${T('st.errors')}</span></div>
    <div class="stat"><b data-v="${(D.totals.tokens.out / 1e6).toFixed(1)}" data-d="1">${(D.totals.tokens.out / 1e6).toFixed(1)}M</b><span>${T('st.tokens')}</span></div>
    <div class="stat"><b data-v="${D.days.length}">${D.days.length}</b><span>${T('st.days')}</span></div>
  </div>
  <div class="cheer">
    <div class="cheer-h">${T('cheer.head')}</div>
    <div class="cheer-grid">
      ${cheer.map((c, i) => `<div class="ci"><span class="cn">${String(i + 1).padStart(2, '0')}</span>
        <b>${esc(c.n)}</b><span class="ct">${esc(c.t)}</span><p>${esc(c.d)}</p></div>`).join('')}
    </div>
  </div>
</section>

<section id="s2">
  <div class="h2"><span class="idx">01</span><h2>${T('s2.title')}</h2><span class="note">${T('s2.note')}</span></div>
  <p class="lede">${startLede}</p>
  <div class="card days" id="days"></div>
  <p class="days-note">${T('s2.daysNote', { detail: dayNote })}</p>
</section>

<section id="s3">
  <div class="h2"><span class="idx">02</span><h2>${T('s3.title')}</h2><span class="note">${(D.sessions && D.sessions.length > 1) ? T('s3.noteMany', { n: D.sessions.length }) : T('s3.noteOne')}</span></div>
  <p class="lede">${T('s3.lede', { share: twoDayShare, tools: nf(D.totals.tools), two: nf(twoDay) })}</p>

  <div class="card">
    <div class="filters" style="padding-top:14px">
      <button class="on" data-f="all">${T('s3.all')}</button>
      <button data-f="best">${T('s3.best')}</button>
      <button data-f="bad">${T('s3.bad')}</button>
      <button data-f="wrote">${T('s3.wrote')}</button>
      <button data-f="long" class="msgonly">${T('s3.long')}</button>
      <span class="vtabs"><button class="on" data-v="chart">${T('s3.chart')}</button><button data-v="msgs">${T('s3.msgs')}</button></span>
    </div>
    <div class="chart" id="chart">
      <div class="segrow" id="segrow"></div>
      <div class="spectrum">
        <div class="bars" id="bars"></div>
        <div class="axis" id="axis"></div>
      </div>
      <div class="legend">
        <span><i style="background:var(--good)"></i>${T('s3.lgGood')}</span>
        <span><i style="background:var(--warn)"></i>${T('s3.lgWarn')}</span>
        <span><i style="background:var(--bad)"></i>${T('s3.lgBad')}</span>
        <span><i style="background:var(--cyan)"></i>${T('s3.lgWrote')}</span>
      </div>
      <div class="qnote">${T('s3.qnote')}</div>
    </div>
    <div class="msgs" id="msgs"></div>
  </div>
  <div class="detail" id="detail"></div>

  <div class="h2" style="margin-top:38px"><span class="idx">02</span><h2>${T('s3.picksTitle')}</h2><span class="note">${T('s3.picksNote')}</span></div>
  <div class="picks" id="picks"></div>
</section>

<section id="s4">
  <div class="h2"><span class="idx">03</span><h2>${T('s4.title')}</h2><span class="note">${T('s4.note', { n: (D.decisions || []).filter(d => d.title).length })}</span></div>
  <p class="lede">${T('s4.lede')}</p>
  <div class="vtabs" id="dtabs" style="padding:14px 0 4px">
    <button class="on" data-d="flow">${T('s4.flow')}</button><button data-d="tl">${T('s4.timeline')}</button>
  </div>
  <div class="flow" id="flow"></div>
  <div class="tl" id="tl" style="display:none"></div>
  <div class="tlbody" id="tlbody" style="display:none"></div>
</section>

<section id="s5">
  <div class="h2"><span class="idx">04</span><h2>${T('s5.title')}</h2><span class="note">${T('s5.note', { episodes: rwTot.episodes, turns: rwTot.turns, pct: Math.round(rwTot.shareMinutes) })}</span></div>
  <p class="lede">${T('s5.lede')}</p>
  <div class="rwtot">
    <div class="rt"><b>${rwTot.episodes}</b><span>${T('s5.episodes')}</span><em>${T('s5.episodesNote')}</em></div>
    <div class="rt"><b>${rwTot.turns}</b><span>${T('s5.turns')}</span><em>${T('s5.turnsNote', { all: D.totals.turns, pct: rwTot.shareTurns })}</em></div>
    <div class="rt"><b>${rwTot.minutes}<small>m</small></b><span>${T('s5.minutes')}</span><em>${T('s5.minutesNote', { all: activeMinutes, pct: rwTot.shareMinutes })}</em></div>
    <div class="rt"><b>${rwTot.errors}</b><span>${T('s5.errors')}</span><em>${T('s5.errorsNote', { all: D.totals.errors, pct: rwTot.shareErrors })}</em></div>
  </div>
  ${RW.cases.map(c => caseCard(c, false)).join('')}
  ${RW.contrast ? caseCard(RW.contrast, true) : ''}

  <div class="h3">${T('s5.hot')}<span class="n">${T('s5.hotNote')}</span></div>
  <div class="card hot">
    ${hot.map(h => `<div class="hrow"><div class="f">${esc(h.file)}</div>
      <div class="b"><i style="width:${Math.round(h.edits / maxHot * 100)}%"></i>${h.errors ? `<u style="width:${Math.round(h.errors / maxHot * 100)}%"></u>` : ''}</div>
      <div class="v">${T('s5.hotRow', { n: `<b>${h.edits}</b>`, e: h.errors })}</div></div>`).join('')}
  </div>
</section>

<section id="s6">
  <div class="h2"><span class="idx">05</span><h2>${T('s6.title')}</h2><span class="note">${T('s6.note', { n: D.style.humanMessages })}</span></div>
  <p class="lede">${T('s6.lede')}</p>
  <div class="grid2">
    <div class="sbox"><h4>${T('s6.instr')}</h4><div class="big">${D.style.medianLen}<small>${T('s6.instrUnit')}</small></div>
      <p>${s6Instr}</p></div>
    <div class="sbox"><h4>${T('s6.push')}</h4><div class="big">${Math.round(D.style.questionRatio * 100)}%<small>${T('s6.pushUnit')}</small></div>
      <p>${T('s6.pushBody', { n: D.style.redirects })}</p></div>
    <div class="sbox"><h4>${T('s6.trust')}</h4><div class="big">${askN}<small>${T('s6.trustUnit')}</small></div>
      <p>${T('s6.trustBody', { n: D.totals.turns, ask: askN })}</p></div>
    <div class="sbox"><h4>${T('s6.run')}</h4><div class="big">${runN}<small>${T('s6.runUnit', { e: editN })}</small></div>
      <p>${runN > editN ? T('s6.runA') : T('s6.runB')}</p></div>
  </div>
  <div class="sbox askbox">${askBoxHtml()}</div>
</section>

<section id="s7">
  <div class="h2"><span class="idx">06</span><h2>${T('s7.title')}</h2><span class="note">${T('s7.note', { n: D.rules.length })}</span></div>
  <p class="lede">${T('s7.lede')}</p>

  <div class="libbar">
    <span class="hint">${T('s7.count', { n: D.rules.length, total: D.rules.length })}</span>
    <button class="mini" id="selAll">${T('s7.all')}</button>
    <button class="mini" id="selNone">${T('s7.none')}</button>
    <button id="copyGen">${T('s7.copy')}</button>
    <button id="dlGen">${T('s7.download')}</button>
  </div>

  <div class="libwrap">
    <div class="libside">
      <h4>${T('s7.where')}</h4>
      ${targets.map(([v, t, d, on]) => `<label class="tgt"><input type="radio" name="tgt" value="${v}"${on ? ' checked' : ''}><span><b>${t}</b><em>${esc(d)}</em></span></label>`).join('')}
      <div class="tgtpath" id="tgtpath"></div>
      <div class="tgthint">${T('s7.hint')}</div>
    </div>
    <div id="lib"></div>
  </div>

  <div class="genhead">${T('s7.genhead')}<span id="genmeta"></span></div>
  <pre class="genpre" id="genpre"></pre>
</section>

<section id="s8">
  <div class="h2"><span class="idx">07</span><h2>${T('s8.title')}</h2><span class="note">${T('s8.note')}</span></div>
  <p class="lede">${T('s8.lede')}</p>
  <div class="coach">
    ${coach.map((c, i) => `<div class="co"><span class="cn">${String(i + 1).padStart(2, '0')}</span>
      <div class="cbody"><b>${esc(c.n)}</b><span class="ct">${esc(c.t)}</span><p>${esc(c.d)}</p></div></div>`).join('')}
  </div>
</section>

<div class="actions">
  <button onclick="window.print()">${T('btn.pdf')}</button>
  <button id="expandAll">${T('btn.expandAll')}</button>
</div>



<footer>
  <span>${T('ft.source', { turns: D.totals.turns, tools: nf(D.totals.tools), errors: D.totals.errors })}</span>
  <span class="sp">${T('ft.note')}</span>
  ${process.env.NO_ARCHIVE ? '' : '<a class="xlink" href="archive.html">' + T('ft.archive') + '</a>'}
</footer>

</div>

<div class="themes" id="themes"></div>

<script id="i18n" type="application/json">${JSON.stringify(DICT)}</script>
<script id="data" type="application/gzip+base64">${PACKED}</script>
<script id="appsrc" type="text/plain">${APP}</script>
<script>
/* 数据是 gzip+base64 的：先解压再执行 app.js，首屏体积能少一半。
   app.js 里的 D 现在挂在 window 上，所以解压完再注入执行。 */
(function () {
  var txt = document.getElementById('data').textContent.replace(/\\s+/g, '');
  var bin = atob(txt), u8 = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  new Response(stream).text().then(function (s) {
    window.D = JSON.parse(s);
    window.I18N = JSON.parse(document.getElementById('i18n').textContent);
    var el = document.createElement('script');
    el.textContent = document.getElementById('appsrc').textContent;
    document.body.appendChild(el);
  });
})();
</script>
<script>
document.getElementById('expandAll').onclick = function () {
  var all = document.querySelectorAll('.dnode');
  var anyClosed = [].some.call(all, function (n) { return !n.classList.contains('open'); });
  all.forEach(function (n) { n.classList.toggle('open', anyClosed); });
  this.textContent = anyClosed ? T('btn.collapseAll') : T('btn.expandAll');
};
</script>
</body></html>`;

let out = html;
function dropSection(id) {
  const re = new RegExp('<section id="' + id + '">[\\s\\S]*?\\n</section>\\n');
  out = out.replace(re, '');
}
if (!HAS_DEC) dropSection('s4');
if (!HAS_RW) dropSection('s5');
if (!HAS_RULES) dropSection('s7');
// 章节序号按剩余板块重排（六轮现场那张副标题不留编号）
let k = 0;
out = out.replace(/<span class="idx">\d+<\/span>/g, () => '<span class="idx">' + String(++k).padStart(2, '0') + '</span>');
if (!HAS_DEC) {
  const ea = out.indexOf('<button id="expandAll">');
  if (ea > 0) out = out.replace(/<button id="expandAll">[^<]*<\/button>/, '');
}

const OUTNAME = (process.env.OUTHTML || (D.meta.project + '-review.html'));
fs.writeFileSync(path.join(P, OUTNAME), out, 'utf8');
console.log('wrote', path.join(P, OUTNAME), (Buffer.byteLength(out) / 1024).toFixed(1) + ' KB',
  '| sections: dec=' + HAS_DEC + ' rw=' + HAS_RW + ' rules=' + HAS_RULES);
