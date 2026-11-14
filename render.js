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
const nf = COPY.nf;
const fmtD = COPY.dayOf;
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const T = D.turns;
const first = T[0];
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
  coach.push({ n: `${RC1.n} 轮`, t: `最大的一次返工：${RC1.name}`, d: `${RC1.errors} 次报错、跨 ${RC1.spanMin} 分钟。${RC1.fix || RC1.cause}` });
}
if (topErr && topErr.errors) {
  coach.push({ n: `${topErr.errors} 次`, t: `最容易失手的地方：${topErr.file}`, d: `这个文件被改过 ${topErr.edits} 次、报错 ${topErr.errors} 次——下次动它之前，先把相关函数整段读完再落手。` });
}
if (D.style && D.style.humanMessages) {
  coach.push({
    n: `${D.style.medianLen} 字`,
    t: '多数指令只有一行',
    d: `${D.style.humanMessages} 条消息里中位数 ${D.style.medianLen} 字，问句只占 ${Math.round(D.style.questionRatio * 100)}%——关键约束常常是后面补的一句，这正好是返工的起点。`,
  });
}
const CN = ['', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];
const spanCN = CN[spanDays] || spanDays;

/* ---- 04 返工 ---- */
const RW = D.rework || { totals: { episodes: 0, turns: 0, minutes: 0, errors: 0, shareTurns: 0, shareMinutes: 0, shareErrors: 0 }, cases: [], contrast: null };
function caseCard(c, contrast) {
  const quotes = (c.quotes || []).map(q =>
    `<blockquote class="rw-q">${esc((q.text || '').slice(0, 190))}${(q.text || '').length > 190 ? '…' : ''}<span>T${q.turn}</span></blockquote>`
  ).join('');
  const meta = `T${c.turns[0]}–T${c.turns[c.turns.length - 1]} · ${c.n} 轮 · 跨 ${c.spanMin} 分钟 · ${c.errors} 次报错`;
  const pr = c.prompt;
  const prBlock = pr ? `<div class="pr"><button class="prb">下次这段活，我会这么开口（点开看）</button>
      <pre class="prc">${esc(pr)}</pre></div>` : '';
  const pr2 = c.repro;
  const pr2Block = pr2 ? `<div class="pr pr2"><button class="prb">下次复现这个功能，可以这样说（点开看）</button>
      <pre class="prc">${esc(pr2)}</pre></div>` : '';
  return `<div class="rw ${contrast ? 'rw-c' : ''}">
    <div class="rw-h"><span class="rw-id">${c.id}</span><b>${esc(c.name)}</b>
      <span class="tag">${esc(c.tag)}</span><span class="rw-meta">${meta}</span></div>
    ${quotes}
    ${contrast
      ? `<p class="rw-p">${esc(c.cause)}</p>`
      : `<div class="rw-2">
          <div><h5>为什么会来回</h5><p>${esc(c.cause)}</p></div>
          <div class="fix"><h5>下次这样用 AI</h5><p>${esc(c.fix)}</p></div>
        </div>${prBlock}${pr2Block}`}
  </div>`;
}
const activeMinutes = (D.totals && D.totals.durSum) || T.reduce((a, t) => a + (t.dur || 0), 0);
const rwTot = RW ? RW.totals : { episodes: 0, turns: 0, minutes: 0, errors: 0, shareTurns: 0, shareMinutes: 0, shareErrors: 0 };
const hot = D.hotspots.slice(0, 12);
const maxHot = Math.max(1, ...hot.map(h => h.edits));

/* ---- 哪些板块有料 ---- */
const HAS_DEC = !!(D.decisions && D.decisions.filter(d => d.title).length);
const HAS_RW = !!(RW && RW.cases && RW.cases.length);
const HAS_RULES = !!(D.rules && D.rules.length);
const TC = D.toolCounts || {};
const runN = TC.pwsh || 0, editN = (TC.edit || 0) + (TC.write || 0);
const askN = TC.ask_user_question || 0;
const SRC_NAME = { dsh: 'DeepSeek Harness', cc: 'Claude Code' }[D.meta.source] || D.meta.source || '会话日志';

function askBoxHtml() {
  if (!D.ask) return '';
  const opts = (D.ask.options || []).map((o, i) =>
    `<div class="opt ${i + 1 === D.ask.pick ? 'pick' : ''}"><span class="k">${i + 1}</span><span>${esc(o)}${i + 1 === D.ask.pick ? ' — 你选的' : ''}</span></div>`).join('');
  return `<div class="sbox askbox">
    <h4>为数不多「你说了算」的一次</h4>
    <div class="q">T${D.ask.turn}，我给了你 ${(D.ask.options || []).length} 个选项，问：${esc(D.ask.q)}</div>
    ${opts}
  </div>`;
}
const SUBTITLE = D.meta.subtitle || '';
const DEGRADE = D.meta.source === 'cc' ? `<div class="degrade">
  <b>这份报告来自 Claude Code 日志。</b>它不含待办、审批、后台任务这几类事件——
  所以「审批过几次」「有几条待办」「后台任务跑了多久」在本页是缺席，不是 0。
</div>` : '';

/* ---- 06 规则库 ---- */
const targets = [
  ['dsh', '用户级全局', '~/.dsh/AGENTS.md · DSH 每次请求都读，所有项目生效', true],
  ['agents', '跨工具共享', '~/.agents/AGENTS.md · Claude Code / Codex 等也认这一份', false],
  ['project', '只装这个项目', (D.paths && D.paths.project ? D.paths.project : '项目根/AGENTS.md') + ' · 不污染其它项目', false],
  ['none', '先不装', '只复制到剪贴板，贴哪儿由我决定', false]
];

const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${D.meta.project} · 一个人的${spanCN}天</title>
<style>${CSS}</style>
</head><body>
<div class="wrap">

<header>
  <div class="kicker">Project Review · Single Project</div>
  <h1>一个人的<em>${spanCN}天</em></h1>
  <div class="sub"><b>${esc(D.meta.project)}</b> · ${SUBTITLE} · <b>${D.totals.turns}</b> 轮对话 · <b>${nf(D.totals.tools)}</b> 次工具调用 · <b>${D.days.length}</b> 个活跃日</div>
  <div class="firstq"><span class="who">第 1 句 · ${new Date(first.ts).getMonth() + 1} 月 ${new Date(first.ts).getDate()} 日</span>${esc(heroQ)}…</div>
</header>

${DEGRADE}

<section id="s1">
  <div class="stats">
    <div class="stat"><b data-v="${D.totals.turns}">${D.totals.turns}</b><span>轮对话</span></div>
    <div class="stat"><b data-v="${D.totals.tools}">${nf(D.totals.tools)}</b><span>次工具调用</span></div>
    <div class="stat"><b data-v="${D.totals.files}">${D.totals.files}</b><span>个文件被改</span></div>
    <div class="stat"><b data-v="${D.totals.errors}">${D.totals.errors}</b><span>次工具报错</span></div>
    <div class="stat"><b data-v="${(D.totals.tokens.out / 1e6).toFixed(1)}" data-d="1">${(D.totals.tokens.out / 1e6).toFixed(1)}M</b><span>输出 token</span></div>
    <div class="stat"><b data-v="${D.days.length}">${D.days.length}</b><span>个活跃日</span></div>
  </div>
  <div class="cheer">
    <div class="cheer-h">你做到了 · 三条能拿出去说的</div>
    <div class="cheer-grid">
      ${cheer.map((c, i) => `<div class="ci"><span class="cn">${String(i + 1).padStart(2, '0')}</span>
        <b>${esc(c.n)}</b><span class="ct">${esc(c.t)}</span><p>${esc(c.d)}</p></div>`).join('')}
    </div>
  </div>
</section>

<section id="s2">
  <div class="h2"><span class="idx">01</span><h2>起手式</h2><span class="note">先问能不能，再问怎么做</span></div>
  <p class="lede">${startLede}</p>
  <div class="card days" id="days"></div>
  <p class="days-note">每根柱子 = <b>那天的工具调用次数</b>，高度按最大值缩放。${dayNote}</p>
</section>

<section id="s3">
  <div class="h2"><span class="idx">02</span><h2>轮次光谱</h2><span class="note">${(D.sessions && D.sessions.length > 1) ? D.sessions.length + " 个会话 · 每根柱子是一轮" : "1 个会话 · 每根柱子是一轮"}</span></div>
  <p class="lede">高度是这一轮的工具调用量，颜色是质量分：越绿越顺，越红越翻车。整体是一段前陡后缓的曲线——前两天吃掉 ${twoDayShare}% 的工作量（${nf(D.totals.tools)} 次调用里的 ${nf(twoDay)} 次），剩下的日子全是打磨。</p>

  <div class="card">
    <div class="filters" style="padding-top:14px">
      <button class="on" data-f="all">全部</button>
      <button data-f="best">只看最好的</button>
      <button data-f="bad">只看翻车的</button>
      <button data-f="wrote">只看写了文件的</button>
      <button data-f="long" class="msgonly">输入内容长的</button>
      <span class="vtabs"><button class="on" data-v="chart">谱图</button><button data-v="msgs">对话总览</button></span>
    </div>
    <div class="chart" id="chart">
      <div class="segrow" id="segrow"></div>
      <div class="spectrum">
        <div class="bars" id="bars"></div>
        <div class="axis" id="axis"></div>
      </div>
      <div class="legend">
        <span><i style="background:var(--good)"></i>顺（q≥70）</span>
        <span><i style="background:var(--warn)"></i>一般（40–69）</span>
        <span><i style="background:var(--bad)"></i>翻车（&lt;40）</span>
        <span><i style="background:var(--cyan)"></i>柱顶青边 = 这轮写了文件</span>
      </div>
      <div class="qnote">q 是确定性公式算出来的，不是模型打分：基准 70，写成功文件 +10，每次工具报错 −12，被打断 −10，下一轮你接着推进 +8，改道 −12。它量的不是你满不满意，而是这一轮有没有把事情推远、有没有留下要还的债。</div>
    </div>
    <div class="msgs" id="msgs"></div>
  </div>
  <div class="detail" id="detail"></div>

  <div class="h2" style="margin-top:38px"><span class="idx">02</span><h2>六轮值得回看的现场</h2><span class="note">点卡片展开当时的原话</span></div>
  <div class="picks" id="picks"></div>
</section>

<section id="s4">
  <div class="h2"><span class="idx">03</span><h2>决策对照表</h2><span class="note">${(D.decisions || []).filter(d => d.title).length} 个岔路口 · 点开看对照与后来产出</span></div>
  <p class="lede">每个节点都是一次「AI 给方案、你当场改掉或接受」。左边虚线是它当时的建议，右边实线是你真正走的路。展开后先是一段决策对比，再说这个决策之后 3 轮里产出了什么——数字从日志里数出来，不是我编的。</p>
  <div class="vtabs" id="dtabs" style="padding:14px 0 4px">
    <button class="on" data-d="flow">分支图</button><button data-d="tl">时间轴</button>
  </div>
  <div class="flow" id="flow"></div>
  <div class="tl" id="tl" style="display:none"></div>
  <div class="tlbody" id="tlbody" style="display:none"></div>
</section>

<section id="s5">
  <div class="h2"><span class="idx">04</span><h2>返工分析</h2><span class="note">${rwTot.episodes} 段 · ${rwTot.turns} 轮 · 吃掉 ${Math.round(rwTot.shareMinutes)}% 的时间</span></div>
  <p class="lede">返工不等于改得多。同一个文件被改十次，可能只是需求在长。这里只算一种：上一版被判定不可用、必须重做。每段都附你当时的原话——根因和处方是读完原话写的，不是从改动次数里猜的。</p>
  <div class="rwtot">
    <div class="rt"><b>${rwTot.episodes}</b><span>段真返工</span><em>其余来回是需求在长，不算</em></div>
    <div class="rt"><b>${rwTot.turns}</b><span>轮对话</span><em>占全部 ${D.totals.turns} 轮的 ${rwTot.shareTurns}%</em></div>
    <div class="rt"><b>${rwTot.minutes}<small>m</small></b><span>实际动手时间</span><em>占全部 ${activeMinutes} 分钟的 ${rwTot.shareMinutes}%</em></div>
    <div class="rt"><b>${rwTot.errors}</b><span>次工具报错</span><em>占 ${D.totals.errors} 次的 ${rwTot.shareErrors}%</em></div>
  </div>
  ${RW.cases.map(c => caseCard(c, false)).join('')}
  ${RW.contrast ? caseCard(RW.contrast, true) : ''}

  <div class="h3">附：改动热度<span class="n">这不是返工，只是说明重量压在哪儿</span></div>
  <div class="card hot">
    ${hot.map(h => `<div class="hrow"><div class="f">${esc(h.file)}</div>
      <div class="b"><i style="width:${Math.round(h.edits / maxHot * 100)}%"></i>${h.errors ? `<u style="width:${Math.round(h.errors / maxHot * 100)}%"></u>` : ''}</div>
      <div class="v"><b>${h.edits}</b> 次 · ${h.errors} 错</div></div>`).join('')}
  </div>
</section>

<section id="s6">
  <div class="h2"><span class="idx">05</span><h2>你在项目里的样子</h2><span class="note">从 ${D.style.humanMessages} 条消息里量出来的</span></div>
  <p class="lede">不是给你贴标签，是给你看证据。</p>
  <div class="grid2">
    <div class="sbox"><h4>你怎么下指令</h4><div class="big">${D.style.medianLen}<small>字 / 中位数</small></div>
      <p>${D.style.humanMessages} 条消息平均 ${D.style.avgLen} 字，中位数 ${D.style.medianLen} 字——${D.style.medianLen < 60
        ? '你大多数时候只说半句话（「继续」「先这样」）' + (D.style.maxLen > 5000 ? '，偶尔贴进来一万多字的日志' : '')
        : '你习惯把要求一次说全' + (D.style.maxLen > 5000 ? '，最长的一条有 ' + Math.round(D.style.maxLen / 1000) + ' 千字（贴进来的日志或代码）' : '')}。指令是${D.style.medianLen < 60 ? '短的，判断是快的' : '完整的，边界是提前画好的'}。</p></div>
    <div class="sbox"><h4>你怎么推进</h4><div class="big">${Math.round(D.style.questionRatio * 100)}%<small>是问句</small></div>
      <p>${D.style.redirects} 次你在下一条消息里推翻了上一条的方向。你不常问「怎么办」，你常问「这样对吗」——然后自己给答案。</p></div>
    <div class="sbox"><h4>你信不过谁</h4><div class="big">${askN}<small>次主动提问</small></div>
      <p>${D.totals.turns} 轮里你只让 AI 给过 ${askN} 次选项。其余全靠你直接下判断。</p></div>
    <div class="sbox"><h4>你更信跑一遍</h4><div class="big">${runN}<small>次运行 / ${editN} 次改文件</small></div>
      <p>${runN > editN ? '你让它跑的次数比改代码还多——验证驱动，不是描述驱动。' : '改的比跑的多——更像是边改边想，靠回读确认。'}</p></div>
  </div>
  <div class="sbox askbox">${askBoxHtml()}</div>
</section>

<section id="s7">
  <div class="h2"><span class="idx">06</span><h2>你的规则库</h2><span class="note">${D.rules.length} 条 · 挑你要的，直接装</span></div>
  <p class="lede">这不是总结，是可以直接交给下一个 AI 的东西。勾掉你不认可的，选一个要装的位置，下面那段文字会跟着变——复制走，或下载成 AGENTS.md。</p>

  <div class="libbar">
    <span class="hint">已选 <b id="pickcount">${D.rules.length}</b> / ${D.rules.length} 条</span>
    <button class="mini" id="selAll">全选</button>
    <button class="mini" id="selNone">全不选</button>
    <button id="copyGen">复制这段</button>
    <button id="dlGen">下载 AGENTS.md</button>
  </div>

  <div class="libwrap">
    <div class="libside">
      <h4>装到哪里</h4>
      ${targets.map(([v, t, d, on]) => `<label class="tgt"><input type="radio" name="tgt" value="${v}"${on ? ' checked' : ''}><span><b>${t}</b><em>${esc(d)}</em></span></label>`).join('')}
      <div class="tgtpath" id="tgtpath"></div>
      <div class="tgthint">装好后新开一个会话就生效。文件里已有的内容不会被覆盖，重复的段落会自动合并。</div>
    </div>
    <div id="lib"></div>
  </div>

  <div class="genhead">将写入的内容<span id="genmeta"></span></div>
  <pre class="genpre" id="genpre"></pre>
</section>

<section id="s8">
  <div class="h2"><span class="idx">07</span><h2>教练页 · 如果再来一次</h2><span class="note">三条，每条都挂着数字</span></div>
  <p class="lede">庆祝页说的是你做到了什么，这一页说的是下次能省下什么。三条都不是"多练练"，每一条都能在日志里指到具体的轮次。</p>
  <div class="coach">
    ${coach.map((c, i) => `<div class="co"><span class="cn">${String(i + 1).padStart(2, '0')}</span>
      <div class="cbody"><b>${esc(c.n)}</b><span class="ct">${esc(c.t)}</span><p>${esc(c.d)}</p></div></div>`).join('')}
  </div>
</section>

<div class="actions">
  <button onclick="window.print()">导出 PDF（打印版）</button>
  <button id="expandAll">展开全部决策</button>
</div>



<footer>
  <span>数据源：${SRC_NAME} 会话日志 · ${D.totals.turns} 轮 / ${nf(D.totals.tools)} 次工具调用 / ${D.totals.errors} 次报错</span>
  <span class="sp">确定性脚本计算，叙事由模型生成 · 推测内容已单独标注</span>
  ${process.env.NO_ARCHIVE ? '' : '<a class="xlink" href="archive.html">跨项目档案 →</a>'}
</footer>

</div>

<div class="themes" id="themes"></div>

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
  this.textContent = anyClosed ? '收起全部决策' : '展开全部决策';
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
