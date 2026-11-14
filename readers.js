// 事件读取层：把不同 agent 的原始日志，统一成同一套 vibe-events。
// 输出事件形状（与 collect.js 的聚合逻辑约定一致）：
//   { __file, time, type, data }
//   type: turn/start | turn/end | step/start | user/message | assistant/message
//         | tool/call | tool/result | compaction/summary
// 新增一个 agent = 在这里加一个 read 函数，聚合层不用动。

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------- DSH ----------------
// 默认读 ~/.dsh/sessions；换机器/换目录时用 DSH_SESSIONS 覆盖
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const DSH_SESSIONS = process.env.DSH_SESSIONS || path.join(HOME, '.dsh', 'sessions');

function walk(dir, acc, suffix) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc, suffix);
    else if (e.name.endsWith(suffix)) acc.push(p);
  }
  return acc;
}

function readDSH(project) {
  const files = walk(DSH_SESSIONS, [], '.jsonl.zstd')
    .filter(f => f.toLowerCase().includes('--e-code-' + String(project).toLowerCase() + '--'));
  if (!files.length) throw new Error('no DSH session for project ' + project);
  const all = [];
  for (const f of files) {
    const text = zlib.zstdDecompressSync(fs.readFileSync(f)).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
      ev.__file = path.basename(path.dirname(f));
      all.push(ev);
    }
  }
  return { events: all, files };
}

// ---------------- Claude Code ----------------
// 日志：C:\Users\Administrator\.claude\projects\<slug>\<sessionId>.jsonl
// 每条：{type:'user'|'assistant'|'system', message:{content:[...], usage?}, timestamp, cwd, sessionId, turnPosition}
const CC_ROOT = 'C:\\Users\\Administrator\\.claude\\projects';

// CC 的工具名 → 归一化名（下游只认 edit/write/pwsh 这几个来做统计）
const CC_TOOL = {
  Read: 'read', Edit: 'edit', Write: 'write', Bash: 'pwsh', PowerShell: 'pwsh',
  Grep: 'grep', Glob: 'glob', Task: 'task', WebFetch: 'web_fetch', WebSearch: 'web_search',
  NotebookEdit: 'edit', MultiEdit: 'edit', TodoWrite: 'todo_write', BashOutput: 'job_output', KillShell: 'job_kill',
  AskUserQuestion: 'ask_user_question', ExitPlanMode: 'exit_plan_mode', EnterPlanMode: 'enter_plan_mode',
  ToolSearch: 'tool_search', TaskStop: 'task_stop', TaskOutput: 'job_output', SlashCommand: 'slash_command',
};

function ccText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(c => c && (c.type === 'text' || c.type === 'text_delta')).map(c => c.text || '').join('\n');
}

function ccStripIde(text) {
  // 用户在 IDE 里选中代码时，CC 会把选区作为第一个 text block 塞进来，重复一遍正文
  let t = text || '';
  if (t.startsWith('<ide_selection>')) {
    const end = t.indexOf('</ide_selection>');
    if (end > 0) t = t.slice(end + '</ide_selection>'.length);
  }
  return t.trim();
}

function readCC(project) {
  const dirs = fs.existsSync(CC_ROOT) ? fs.readdirSync(CC_ROOT, { withFileTypes: true }).filter(d => d.isDirectory()) : [];
  const want = String(project).toLowerCase().replace(/[_\s]+/g, '-');
  const picked = [];
  for (const d of dirs) {
    const slug = d.name.toLowerCase();
    if (!slug.includes(want) && !slug.includes(want.replace(/-/g, ''))) continue;
    const dir = path.join(CC_ROOT, d.name);
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) picked.push(path.join(dir, f));
  }
  if (!picked.length) throw new Error('no Claude Code session for project ' + project);

  const events = [];
  const files = [];
  for (const f of picked) {
    files.push(f);
    const sid = path.basename(f, '.jsonl').slice(0, 8);
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    let curTurn = 0;         // 会话内轮号（用 turnPosition.turnIndex，缺省自增）
    let turnMax = 0;         // 当前轮里最大的时间戳，用来补 turn/end
    let started = new Set();
    const flushEnd = () => {
      if (curTurn && turnMax) events.push({ __file: sid, time: turnMax, type: 'turn/end', data: { turn: curTurn, reason: { kind: 'completed' } } });
    };
    for (const line of lines) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch (e) { continue; }
      if (o.isSidechain) continue;                       // 子代理的支线不并进主线
      const time = o.timestamp ? new Date(o.timestamp).getTime() : 0;
      const tp = o.turnPosition || {};
      const local = tp.turnIndex || tp.promptIndex || 0;
      const startTurn = (n) => {
        if (!n || started.has(n)) { if (n) curTurn = n; return; }
        // 换轮：先给上一轮收尾
        flushEnd();
        curTurn = n; turnMax = 0; started.add(n);
        events.push({ __file: sid, time, type: 'turn/start', data: { turn: n } });
      };

      if (o.type === 'user' && o.message) {
        const blocks = Array.isArray(o.message.content) ? o.message.content : [];
        const toolResults = blocks.filter(b => b && b.type === 'tool_result');
        if (toolResults.length) {
          for (const b of toolResults) {
            const txt = typeof b.content === 'string' ? b.content : ccText(b.content);
            events.push({
              __file: sid, time, type: 'tool/result',
              data: { turn: curTurn, message: { toolCallId: b.tool_use_id, content: [{ type: 'text', text: txt }], isError: !!b.is_error } }
            });
          }
          if (time > turnMax) turnMax = time;
          continue;
        }
        const human = (o.origin && o.origin.kind === 'human') || o.turnOrigin === 'human' || !tp.turnIndex;
        if (!human) continue;
        const txt = ccStripIde(ccText(blocks));
        if (!txt) continue;
        startTurn(local);
        events.push({ __file: sid, time, type: 'user/message', data: { turn: curTurn, content: [{ type: 'text', text: txt }] } });
        if (time > turnMax) turnMax = time;
        continue;
      }

      if (o.type === 'assistant' && o.message) {
        if (!curTurn) continue;
        const blocks = Array.isArray(o.message.content) ? o.message.content : [];
        const u = o.message.usage || {};
        const content = [];
        for (const b of blocks) {
          if (!b) continue;
          if (b.type === 'thinking') content.push({ type: 'reasoning', text: b.thinking || '' });
          else if (b.type === 'text' && b.text) content.push({ type: 'text', text: b.text });
        }
        events.push({ __file: sid, time, type: 'step/start', data: { turn: curTurn } });
        events.push({
          __file: sid, time, type: 'assistant/message',
          data: {
            turn: curTurn, usage: {
              inputTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0,
              cacheReadTokens: u.cache_read_input_tokens || 0, cacheWriteTokens: u.cache_creation_input_tokens || 0
            },
            message: { role: 'assistant', content }
          }
        });
        for (const b of blocks) {
          if (!b || b.type !== 'tool_use') continue;
          events.push({
            __file: sid, time, type: 'tool/call',
            data: {
              turn: curTurn, callId: b.id, name: CC_TOOL[b.name] || String(b.name || '').toLowerCase(),
              arguments: JSON.stringify(b.input || {})
            }
          });
        }
        if (time > turnMax) turnMax = time;
        continue;
      }

      if (o.type === 'system' && o.subtype === 'compact_boundary') {
        if (!curTurn) continue;
        events.push({ __file: sid, time, type: 'compaction/summary', data: { turn: curTurn, summary: [{ type: 'text', text: 'compact' }] } });
      }
    }
    flushEnd();
  }
  return { events, files };
}

module.exports = { readDSH, readCC, walk };
