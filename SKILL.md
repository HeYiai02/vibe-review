---
name: vibe-review
description: 把一个项目的 AI 编程会话日志，做成一份能看的复盘——单文件 HTML 报告、PNG 分享卡、Markdown 摘要、metrics.json，以及跨项目档案。当用户问「这个项目我和 AI 是怎么做完的」「哪几轮最值钱」「哪段在返工」「我的习惯是什么」时使用。
---

# Vibe Review

把「我让 AI 写了一个项目」这件事，变成一份有数字、有原话、有处方的复盘。

## 什么时候用

- 项目告一段落，想知道过程和结论，而不是 diff
- 想挑几轮「值得回看的现场」讲给别人听，或做分享素材
- 想从返工里提炼出下次怎么开口
- 想在多个项目之间看自己的习惯

**不适用**：需要逐行代码审查、需要性能分析、需要看 git 历史本身。这个技能只读会话日志。

---

## 1. 数据源

| 来源 | 位置 | 说明 |
|---|---|---|
| DeepSeek Harness | `~/.dsh/sessions/**/session.v4.jsonl.zstd` | 最全，含 todo / 审批 / 后台任务 |
| Claude Code | `~/.claude/projects/<slug>/<sessionId>.jsonl` | 无 todo / 审批 / 后台任务 |

判断「是不是同一个项目」的规则：**同一个 git 仓库就算同一个项目**（从改动文件向上找 `.git`）；找不到 `.git` 时退回「盘符/一级/二级」路径前缀。多个会话只要落在同一个仓库根，就合并成一份报告。

## 2. 四步流水线

```bash
cd <本目录>

# 1) 采集：日志 → project.json
node collect.js <项目短名> <project.json> [--cc]
#   DSH  用短名（会匹配 --e-code-<name>-- 形式的目录），别传绝对路径
#   CC   加 --cc，同时自动从 ~/.claude/projects 找

# 2) 组装：project.json (+ curated.json) → data.json
node build.js <project.json> <data.json> [curated.json]

# 3) 出页面：data.json → 单文件 HTML
DATA=data.json OUTHTML=my-project-review.html node render.js

# 4) 派生：data.json → metrics.json / .md / 两张分享卡
node export.js <data.json> out

# 可选：跨项目档案
node archive.js archive.html a.data.json b.data.json
```

`render.js` 用 `DATA=` 指定输入，不要靠「复制成同目录 data.json」来切换项目——那样并发跑两份报告会互相覆盖。

## 3. 归一化事件模型

所有 reader 都吐同一种形状：`{ __file, time, type, data }`。

| type | 关键字段 |
|---|---|
| `session` | `id`、`cwd` |
| `turn/start` | `turn` |
| `turn/end` | `turn`、`reason.kind` |
| `user/message` | `content[]`、`source.kind`（`human` 才算人说的话） |
| `assistant/message` | `turn`、`usage{input,output,cacheRead,cacheWrite}` |
| `tool/call` | `turn`、`callId`、`name`、`arguments` |
| `tool/result` | `turn`、`toolCallId`、`isError` |
| `compaction/summary` | 压缩点 |
| `todo/write`、`approval/asked`、`approval/decided`、`job/registered`、`job/settled` | **DSH 独有** |

工具名先归一（`Read/Edit/Write/Bash` → `read/edit/write/pwsh`），再进聚合层；否则跨 agent 的图表没法比。

## 4. 能力矩阵与降级

| 能力 | DSH | Claude Code |
|---|---|---|
| 轮次 / 工具 / 报错 / token | ✅ | ✅ |
| 用户原话、AI 回复 | ✅ | ✅（`<ide_selection>` 会去重） |
| 待办、审批、后台任务 | ✅ | ❌ |
| 子代理对话 | 计入主轮次 | 跳过（`isSidechain`） |

缺失的字段**不要补 0 冒充有数据**，在页面上标「该数据源不提供」。

## 5. 叙事是手写的（这是设计，不是缺陷）

脚本能算出全部数字，但算不出「当时你怎么想」。所以：

- `collect.js` / `build.js` 出的 `data.json` **只有实测**；
- 决策、返工、规则这三块由人或模型读了原话之后，写进 `curated.json`；
- `build.js` 再把它并进去。

`curated.json` 契约：

```jsonc
{
  "meta": { "subtitle": "一句话标题，别用首轮原话" },
  "paths": { "dsh": "~/.dsh/AGENTS.md", "agents": "~/.agents/AGENTS.md", "project": "<项目根>/AGENTS.md" },
  "decisions": [{ "at": "<会话短id>:<本会话轮号>", "title": "", "aiSide": "", "choice": "", "cf": "" }],
  "trunkAt": ["<会话>:<轮>"],          // 可选：只标出最关键的几个主干岔路口
  "rework": {
    "cases": [{ "id": "R1", "ats": ["<会话>:<轮>"], "name": "", "tag": "",
                "cause": "", "fix": "", "prompt": "", "repro": "",
                "quotes": [{ "text": "你当时说的原话", "at": "<会话>:<轮>" }] }],
    "contrast": { "name": "", "ats": [] }   // 可选：改了很多轮但不算返工的对照段
  },
  "ask": { "at": "<会话>:<轮>", "q": "", "options": [], "pick": 1, "answer": "" },  // 可选
  "rules": [{ "id": "S1", "group": "说话方式", "title": "", "rule": "", "why": "", "ev": "", "src": "<会话>:<轮>" }]
}
```

字段的硬性要求（缺了页面会缺块或变得很薄）：

| 字段 | 要求 | 缺了会怎样 |
|---|---|---|
| `decisions[].title` | **必填**，一句话说清这个岔路口在选什么 | 决策对照表整段消失（`HAS_DEC` 为假） |
| `decisions[].aiSide` / `.choice` | 必填，左右两列就是它俩 | 只剩标题，看不出选项差异 |
| `decisions[].cf` | 建议填：照 AI 那条走的代价 | 「决策对比」块变空 |
| `decisions[].cfKind` | `fact`（据日志算出来的对比）或 `infer`（另一条路没发生过，是推演）。**建议显式写**；不写则按措辞判：以「若/如果/假如/要是/换作」开头或含「推断/推测」→ `infer`，否则 `fact` | 推演会被当事实展示，页脚那句「推测已标注」就是空话 |
| `trunkAt` | **可选**，页面目前不使用它（渲染的是全部带标题的决策），留着给未来的时间轴/筛选 | 没有影响 |
| `rework.cases[].cause` / `.fix` | 必填 | 「为什么会来回」「下次这样用 AI」两栏会空 |
| `rework.cases[].prompt` / `.repro` | 建议填，只给「完整功能被返工」的案例 | 少了能直接复制的那段话 |
| `rules[].ev` | 必填，指向具体轮次或具体数字 | 规则变成没有证据的口号 |
| `rules[].group` | **必填**，只能是 `说话方式` / `动手之前` / `红线` / `交付` / `技术` 五组之一 | 渲染层按组过滤，组外的规则会**静默消失**，但 `HAS_RULES` 仍为真 |
| `rules[].src` | 建议填锚点 | 体检脚本会给提醒 |
| `rework.cases[].quotes` | 建议填 `[{text, at}]` | 案例里看不到你当时的原话 |
| `ask` | 可选，本项目只有一次结构化提问才填 | 「唯一一次你说了算」块变空 |

锚点用 `会话:轮号`，**不要用全局轮号**——重新采集一次，全局序号就会整体位移，返工统计会算出「7961 分钟」这种荒谬值。

写完 `curated.json` 后先跑 `node build.js <project.json> <data.json> <curated.json>`，
它会打印 `WARN 找不到锚点: …`——有这行就说明锚点写错了，回去改，别继续渲染。

## 6. 产物

```
<project>-review.html     单文件 HTML（侧边导航 / 光谱 / 决策 / 返工 / 规则库 / 教练页）
out/<project>.metrics.json  schema: vibe-review.metrics/1
out/<project>.md            Markdown 摘要，可进 README
out/<project>-card-v.png    1200×1600 竖版分享卡
out/<project>-card-h.png    1600×900 横版分享卡
archive.html                跨项目档案（可选）
```

## 7. 已知边界

- 截断（**以代码为准，2026-11-14 校正**）：`collect.js` **不截**用户原文（本项目最长 9,542 字），AI 回复截到 1500 字。原文全量在日志里。
- 单会话项目不会出现「会话」分段带，退回「工作段」（>3 小时空档切）。
- 0 轮的会话目录（空壳 zstd）会被 `build.js` 从 `sessions` 里剔除，页面按有效会话数写。
- Claude Code 的「轮」= 一次人类输入，和 DSH 的口径一致；但它的 assistant 消息条数不能当轮次用。
- 云端会话（Cursor / 网页版）本地没有日志，拿不到。
- 分享卡是有头无尾的：只放最能打的一个数字，不放结论。

### 7.1 两种时间口径，别混（这是真实踩过的坑）

| 字段 | 含义 | 用在哪 |
|---|---|---|
| `case.spanMin` | 该段首轮到末轮的**墙钟跨度**，含段内空闲 | 卡片右上「跨 46 分钟」 |
| `case.activeMin` | 该段各轮 `dur` 之和，只算真正在跑的时间 | 总汇总「实际动手时间」 |
| `totals.durSum` | 全部轮 `dur` 之和 | 返工占比的**分母** |

`shareMinutes` 必须 = `ΣactiveMin / durSum`。混用会让同一份日志算出 16.2% 和 58.7% 两个差 3.6 倍的「返工时间」。

### 7.2 分享卡：脚本只出 HTML，PNG 要自己转

```bash
"…/msedge.exe" --headless=new --disable-gpu --hide-scrollbars --force-prefers-reduced-motion \
  --window-size=1200,1600 --screenshot=out/<p>-card-v.png file:///…/out/<p>-card-v.html
```
`--force-prefers-reduced-motion` 不能省，否则截到动画中间态。转完读一下 PNG 的宽高确认尺寸。

### 7.3 并发渲染必须隔离目录

`render.js` 默认读 `__dirname/data.json`，但支持 `DATA=<file>` 覆盖。多个 agent 同目录并行时，**不要**复制 `data_xxx.json → data.json`：会互相覆盖。

```bash
DATA=data_<p>.json OUTHTML=<p>-review.html node render.js
```

## 7.5 实现备忘（改代码前先看）

- **数据是压过的**：`render.js` 用 `zlib.gzipSync(...).toString('base64')` 塞进
  `<script id="data" type="application/gzip+base64">`，页面里用 `DecompressionStream('gzip')`
  解压后再注入执行 `app.js`（`app.js` 放在 `type="text/plain"` 里，解压完才运行）。
  首屏从 577 KB 降到 352 KB。改这段时注意：模板字符串里的 `\s` 会被吃掉成 `s`，
  正则必须写成 `\\s`，否则 base64 里的字母 s 被删干净、`atob` 报错。
- **文案只在 `copy.js` 里写一次**：`startLede` / `dayNote` / `cheer` / `topTurns` / `redact` / `brief`
  被报告、分享卡、Markdown 三处共用；不要在任何一份产物里另写一句类似的话。
- **改 UTF-8 源文件只能用 write / edit 工具**，不要用 PowerShell 的 `Get-Content | Set-Content`：
  PS 5.1 会按 ANSI 解码，整份文件变乱码。

## 7.6 双语（`REVIEW_LANG=en`）

- **三层各管一段**：页面骨架（标题、说明、按钮、图例、脚注）走 `i18n/zh.json` + `i18n/en.json`；
  `app.js` 里的动态文案走内联 `TX(zh, en)`（**不要**给 `app.js` 再引一套 JSON，它会被整段内联进页面）；
  叙事（决策标题、返工原因、规则）**不在代码里**，它在 `curated.json` 里——想出英文报告，就写一份
  `curated.en.json`（`demo/` 下有现成对照）。
- **伪元素文案**（`.pick .hint:after`、`.cf.infer .tag::after`）没法走 JS，只能在 `styles.css`
  末尾用 `html[lang="en"] …{content:"…"}` 覆盖，并且必须排在原规则之后。
- **两个坑**：① `i18n/*.json` 存成 UTF-8 **带 BOM** 会让 `JSON.parse` 抛错、整本字典静默变 `{}`，
  页面渲染出 `s5.title` 这种原始 key——`i18n.js` 里已用 `.replace(/^\uFEFF/, '')` 兜底；
  ② `app.js` 里曾用 `L` 当翻译函数名，与 `drawMsgs` 的列表变量 `L` 撞名导致「数组被当函数调用」，
  现在统一叫 `TX`。
- 英文比中文长 1.5 倍：`h1` 用了 `titleSize` 自适应字号，侧边导航会自动折行，其他块都靠 flex 撑开。

## 8. 交付前检查

先跑体检脚本，它会把这些断言全部执行一遍（退出码 1 = 有硬错误）：

```bash
node check.js data.json
```

它检查：轮次加总是否等于 totals、轮号有无重复、时间戳能否解析、会话区间是否首尾相接、
决策/返工锚点是否指到真实存在的轮次、返工占比是否 < 100%、每条规则有没有证据、
正文里有没有明文密码和裸 IP。

剩下靠人眼看的五条：

1. 标题不是首轮原话（首轮常含站点、账号、密码）。
2. `metrics.json` 里的 `rework.shareMinutes` < 100%，不是负数、不是几千。
3. 分享卡的三条「最好的轮」每条都有真实用户原话。
4. HTML 里点开任意一根谱图柱子，详情有内容（空说明转义或数据键错位）。
5. 规则库里每条规则都能指到具体轮次。
6. 截图核对时加 `--force-prefers-reduced-motion`，否则 KPI 数字会停在动画中间（看起来像数据错了）。

脱敏在 `build.js` 里统一做一遍（`turns[].user/ai`、决策、返工原话、规则证据都过 `redact()`），
所以 `data.json` 本身就是可以外发的——不要等到渲染层再补救。
