# 对话聚类分析工作台

一个本地运行的单用户 Web 工具，用来把业务对话中的开放式分析流程结构化，沉淀任务级类别体系，并输出可汇总、可导出的结构化结果。

这个仓库适合直接发给同事各自在本地部署和使用，不依赖云端数据库，也不要求统一的在线服务。

当前已经跑通的主流程：

- 上传一个或多个 CSV 批次
- 对建类批次做信号提取
- 基于提取结果生成聚类建议
- 人工确认建议，写入正式类别表
- 用当前类别表对后续批次做批量分类
- 任务级处理 `其他`
- 合并近似类别
- 查看任务汇总并导出 CSV

## 适用场景

这不是只面向单一销售归因场景的小工具。当前版本已经支持更通用的对话分析场景，例如：

- 分析客户未成交的关键阻碍
- 分析客户认可服务的方面
- 分析客户持续报名或续费的动因
- 分析高频问题、投诉主题、需求模式

你可以通过任务分析目标和 Prompt 配置，把它适配到不同业务语境。

## 技术栈

- `Next.js 16`
- `React 19`
- `TypeScript`
- `better-sqlite3`
- 本地 SQLite 文件持久化

## 运行要求

- Node.js 24+ 推荐
- npm 11+ 推荐
- macOS / Linux / Windows 都可本地运行

如果本机还没有安装 Node.js / npm：

- 去 [nodejs.org](https://nodejs.org/) 下载并安装最新 `LTS`
- 安装 Node.js 时，npm 会一起安装，不需要单独再装
- 安装完成后，用 `node -v` 和 `npm -v` 确认版本

如果你只是想把项目跑起来，而不是自己折腾技术细节，优先看：

- [docs/同事本地部署说明.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/docs/%E5%90%8C%E4%BA%8B%E6%9C%AC%E5%9C%B0%E9%83%A8%E7%BD%B2%E8%AF%B4%E6%98%8E.md)

如果你已经装过旧版本，只是想升级到最新版，也直接看这份文档里的“老用户如何升级到最新版”章节。

## 快速开始

如果你是第一次接触这个项目，建议分两种情况：

- 小白部署：直接看 [docs/同事本地部署说明.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/docs/%E5%90%8C%E4%BA%8B%E6%9C%AC%E5%9C%B0%E9%83%A8%E7%BD%B2%E8%AF%B4%E6%98%8E.md)
- 开发者本地运行：按下面步骤

1. 安装依赖

```bash
npm install
```

2. 如需自定义本地数据库或默认模型，再修改 `.env`

最少通常只需要配置：

- `DATABASE_FILE`

模型 API Key、Base URL、Model 名称，优先建议在工具前端页面里配置。  
`.env` 更适合做本机默认值或高级配置。

如果只想演示流程，不接真实模型，也可以不填 API Key，系统会自动走 mock 模式。

3. 安装后做一次基础检查

```bash
npm run lint
npm test
```

4. 启动开发环境

```bash
npm run dev
```

5. 打开浏览器

```text
http://localhost:3000
```

6. 进入首页后，在前端页面里配置：

- 模型供应商对应的 API Key
- Base URL
- Model 名称
- Prompt

## 给普通同事的启动建议

如果是你同事在自己电脑上日常使用，不建议长期用：

```bash
npm run dev
```

因为这是开发模式，执行任务时更容易出现电脑发热、风扇转快、页面卡顿。

更建议使用生产模式：

```bash
npm run build
npm run start
```

然后在浏览器打开：

```text
http://localhost:3000
```

简单理解：

- `npm run dev`：适合开发和改代码
- `npm run start`：更适合同事本地日常使用

## 配置说明

见 [/.env.example](/Users/chenlong/vibe%20coding/Cluster%20Analysis/.env.example)。

说明：

- 首页里的“模型与并发配置”是普通用户最常用的入口
- `.env` 主要用于设置本机默认值、数据库位置和高级参数
- 如果首页和 `.env` 同时配置了同一项，优先以首页保存的值为准

核心配置项：

- `DATABASE_FILE`
- `OPENAI_COMPATIBLE_API_KEY`
- `OPENAI_COMPATIBLE_BASE_URL`
- `OPENAI_COMPATIBLE_MODEL`
- `EXTRACTION_CONCURRENCY`
- `CLASSIFY_CONCURRENCY`

### OpenAI-compatible 接入

当前项目按 `OpenAI-compatible` 接口方式接入模型。

这意味着以下接口都可以接：

- OpenAI 官方兼容接口
- 各类 OpenAI-compatible 网关
- MiniMax 兼容端点

默认回退值：

- `OPENAI_COMPATIBLE_BASE_URL = https://api.minimaxi.com/v1`
- `OPENAI_COMPATIBLE_MODEL = MiniMax-M2.5`

旧的 `MINIMAX_*` 环境变量仍然兼容，但新配置统一建议使用 `OPENAI_COMPATIBLE_*`。

### 模型与并发配置优先级

项目里实际生效的模型和并发配置，遵循下面这个优先级：

1. 首页“模型与并发配置”里保存到数据库的值
2. `.env` 里的环境变量
3. 代码默认值

当前并发分成两类：

- `EXTRACTION_CONCURRENCY`
  - 控制批次信号提取
  - 控制信号提取失败重试
  - 控制“处理全部其他”里的重新提取
- `CLASSIFY_CONCURRENCY`
  - 控制批量分类
  - 控制重新批量分类
  - 控制“处理全部其他”里的重新分类

以下两个步骤当前是单次请求，不走并发配置：

- 聚类建议
- 合并近似类别

修改 `.env` 后需要重启 `npm run dev`。  
如果是在首页配置页修改的，则保存后直接生效。

## Prompt 配置

首页现在分成两部分：

- `参考模板`
  只用于展示和提示用户怎么写，不会被代码直接使用
- `实际生效 Prompt`
  这是用户真正保存和修改的内容，运行时会实际生效

如果用户从未修改过，实际生效 Prompt 的默认值与参考模板相同。

注意：

- 当前支持自由调整实际生效 Prompt 的语义、任务目标描述、判断口径和示例。
- 但各个 LLM 环节返回的结构化 JSON key 目前仍是代码固定契约，不支持按任务自定义字段名。
- 这意味着你可以改“让模型分析什么”，但不要改“返回字段叫什么”。
- 如果改动了返回 key，当前代码会解析失败或出现不完整结果。

运行时逻辑：

- 用户配置的 `*_system_prompt` 会作为真正生效的 Prompt，并在发送前按变量渲染
- 页面上的参考模板不会直接参与运行
- 模型请求里的 `user message` 是代码固定的提示语，不由用户编辑

相关代码位置：

- 提取 Prompt：[/src/lib/prompts/extraction.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/prompts/extraction.ts)
- 聚类 Prompt：[/src/lib/prompts/clustering.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/prompts/clustering.ts)
- 分类 Prompt：[/src/lib/prompts/classification.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/prompts/classification.ts)
- 近似类别合并 Prompt：[/src/lib/prompts/category-merge.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/prompts/category-merge.ts)

当前支持的模板变量包括：

- `{{analysis_goal}}`
- `{{analysis_focus_label}}`
- `{{dialog_id}}`
- `{{dialog_text}}`
- `{{reasons_list}}`
- `{{category_list}}`
- `{{extracted_reason}}`
- `{{max_target_count}}`
- `{{merge_category_list}}`

### 提取阶段的固定 JSON 契约

提取 Prompt 当前必须返回这组固定 key：

```json
{
  "has_buy_block_reason": true,
  "buy_block_reason": "一句话概括提取出的分析摘要",
  "evidence_quote": "直接引用原文",
  "evidence_explanation": "说明为什么这句原文支持该判断",
  "confidence": 0.85
}
```

说明：

- 字段名虽然还保留了早期版本的命名历史，但代码内部会把它映射成更通用的语义。
- 因此当前阶段可以修改字段内容表达，但不要修改字段名本身。
- 当 `has_buy_block_reason=false` 时，`buy_block_reason`、`evidence_quote`、`evidence_explanation`、`confidence` 当前允许返回空字符串或省略；为了兼容更多模型，推荐直接返回空字符串和 `0`。
- 分类、聚类、近似类别合并这几个环节也各自有固定的结构化输出契约，不建议在 Prompt 里改 key 名。

## 当前能力

### 首页

- 查看已有任务
- 新建任务
- 配置模型与并发
- 配置 LLM Prompt

### 任务工作台

- 顶部任务总览
- `批次推进`
  - 批次列表
  - Batch Detail
  - 上传 CSV 批次
- `任务收敛`
  - Category Snapshot
  - 行内类别管理
  - 处理全部其他
  - 合并近似类别
  - 汇总展示与导出

### 数据导入

- 上传 UTF-8 CSV
- 默认按第 1 列读取 `id`
- 默认按第 2 列读取 `text`
- 一次最多上传 10 个 CSV
- 任务内按对话内容去重

### 分类工作流

- 建类批次 `seed`
  - 先提取信号
  - 再生成聚类建议
  - 确认入表后再分类
- 直接分类批次 `classify_only`
  - 直接使用当前类别表分类

### 日志与调试

- 查看 `step_runs`
- 查看 `step_run_items`
- 查看 `llm_call_logs`
- 失败项单独高亮
- 未完整落库的失败 case 单独提醒

## 导出字段

当前任务导出路由：

```text
/tasks/:taskId/export
```

导出字段：

- `batch_file`
- `source_dialog_id`
- `text`
- `analysis_summary`
- `category`
- `evidence_quote`
- `evidence_explanation`
- `result_status`

## 目录说明

```text
src/app
  页面、server actions、上传接口、导出路由

src/components
  工作台组件、表格、交互控件

src/lib
  SQLite 数据层、LLM provider、流程 service、导出工具、配置读取

docs
  PRD、交接文档、使用手册

csv_splits
  本地样本 CSV
```

## 上传到 GitHub 前建议

建议至少完成下面这些检查：

1. 确认 `.env` 没有被提交，仓库里只保留 `.env.example`
2. 确认本地数据库文件没有被提交
3. 运行

```bash
npm run lint
npm test
```

4. 检查 `README.md`、[docs/使用手册.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/docs/%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C.md)、[docs/handoff.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/docs/handoff.md)
5. 决定是否公开 `csv_splits/`、`docs/` 下的业务资料和复盘文件

更细的发布检查见 [docs/github-release-checklist.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/docs/github-release-checklist.md)。

## 推荐阅读顺序

如果你是第一次接手这个项目，建议按下面顺序看：

1. [README.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/README.md)
2. 如果是零基础同事，先看 [docs/同事本地部署说明.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/docs/%E5%90%8C%E4%BA%8B%E6%9C%AC%E5%9C%B0%E9%83%A8%E7%BD%B2%E8%AF%B4%E6%98%8E.md)
3. 再看 [docs/使用手册.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/docs/%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C.md)
4. 需要理解需求背景时，再看 [docs/PRD.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/docs/PRD.md)
5. 需要理解历史决策和问题排查时，再看 [docs/handoff.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/docs/handoff.md)

## 已知限制

- 当前是本地单用户工具，不支持登录和多人协作
- 数据库存储为本地 SQLite，不适合多机共享
- 聚类建议和近似类别合并仍依赖模型输出质量
- 不同 OpenAI-compatible 模型对 JSON 输出稳定性差异较大，提取 Prompt 尤其要避免自相矛盾的字段要求
- DeepSeek 这类模型在高并发下即使不报 HTTP 错，也可能出现字段缺失，因此日志排查时要同时看原始 `response_text` 和解析错误

## 给同事分发时的建议

- 直接把仓库地址和这份说明发给同事：[docs/同事本地部署说明.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/docs/%E5%90%8C%E4%BA%8B%E6%9C%AC%E5%9C%B0%E9%83%A8%E7%BD%B2%E8%AF%B4%E6%98%8E.md)
- 如果对方已经装过旧版本，提醒他直接看这份说明里的“老用户如何升级到最新版”
- 明确告诉同事本机建议版本：`Node.js 24+`、`npm 11+`
- 不要共享你的 `.env`
- 让每位同事在工具前端页面里填写自己的 API Key、Base URL 和 Model
- 建议每位同事单独设置自己的 `DATABASE_FILE`
- 如果对方是零基础，不要先让他看 `.env.example`，先让他按部署说明把网页跑起来
- 首次启动前先跑 `npm install && npm run lint && npm test`
- 首次使用前，先让同事看一遍 [docs/使用手册.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/docs/%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C.md)
