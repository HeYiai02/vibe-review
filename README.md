# vibe review

把你的 AI 编码记录（Claude Code / DeepSeek Harness / 任意 `vibe-events` JSONL）读成一份**单页 HTML 复盘报告**：
这一轮该不该拆、哪段在返工、你习惯怎么下指令、下次怎么开口。

不是看板，不是 token 统计器。**六段里只有实测数字，叙事部分读你的原话写。**

## 快速开始

```bash
git clone <repo> && cd vibe-review

# 1. 采集（DSH 传项目短名；Claude Code 加 --cc）
node collect.js my-project project.json
node collect.js my-project project.json --cc

# 2. 手写叙事（决策 / 返工 / 规则），见「curated.json」
$EDITOR curated.json

# 3. 合并 + 渲染
node build.js project.json data.json curated.json
DATA=data.json OUTHTML=my-project-review.html node render.js

# 4. 体检
node check.js data.json

# 5. 派生产物（Markdown / metrics.json / 分享卡 HTML）
node export.js data.json out
```

没有日志也能先看效果：

```bash
node demo/make-demo.js
node build.js demo/project.json demo/data.json demo/curated.json
DATA=demo/data.json OUTHTML=demo/demo-review.html node render.js
node check.js demo/data.json
```

`demo/demo-review.html` 是一份 12 轮、完全虚构的项目（一个卖咖啡豆的小站），
六段齐全，可以直接打开看。

## 四步流水线

| 步骤 | 脚本 | 产出 |
|---|---|---|
| 采集 | `collect.js` + `readers.js` | `project.json`（只有实测：轮次、工具、报错、文件、token） |
| 合并 | `build.js` | `data.json`（实测 + 你写的叙事，锚点解析在这里） |
| 渲染 | `render.js` | `<project>-review.html`（单文件，gzip 内联数据，可离线打开） |
| 派生 | `export.js` | `out/*.md`、`out/*.metrics.json`、`out/*-card-{v,h}.html` |

`check.js` 是体检：轮次自洽、会话区间、锚点存在、返工占比、明文密码与裸 IP。

## 数据源

| 来源 | 怎么读 | 轮的定义 |
|---|---|---|
| DeepSeek Harness | `node collect.js <短名> out.json` | 一次人类输入 |
| Claude Code | `node collect.js <短名> out.json --cc` | 一次人类输入 |
| 其它 | `node collect.js --events <file.jsonl>` | 你按 `vibe-events` 事件模型自己导出 |

**同一 git 仓库 = 同一个项目**。采集时按文件路径向上找 `.git` 归属，
所以一个「项目」可以由多个会话、多个 agent 拼起来。

口径差比格式差更麻烦：Claude Code 的 assistant 消息条数**不是**轮次；
OpenAI 系把 cached token 算进 input，Anthropic 单列 `cache_read_input_tokens`。
报告里只用「一次人类输入」当轮，token 只统计 output。

## 叙事是手写的（这是设计，不是缺陷）

脚本算得出数字，算不出「当时你怎么想」。所以决策、返工、规则三块由你（或模型读了原话后）写进 `curated.json`。
契约、字段表、锚点规则见 **[SKILL.md](SKILL.md)**。

## 已知边界

- 用户原文不截断（最长见过 9,542 字），AI 回复截到 1500 字；原文全量在日志里。
- 云端会话（Cursor / 网页版）本地没有日志，拿不到。
- 单会话项目不显示「会话」分段带，退回「工作段」（>3 小时空档切开）。
- 分享卡脚本只出 HTML，PNG 要自己转（SKILL.md §7.2 有命令）。
- 决策对比分「据日志的事实」和「推演」，后者在页面上是虚线紫色，Markdown 里标 `†`。

## 许可

MIT
