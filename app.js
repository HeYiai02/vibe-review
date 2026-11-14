/* 前端交互：光谱、卡片、流程图、规则库 */
(function () {
  var T = D.turns, byN = {};
  T.forEach(function (t) { byN[t.n] = t; });
  var nf = function (n) { return (n || 0).toLocaleString('en-US'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  function md(s) {
    s = String(s || '');
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '［截图］');
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
    s = s.replace(/^#{1,4}\s*/gm, '');
    return s;
  }
  function dt(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  var CUTS = ['The approval policy changed', 'Current runtime context.', 'Time sampled while preparing', '[Compressed conversation section]', 'This is an automatically generated checkpoint', '<compacted-summary>'];
  /* 页面里所有正文都会经过这里：先把站点、账号、密码打码 */
  function redact(s) {
    return String(s || '')
      .replace(/(密码|口令)\s*[:：]?\s*([A-Za-z0-9!@#$%^&*._-]{4,})/gi, '$1 ***')
      .replace(/(password|passwd|pwd)\s*[:：]?\s*\S+/gi, '$1 ***')
      .replace(/(账号|account)\s*[:：]?\s*[A-Za-z0-9_@.]{3,}/gi, '$1 ***')
      .replace(/https?:\/\/[^\s，,。；;）)]+/g, '（站点）');
  }
  function cleanUser(s) {
    s = String(s || '');
    for (var i = 0; i < CUTS.length; i++) {
      var k = s.indexOf(CUTS[i]);
      if (k === 0) { s = ''; break; }
      if (k > 0) s = s.slice(0, k);
    }
    return redact(s.replace(/^[\s-]+$/gm, '').trim());
  }
  T.forEach(function (t) {
    t.clean = cleanUser(t.user);
    t.user = redact(t.user);
    t.ai = redact(t.ai);
  });

  /* 入场：进视口才淡入上移，避免一次性全放 */
  var io = null;
  function reveal(el) {
    if (!el) return;
    if (!('IntersectionObserver' in window)) { el.classList.add('in'); return; }
    if (!io) {
      io = new IntersectionObserver(function (es) {
        es.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    }
    el.classList.add('rv');
    io.observe(el);
  }

  /* 给整页的“块”挂上入场：段落 / 卡片 / 节点 / 时间轴 */
  function revealAll() {
    var host = document.querySelector('.wrap') || document.body;
    host.querySelectorAll('.pick, .case, .um, .dnode, .rule, .rt').forEach(function (el, i) {
      if (el.classList.contains('rv')) return;
      el.style.transitionDelay = Math.min(i % 6, 5) * 40 + 'ms';
      reveal(el);
    });
  }
  window.__revealAll = revealAll;
  /* 兜底：2.5 秒后还没触发的，一律显示出来，绝不留下空白块 */
  setTimeout(function () {
    document.querySelectorAll('.rv').forEach(function (el) { el.classList.add('in'); });
  }, 2500);

  /* 开场：KPI 数字从 0 滚到目标值，1.1 秒 */
  (function () {
    var els = document.querySelectorAll('.stat b[data-v]');
    if (!els.length) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var t0 = performance.now(), DUR = 1100;
    function step(now) {
      var p = Math.min(1, (now - t0) / DUR);
      var e = 1 - Math.pow(1 - p, 3);
      els.forEach(function (b) {
        var v = parseFloat(b.dataset.v) || 0;
        var cur = v * e;
        b.textContent = b.dataset.d ? cur.toFixed(1) + 'M' : nf(Math.round(cur));
      });
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
    setTimeout(function () {
      els.forEach(function (b) {
        var v = parseFloat(b.dataset.v) || 0;
        b.textContent = b.dataset.d ? v.toFixed(1) + 'M' : nf(Math.round(v));
      });
    }, 1600);
  })();

  /* 收起一段内容时，补偿被抽走的高度，避免视口跳走 */
  function collapseKeep(el, fn) {
    var h0 = el.getBoundingClientRect().height;
    var top0 = el.getBoundingClientRect().top;
    fn();
    var h1 = el.getBoundingClientRect().height;
    var dropped = h0 - h1;
    if (dropped > 2 && top0 < 0) window.scrollBy(0, -dropped);
  }

  function filesChip(files) {
    if (!files || !files.length) return '';
    var items = files.map(function (f) {
      var base = String(f).split(/[\\/]/).pop();
      return '<span class="fit" title="' + esc(f) + '">' + esc(base) + '</span>';
    }).join('');
    return '<div class="files"><span class="fsum">动过 ' + files.length + ' 个文件</span>' +
      '<div class="fpop"><div class="fph">点一次文件名可看全路径</div>' + items + '</div></div>';
  }
  function bub(who, txt, cls) {
    var s = txt || '';
    var long = s.length > 420;
    return '<div class="bub ' + cls + '"><span class="who">' + who + '</span>' +
      '<div class="txt"><div class="bd' + (long ? ' clamp' : '') + '">' + esc(md(s)) + '</div>' +
      (long ? '<button class="more" data-rest="' + (s.length - 420) + '">展开全文 · 还有 ' + (s.length - 420) + ' 字</button>' : '') +
      '</div></div>';
  }

  /* ---------- 01 起手式：紧排的日柱 ---------- */
  var days = document.getElementById('days');
  days.innerHTML = D.days.map(function (d, i) {
    var h = Math.max(4, Math.round(d.tools / D.maxDay * 58));
    var lb = i === 0 ? '第 1 天' : i === 1 ? '第 2 天' : d.d.slice(5);
    return '<div class="day' + (d.tools >= 300 ? ' hot' : '') + (d.tools === 0 ? ' zero' : '') + '">' +
      '<div class="bar" style="height:' + h + 'px"></div>' +
      '<div class="lb"><b>' + nf(d.tools) + '</b>' + lb + '</div></div>';
  }).join('') + '<div class="days-sum"><b>' + D.days.length + '</b> 天开工<b>' +
    nf(D.totals.tools) + '</b> 次调用<b>' + nf(D.totals.turns) + '</b> 轮对话</div>';

  /* ---------- 02 轮次光谱 ---------- */
  var maxTools = Math.max.apply(null, T.map(function (t) { return t.tools; }));
  var bars = document.getElementById('bars');
  bars.innerHTML = T.map(function (t) {
    var h = Math.max(3, Math.round(t.tools / maxTools * 150));
    var c = t.q >= 70 ? 'var(--good)' : t.q >= 40 ? 'var(--warn)' : 'var(--bad)';
    return '<div class="bar-t" data-t="' + t.n + '" title="T' + t.n + ' · q' + t.q + ' · ' + t.tools + ' 次工具">' +
      '<i style="height:' + h + 'px;background:' + c + '">' + (t.writes ? '<u></u>' : '') + '</i></div>';
  }).join('');

  var axis = document.getElementById('axis');
  var multi = (D.sessions || []).length > 1;
  if (multi) {
    /* 多会话时柱序按会话分组，不是全局时间顺序——再画日期轴就会来回跳，直接不画 */
    axis.innerHTML = '<span style="left:0;transform:none;opacity:.55">柱子按会话分组排列，不是时间顺序</span>';
  } else {
  var marks = [], lastKey = '', lastPct = -99;
  T.forEach(function (t, i) {
    var d = new Date(t.ts);
    var key = (d.getMonth() + 1) + '-' + String(d.getDate()).padStart(2, '0');
    if (key === lastKey) return;
    var pct = i / (T.length - 1) * 100;
    if (pct - lastPct < 7) { lastKey = key; return; }
    marks.push({ pct: pct, txt: key });
    lastKey = key; lastPct = pct;
  });
  var dEnd = new Date(T[T.length - 1].ts);
  var endKey = (dEnd.getMonth() + 1) + '-' + String(dEnd.getDate()).padStart(2, '0');
  while (marks.length && 100 - marks[marks.length - 1].pct < 8) marks.pop();
  marks.push({ pct: 100, txt: endKey });
  axis.innerHTML = marks.map(function (m, i) {
    return '<span style="left:' + m.pct.toFixed(2) + '%' + (i === marks.length - 1 ? ';transform:translateX(-100%)' : '') + '">' + m.txt + '</span>';
  }).join('');
  }

  /* 会话段：按时间断点切（>3 小时算换了一次会话）。
     多会话 / 多 agent 的项目，这里就是“接力点”的位置。 */
  function segments() {
    var out = [], cur = [0];
    for (var i = 1; i < T.length; i++) {
      var gapH = (new Date(T[i].ts) - new Date(T[i - 1].ts)) / 36e5;
      if (gapH > 3) { out.push(cur); cur = [i]; } else cur.push(i);
    }
    out.push(cur);
    return out;
  }
  var SEGS = segments();
  var SES = D.sessions || [];
  var segrow = document.getElementById('segrow');
  function band(a, b, title, sub) {
    var w = b - a;
    var style = 'left:' + a.toFixed(2) + '%;width:' + w.toFixed(2) + '%';
    if (w < 9) return '<span class="segtick" style="' + style + '" title="' + title + ' ' + sub + '"></span>';
    return '<span class="seg" style="' + style + '"><b>' + title + '</b>' + sub + '</span>';
  }
  if (segrow) {
    if (SES.length > 1) {
      /* 真正的多会话：每段按会话切，标签用会话 id —— 这就是“接力点” */
      segrow.innerHTML = SES.map(function (s) {
        var i0 = T.findIndex(function (t) { return t.n === s.from; });
        var i1 = T.findIndex(function (t) { return t.n === s.to; });
        if (i0 < 0) i0 = 0; if (i1 < 0) i1 = T.length - 1;
        // 会话可能主要改的是另一个仓库：写进标签，别让人以为整段都在当前目录
        var kb = s.key ? s.key.split('/').pop() : '';
        var other = kb && D.cwd && kb !== D.cwd ? ' · 改 ' + kb : '';
        return band(i0 / T.length * 100, (i1 + 1) / T.length * 100,
          '会话 ' + s.id, s.turns + ' 轮' + other);
      }).join('');
    } else if (SEGS.length > 1) {
      /* 单会话：退回到“工作段”（同一会话里隔了 >3 小时的两截）
         窄段只画刻度、不占编号，否则会出现「工作段 1 / 4 / 5 / 7」这种跳号 */
      var shown = 0;
      segrow.innerHTML = SEGS.map(function (s) {
        var a = s[0] / T.length * 100, b = (s[s.length - 1] + 1) / T.length * 100;
        var d = new Date(T[s[0]].ts);
        var sub = (d.getMonth() + 1) + '/' + d.getDate() + ' · ' + s.length + ' 轮';
        if (b - a < 9) {
          return '<span class="segtick" style="left:' + a.toFixed(2) + '%;width:' + (b - a).toFixed(2) +
            '%" title="工作段 ' + sub + '"></span>';
        }
        shown++;
        return band(a, b, '工作段 ' + shown, sub);
      }).join('');
    }
  }

  var detail = document.getElementById('detail');
  var curN = null;
  function show(t) {
    var el = byN[t];
    if (curN === t) {
      var bar0 = document.querySelector('.bar-t[data-t="' + t + '"]');
      collapseKeep(detail, function () {
        detail.classList.remove('on'); detail.innerHTML = ''; curN = null;
        document.querySelectorAll('.bar-t.sel').forEach(function (x) { x.classList.remove('sel'); });
      });
      return;
    }
    curN = t;
    var prev = document.querySelector('.bar-t.sel'); if (prev) prev.classList.remove('sel');
    var cur = document.querySelector('.bar-t[data-t="' + t + '"]'); if (cur) cur.classList.add('sel');
    detail.innerHTML =
      '<div class="head"><span class="pill">T' + el.n + '</span>' +
      '<span class="pill">' + dt(el.ts) + '</span>' +
      '<span class="pill q">质量分 ' + el.q + '</span>' +
      '<span class="pill">' + el.tools + ' 次工具</span>' +
      (el.dur ? '<span class="pill">' + el.dur + ' 分钟</span>' : '') +
      (el.err ? '<span class="pill e">' + el.err + ' 次报错</span>' : '') +
      (el.compacted ? '<span class="pill">上下文压缩</span>' : '') +
      '<span class="x" id="dx">收起</span></div>' +
      bub('你', el.user || '（这一轮没有文字指令）', 'u') +
      bub('AI', el.ai || '（这一轮没有回复正文）', 'a') +
      filesChip(el.files);
    detail.classList.add('on');
  }
  bars.addEventListener('click', function (e) {
    var b = e.target.closest('.bar-t'); if (b) show(+b.dataset.t);
  });
  detail.addEventListener('click', function (e) {
    if (e.target.id === 'dx') { show(curN); }
  });
  document.querySelectorAll('.filters button').forEach(function (btn) {
    btn.onclick = function () {
      document.querySelectorAll('.filters button').forEach(function (x) { x.classList.remove('on'); });
      btn.classList.add('on');
      var k = btn.dataset.f;
      if (msgs.classList.contains('on')) { mFilter = k; mShown = MLIMIT; drawMsgs(); return; }
      document.querySelectorAll('.bar-t').forEach(function (el) {
        var t = byN[+el.dataset.t], ok = true;
        if (k === 'best') ok = t.q >= 70;
        else if (k === 'bad') ok = t.q < 40;
        else if (k === 'wrote') ok = t.writes > 0;
        el.style.opacity = ok ? 1 : 0.16;
      });
    };
  });
  show(T[T.length - 1].n);

  /* ---------- 02b 对话总览 ---------- */
  var msgs = document.getElementById('msgs');
  var chart = document.getElementById('chart');
  var MLIMIT = 30, mShown = MLIMIT, mFilter = 'all', mSel = null;
  var msgList = T.filter(function (t) { return t.clean; });
  /* 判断一条用户消息是不是「粘贴进来的东西」而不是「提的需求」：
     代码块、证书/密钥、超长无空格 token、代码符号密度过高、易语言源码、
     一行一个小短句的排版，都算粘贴。 */
  function isPaste(s) {
    if (!s) return false;
    if (/```/.test(s)) return true;
    if (/-----BEGIN |MII[A-Za-z0-9+/]{20,}|[A-Za-z0-9+/]{160,}={0,2}/.test(s)) return true;
    if (/^\s*(at |File "|Traceback|\$ |PS [A-Z]:)/m.test(s)) return true;
    if (/子程序|程序集|局部变量|字节集|返回\s*\(|\.版本\s*2|调试输出/.test(s)) return true;
    if (/(\d{1,3}[,，]){12,}/.test(s) || /[0-9A-F]{16,}/.test(s)) return true;
    var code = (s.match(/[{};=<>]|\b(function|const|let|import|class|def|public|private|return|await)\b/g) || []).length;
    if (code >= Math.max(8, s.length * 0.015)) return true;
    var lines = s.split('\n').filter(function (x) { return x.trim(); });
    if (lines.length >= 20) {
      var short = lines.filter(function (x) { return x.trim().length <= 34; }).length;
      if (short / lines.length >= 0.75) return true;
    }
    var hexish = (s.match(/[0-9A-Fa-f]/g) || []).length / s.length;
    return s.length > 200 && hexish > 0.55;
  }
  function msgPool() {
    var L = msgList.slice();
    if (mFilter === 'best') L = L.filter(function (t) { return t.q >= 70; });
    else if (mFilter === 'bad') L = L.filter(function (t) { return t.q < 40; });
    else if (mFilter === 'wrote') L = L.filter(function (t) { return t.writes > 0; });
    else if (mFilter === 'long') {
      // 「输入内容长的」要的是长需求，不是粘贴的日志/代码/证书：先剔掉糊上来的，再按原始长度排
      L = L.filter(function (t) { return !isPaste(t.clean); })
           .sort(function (a, b) { return (b.ulen || b.clean.length) - (a.ulen || a.clean.length); });
    }
    return L;
  }
  function drawMsgs() {
    var L = msgPool();
    msgs.innerHTML = L.slice(0, mShown).map(function (t) {
      var qc = t.q >= 70 ? 'var(--good)' : t.q >= 40 ? 'var(--warn)' : 'var(--bad)';
      return '<div class="um' + (mSel === t.n ? ' on' : '') + '" data-t="' + t.n + '">' +
        '<div class="um-h"><span class="um-n">T' + t.n + '</span><span>' + dt(t.ts) + '</span>' +
        '<span>' + (t.ulen || t.clean.length) + ' 字</span>' +
        '<span style="color:' + qc + '">q' + t.q + '</span></div>' +
        '<div class="um-b">' + esc(md(t.clean)) + '</div></div>';
    }).join('');
    if (mShown < L.length) {
      msgs.innerHTML += '<button class="um-more" id="umMore">显示全部 ' + L.length + ' 条（还有 ' +
        (L.length - mShown) + ' 条）</button>';
    }
  }
  drawMsgs();
  document.querySelectorAll('#mtabs button').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('#mtabs button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      mFilter = b.dataset.m; mShown = MLIMIT; drawMsgs();
    };
  });
  msgs.addEventListener('click', function (e) {
    if (e.target.id === 'umMore') { mShown = msgPool().length; drawMsgs(); return; }
    var u = e.target.closest('.um'); if (!u) return;
    mSel = +u.dataset.t;
    msgs.querySelectorAll('.um').forEach(function (x) { x.classList.toggle('on', x === u); });
    show(mSel);
    reveal(detail);
  });
  document.querySelectorAll('.vtabs button').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('.vtabs button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      var isChart = b.dataset.v === 'chart';
      chart.style.display = isChart ? '' : 'none';
      msgs.classList.toggle('on', !isChart);
      document.querySelectorAll('.filters').forEach(function (f) {
        f.classList.toggle('msgsmode', !isChart);
      });
      if (!isChart) {
        mFilter = 'all'; mShown = MLIMIT; drawMsgs();
        document.querySelectorAll('.filters button').forEach(function (x) { x.classList.toggle('on', x.dataset.f === 'all'); });
      } else if (curN !== null) {
        show(curN);
      }
    };
  });

  /* ---------- 主题 ---------- */
  var THEMES = [['', '夜色'], ['ice', '深海'], ['amber', '暖夜'], ['paper', '纸白']];
  var thBar = document.getElementById('themes');
  if (thBar) {
    thBar.innerHTML = '<span>风格</span>' + THEMES.map(function (t) {
      return '<button data-th="' + t[0] + '">' + t[1] + '</button>';
    }).join('');
    var applyTh = function (name) {
      if (name) document.documentElement.setAttribute('data-theme', name);
      else document.documentElement.removeAttribute('data-theme');
      thBar.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x.dataset.th === name); });
      try { localStorage.setItem('vibe-theme', name); } catch (_) {}
    };
    thBar.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      applyTh(b.dataset.th);
    });
    var saved = '';
    try { saved = localStorage.getItem('vibe-theme') || ''; } catch (_) {}
    applyTh(saved);
  }

  /* ---------- 卡片：六轮值得回看的现场 ---------- */
  var dayTools = {};
  D.days.forEach(function (d) { dayTools[d.d] = d.tools; });
  function whyOf(k, t, L) {
    var dk = new Date(t.ts), pad = function (n) { return String(n).padStart(2, '0'); };
    var ymd = dk.getFullYear() + '-' + pad(dk.getMonth() + 1) + '-' + pad(dk.getDate());
    if (k === '最长的一口气') return '连续跑了 ' + t.dur + ' 分钟、' + t.tools + ' 次工具调用' + (t.err ? ('，中间错了 ' + t.err + ' 次也没停') : '，一次没断') + '。你这轮的指令只有 ' + L + ' 字——给的是目标，不是步骤，它才能自己往下推这么久。';
    if (k === '它干得最多') return t.tools + ' 次工具调用、写了 ' + t.writes + ' 个文件' + (t.err ? ('、错 ' + t.err + ' 次') : '、一次没错') + '。量这么大，说明这轮铺开的是一整块功能，不是一个点的修补。';
    if (k === '最长的一段需求') return '你一次写了 ' + L + ' 字，把页面、数据、权限、顺序都说完了。回头看，这种长度的交代后面几乎不用返工——歧义在开头就被你消掉了。';
    if (k === '最顺的一轮') return '0 次报错、' + t.writes + ' 个文件一次写对，q 分 ' + t.q + '。你的指令 ' + L + ' 字，剩下的它自己补完——这是「需求说清楚 + 改动范围小」叠在一起的结果。';
    if (k === '最晚的一轮') return '这条消息发出时已经 ' + pad(dk.getHours()) + ':' + pad(dk.getMinutes()) + '，这一天你一共调用了 ' + nf(dayTools[ymd] || t.tools) + ' 次工具。收尾阶段的改动通常很小，但都在关键路径上。';
    return '';
  }
  function pickBody(p, t, src) {
    if (p.kind === 'rework') {
      var c = D.rework.cases.filter(function (x) { return x.turns.indexOf(t.n) >= 0; })[0];
      var out = '<div class="why"><b>为什么是它</b><p>' + esc(c ? c.cause : '这一轮是整段里最糟的一次，后面几轮都在补同一件事。') + '</p></div>';
      if (c) {
        out += '<div class="rwl"><div class="rwlh">这一段一共 ' + c.n + ' 轮 · 跨 ' + c.spanMin + ' 分钟 · ' + c.errors + ' 次报错 · 你按顺序是这么说的：</div>' +
          c.turns.map(function (n) {
            var x = byN[n]; if (!x) return '';
            return '<div class="rwrow"><span class="tn">T' + n + '</span><span class="tx">' +
              esc(md((x.clean || '（无文字指令）').slice(0, 130))) + '</span><span class="er">' + (x.err ? x.err + ' 错' : '—') + '</span></div>';
          }).join('') + '</div>' +
          '<div class="fixb"><b>下次怎么开口</b><p>' + esc(c.fix) + '</p></div>';
      }
      return out;
    }
    return '<div class="why"><b>为什么是它</b><p>' + esc(whyOf(p.k, t, src.length)) + '</p></div>' +
      bub('你', src || '（这一轮没有文字指令）', 'u') +
      bub('AI', (t.ai || '（这一轮没有回复正文）'), 'a') +
      filesChip(t.files);
  }
  var picks = [
    { k: '最长的一口气', pick: function (L) { var pool = L.filter(function (t) { return t.clean && t.clean.length > 30; }); return (pool.length ? pool : L).reduce(function (a, b) { return b.dur > a.dur ? b : a; }); }, unit: '分钟', val: function (t) { return t.dur; }, note: '连续自动执行最久的一轮' },
    { k: '它干得最多', pick: function (L) { return L.reduce(function (a, b) { return b.tools > a.tools ? b : a; }); }, unit: '次工具', val: function (t) { return t.tools; }, note: '一轮里调用工具的次数' },
    {
      k: '最长的一段需求', note: '你写得最完整的一次交代', unit: '字',
      pick: function (L) {
        var pool = L.filter(function (t) { return t.clean.length >= 150 && t.clean.length <= 1200; });
        if (!pool.length) pool = L;
        return pool.reduce(function (a, b) { return b.clean.length > a.clean.length ? b : a; });
      },
      val: function (t) { return t.clean.length; }
    },
    { k: '最顺的一轮', pick: function (L) { return L.reduce(function (a, b) { return (b.q > a.q ? b : (b.q === a.q && b.tools > a.tools ? b : a)); }); }, unit: '分', val: function (t) { return t.q; }, note: '零报错、按预期落地' },
    { k: '最惨的一轮', kind: 'rework', pick: function (L) { return L.reduce(function (a, b) { return b.q < a.q ? b : a; }); }, unit: '分', val: function (t) { return t.q; }, note: '点了看这段为什么反复' },
    { k: '最晚的一轮', pick: function (L) { return L.reduce(function (a, b) { return b.ts > a.ts ? b : a; }); }, unit: '', val: function (t) { var d = new Date(t.ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }, note: '最后一条消息的时间' }
  ];
  var box = document.getElementById('picks');
  var used = {};
  box.innerHTML = picks.map(function (p, i) {
    var cand = T.filter(function (t) { return !used[t.n] && t.clean && t.clean.length > 8; });
    if (!cand.length) cand = T.filter(function (t) { return !used[t.n]; });
    var t = p.pick(cand && cand.length ? cand : T);
    used[t.n] = 1;
    var src = (t.clean === undefined ? cleanUser(t.user) : t.clean);
    var head = src.slice(0, 150) + (src.length > 150 ? '…' : '');
    return '<div class="pick' + (p.kind === 'rework' ? ' rwk' : '') + '" data-i="' + i + '">' +
      '<div class="k"><em>' + p.k + '</em><span class="hint"></span></div>' +
      '<div class="big">' + nf(p.val(t)) + (p.unit ? '<span>' + p.unit + '</span>' : '') + '</div>' +
      '<div class="sub">T' + t.n + ' · ' + dt(t.ts) + ' · ' + p.note + '</div>' +
      '<div class="q3"><b>你：</b>' + esc(md(head || '（这一轮没有文字指令）')) + '</div>' +
      '<div class="pbody">' + pickBody(p, t, src) + '</div></div>';
  }).join('');
  box.addEventListener('click', function (e) {
    if (e.target.closest('.more, .fit, .prb')) return;
    var c = e.target.closest('.pick'); if (!c) return;
    collapseKeep(c, function () {
      var open = c.classList.contains('open');
      box.querySelectorAll('.pick').forEach(function (x) { x.classList.remove('open'); });
      if (!open) c.classList.add('open');
    });
  });
  document.addEventListener('click', function (e) {
    var fin = e.target.closest('.fit');
    if (fin) {
      var full = fin.getAttribute('title');
      var base = full.split(/[\\/]/).pop();
      fin.classList.toggle('showfull');
      fin.textContent = fin.classList.contains('showfull') ? full : base;
      return;
    }
    var pb = e.target.closest('.prb');
    if (pb) { pb.parentElement.classList.toggle('on'); return; }
    var m = e.target.closest('.more');
    if (m) {
      var bd = m.parentElement.querySelector('.bd');
      var on = bd.classList.toggle('clamp');
      m.textContent = on ? ('展开全文 · 还有 ' + (m.dataset.rest || '') + ' 字') : '收起';
    }
  });

  /* ---------- 03 决策对照表 ---------- */
  var flows = document.getElementById('flow');
  var NODES = D.decisions.filter(function (d) { return d.title; });
  var HOT = (D.hotspots || []).slice(0, 6).map(function (h) { return h.file; });
  function base(p) { return String(p).split(/[\\/]/).pop(); }
  function short2(p) { var a = String(p).replace(/\\/g, '/').split('/'); return a.length > 1 ? a[a.length - 2] + '/' + a[a.length - 1] : a[0]; }
  function norm(p) { return String(p).replace(/\\/g, '/'); }
  function resultOf(d) {
    var n3 = T.filter(function (t) { return t.n > d.turn && t.n <= d.turn + 3; });
    var files = [];
    n3.forEach(function (t) { (t.files || []).forEach(function (f) { if (files.indexOf(f) < 0) files.push(f); }); });
    var errs = n3.reduce(function (a, t) { return a + t.err; }, 0);
    var tools = n3.reduce(function (a, t) { return a + t.tools; }, 0);
    var mins = n3.reduce(function (a, t) { return a + (t.dur || 0); }, 0);
    var later = T.filter(function (t) { return t.n > d.turn + 3; });
    var touchLater = later.filter(function (t) {
      return (t.files || []).some(function (f) { return files.indexOf(f) >= 0; });
    }).length;
    var edits = 0;
    (D.hotspots || []).forEach(function (h) {
      if (files.some(function (f) { return norm(f).slice(-norm(h.file).length) === norm(h.file); })) edits += h.edits;
    });
    var rw = (D.rework.cases || []).filter(function (c) { return c.turns.indexOf(d.turn) >= 0; })[0];
    var shorts = [];
    files.forEach(function (f) { var s = short2(f); if (shorts.indexOf(s) < 0) shorts.push(s); });
    var s = files.length
      ? ('之后 3 轮动了 ' + files.length + ' 个文件（' + shorts.slice(0, 2).join('、') + (shorts.length > 2 ? ' 等' : '') + '）')
      : '之后 3 轮没有动文件';
    s += '，调用 ' + tools + ' 次工具';
    if (mins) s += '、花了 ' + Math.round(mins) + ' 分钟';
    s += '，报错 ' + errs + ' 次。';
    if (files.length) {
      s += '这批文件后面又被 ' + touchLater + ' 轮改过';
      if (edits) s += '，累计 ' + edits + ' 次编辑';
      s += '。';
    }
    if (rw) s += '这段后来演变成 ' + rw.id + '「' + rw.name + '」那场 ' + rw.n + ' 轮返工。';
    return s;
  }
  function nodeBody(d) {
    // cf 可能是「从日志里读出来的事实」，也可能是「推演」。两者必须一眼分得开，
    // 否则页脚那句「推测内容已单独标注」就是空承诺。
    var k = d.cfKind === 'infer' ? 'infer' : 'fact';
    var tag = k === 'infer' ? '若走 AI 那条（推演）' : '决策对比（据日志）';
    var hint = k === 'infer' ? ' title="这条是推演：另一条路没有真的发生过，结论是从后面的数据倒推的"' : '';
    return '<div class="cf ' + k + '"' + hint + '><span class="tag">' + tag + '</span><p>' +
        esc(d.cf || '（这一步没有留下对照记录）') + '</p></div>' +
      '<div class="res"><span class="tag">决策后产出了什么</span><p>' + esc(resultOf(d)) + '</p></div>';
  }
  flows.innerHTML = NODES.map(function (d) {
    return '<div class="dnode" data-n="' + d.turn + '">' +
      '<div class="dnode-h"><span class="n">T' + d.turn + '</span><span class="t">' + esc(d.title) + '</span>' +
      '<span class="op">展开</span></div>' +
      '<div class="dfork">' +
      '<div class="arm no"><span class="tag">AI 主张</span><p>' + esc(d.aiSide || '') + '</p></div>' +
      '<div class="dfork-c"><span class="dot"></span></div>' +
      '<div class="arm yes"><span class="tag">你选的</span><p>' + esc(d.choice || '') + '</p></div>' +
      '</div>' +
      '<div class="dnode-b">' + nodeBody(d) + '</div></div>';
  }).join('');

  flows.addEventListener('click', function (e) {
    var h = e.target.closest('.dnode-h'); if (!h) return;
    var node = h.parentElement;
    collapseKeep(node, function () { node.classList.toggle('open'); });
    var op = h.querySelector('.op');
    if (op) op.textContent = node.classList.contains('open') ? '收起' : '展开';
  });

  /* ---------- 03b 时间轴视图 ---------- */
  var tl = document.getElementById('tl'), tlBody = document.getElementById('tlbody');
  if (tl) {
    var ts0 = new Date(NODES[0].ts || T[0].ts).getTime();
    var ts1 = new Date(NODES[NODES.length - 1].ts || T[0].ts).getTime();
    // 按轮次顺序等距排布，而不是按真实时间：86% 的活集中在头两天，
    // 按时间排会把 10 个节点全挤在左边 8% 的宽度里。
    var span = Math.max(1, ts1 - ts0);
    var lastN = -1;
    tl.innerHTML = '<div class="tl-axis"></div>' + NODES.map(function (d, i) {
      var t = byN[d.turn]; if (!t) return '';
      var left = NODES.length > 1 ? (i / (NODES.length - 1)) : 0.5;
      var up = i % 2 === 0;
      var sameDay = NODES[i - 1] && byN[NODES[i - 1].turn] &&
        dt(byN[NODES[i - 1].turn].ts).slice(0, 5) === dt(t.ts).slice(0, 5);
      var gap = (i > 0 && !sameDay) ? '<span class="tl-gap">' + dt(t.ts).slice(0, 5) + '</span>' : '';
      return '<button class="tl-n' + (up ? ' up' : ' dn') + '" data-n="' + d.turn + '" style="left:' +
        (9 + left * 82).toFixed(2) + '%">' + gap +
        '<span class="tl-k">T' + d.turn + '</span><span class="tl-t">' + esc(d.title) + '</span>' +
        '<span class="tl-d">' + dt(t.ts).slice(-5) + '</span></button>';
    }).join('');
    tl.addEventListener('click', function (e) {
      var b = e.target.closest('.tl-n'); if (!b) return;
      var n = +b.dataset.n;
      var d = NODES.filter(function (x) { return x.turn === n; })[0];
      tl.querySelectorAll('.tl-n').forEach(function (x) { x.classList.toggle('on', x === b); });
      collapseKeep(tlBody, function () {
        tlBody.innerHTML = '<div class="tlb"><div class="tlb-h"><span class="n">T' + d.turn + '</span>' +
          '<span class="t">' + esc(d.title) + '</span></div>' +
          '<div class="cmp"><div><span class="tag">AI 主张</span><p>' + esc(d.aiSide || '') + '</p></div>' +
          '<div class="yes"><span class="tag">你选的</span><p>' + esc(d.choice || '') + '</p></div></div>' +
          nodeBody(d) + '</div>';
        tlBody.classList.add('on');
      });
      reveal(tlBody);
    });
    document.querySelectorAll('#dtabs button').forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll('#dtabs button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        var isFlow = b.dataset.d === 'flow';
        flows.style.display = isFlow ? '' : 'none';
        tl.style.display = isFlow ? 'none' : '';
        tlBody.style.display = isFlow ? 'none' : '';
      };
    });
  }

  /* ---------- 06 规则库 ---------- */
  var GROUPS = ['说话方式', '动手之前', '红线', '交付', '技术'];
  var TGT = {
    dsh: { path: D.paths.dsh, note: '不存在就新建。DSH 每次请求都会先读这一份，之后所有项目自动生效。' },
    agents: { path: D.paths.agents, note: '不存在就新建。遵循 agents 约定的工具（Claude Code、Codex 等）也会读。' },
    project: { path: D.paths.project, note: '只对这个项目生效。放在项目根目录，AI 打开目录时自动带上。' },
    none: { path: '（不写入文件）', note: '只复制到剪贴板，贴到哪里由你决定。' }
  };
  document.getElementById('lib').innerHTML = GROUPS.map(function (g) {
    var rs = D.rules.filter(function (r) { return r.group === g; });
    if (!rs.length) return '';
    return '<div class="lg"><div class="lg-h">' + g + '</div>' + rs.map(function (r) {
      return '<label class="rule"><input type="checkbox" class="rchk" value="' + r.id + '" checked>' +
        '<span class="rid">' + r.id + '</span>' +
        '<div class="rc"><b>' + esc(r.title) + '</b><p>' + esc(r.rule) + ' <em>' + esc(r.why) + '</em></p></div>' +
        '<span class="rev">' + esc(r.ev) + '</span></label>';
    }).join('') + '</div>';
  }).join('');

  function genMd() {
    var sel = {};
    [].forEach.call(document.querySelectorAll('.rchk'), function (c) { if (c.checked) sel[c.value] = 1; });
    var out = ['# 和我协作的默认约定', '', '> 从 ' + D.meta.project + ' 项目 ' + D.totals.turns + ' 轮协作里提炼。贴进 `AGENTS.md` / `CLAUDE.md`，或作为 system prompt 的末尾。', '> 每条都标了它从哪一轮来；没有证据的是从语气里归纳的。'];
    GROUPS.forEach(function (g) {
      var rs = D.rules.filter(function (r) { return r.group === g && sel[r.id]; });
      if (!rs.length) return;
      out.push('', '## ' + g);
      rs.forEach(function (r) { out.push('- **' + r.title + '**：' + r.rule + '  ', '  ' + r.why); });
    });
    return out.join('\n') + '\n';
  }
  function refresh() {
    var boxes = [].slice.call(document.querySelectorAll('.rchk'));
    var n = boxes.filter(function (c) { return c.checked; }).length;
    boxes.forEach(function (c) { c.closest('.rule').classList.toggle('off', !c.checked); });
    document.getElementById('pickcount').textContent = n;
    var m = genMd();
    window.__MD = m;
    document.getElementById('genpre').textContent = m;
    document.getElementById('genmeta').textContent = n + ' 条 · ' + m.replace(/\s/g, '').length + ' 字符';
    var t = TGT[document.querySelector('input[name=tgt]:checked').value];
    document.getElementById('tgtpath').innerHTML = '<b>' + esc(t.path) + '</b><br>' + esc(t.note);
  }
  document.querySelectorAll('.rchk').forEach(function (c) { c.onchange = refresh; });
  document.querySelectorAll('input[name=tgt]').forEach(function (c) { c.onchange = refresh; });
  document.getElementById('selAll').onclick = function () { document.querySelectorAll('.rchk').forEach(function (c) { c.checked = true; }); refresh(); };
  document.getElementById('selNone').onclick = function () { document.querySelectorAll('.rchk').forEach(function (c) { c.checked = false; }); refresh(); };
  document.getElementById('copyGen').onclick = function () {
    var btn = this, old = btn.textContent;
    var done = function () { btn.textContent = '已复制'; setTimeout(function () { btn.textContent = old; }, 1500); };
    var fb = function () {
      var ta = document.createElement('textarea');
      ta.value = window.__MD; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = '复制失败，请手动选'; }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(window.__MD).then(done).catch(fb);
    else fb();
  };
  document.getElementById('dlGen').onclick = function () {
    var blob = new Blob([window.__MD], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'AGENTS.md';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  };
  refresh();
  revealAll();
})();

/* ---- 侧边定位导航：滚动高亮 + 点击跳转 ---- */
(function () {
  var secs = [].filter.call(document.querySelectorAll('section[id]'), function (s) {
    return s.querySelector('.h2 h2');
  });
  if (secs.length < 3) return;
  var rail = document.createElement('nav');
  rail.className = 'rail';
  rail.setAttribute('aria-label', '章节导航');
  rail.innerHTML = secs.map(function (s) {
    var h = s.querySelector('.h2 h2');
    var ix = s.querySelector('.h2 .idx');
    return '<a href="#' + s.id + '" data-i="' + secs.indexOf(s) + '" title="' + (ix ? ix.textContent + ' ' : '') + h.textContent + '"><span>'
      + h.textContent + '</span></a>';
  }).join('');
  document.body.appendChild(rail);

  var links = [].slice.call(rail.querySelectorAll('a'));
  var cur = -1;
  function mark(i) {
    if (i === cur) return;
    cur = i;
    links.forEach(function (a, k) { a.classList.toggle('on', k === i); });
  }
  function tops() {
    return secs.map(function (s) { return s.getBoundingClientRect().top + window.scrollY; });
  }
  function spy() {
    var y = window.scrollY + Math.round(window.innerHeight * 0.32);
    var t = tops(), i = 0;
    for (var k = 0; k < t.length; k++) if (t[k] <= y) i = k;
    mark(i);
  }
  var tick = false;
  window.addEventListener('scroll', function () {
    if (tick) return;
    tick = true;
    requestAnimationFrame(function () { tick = false; spy(); });
  }, { passive: true });
  window.addEventListener('resize', spy);
  links.forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var s = secs[+a.dataset.i];
      var y = s.getBoundingClientRect().top + window.scrollY - 24;
      window.scrollTo({ top: y, behavior: 'smooth' });
      mark(+a.dataset.i);
      history.replaceState(null, '', '#' + s.id);
    });
  });
  spy();
})();