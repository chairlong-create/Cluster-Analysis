# 项目交接文档 2026-03-29

这份文档面向下一个会话或后续维护者。目标只有一个：快速接上当前真实状态，不重复踩坑。

## 0. 2026-04-10 补充：线上访问常见问题

### 浏览器代理插件导致 ERR_TOO_MANY_REDIRECTS

**现象：** 通过公网 IP（HTTP）访问时，非无痕模式下控制台大量报 `net::ERR_TOO_MANY_REDIRECTS`，静态资源（JS/CSS/favicon）全部加载失败，但无痕模式完全正常。

**根因：** 浏览器安装了代理插件（VPN/Proxy 扩展）。代理插件拦截 HTTP 请求并尝试走代理或强制 HTTPS，与服务端的 HTTP 响应形成重定向循环。无痕模式默认禁用扩展，所以不受影响。

**解决方法：** 关闭浏览器代理插件，或将服务器地址加入代理的白名单/直连列表。

**排查思路（供后续类似问题参考）：**

1. 如果无痕正常、非无痕报错 → 先排除 Cookie/缓存（清除站点数据）
2. 清除站点数据后仍报错 → 不是服务端问题，是浏览器扩展干扰
3. `chrome://extensions/` 逐个禁用排查

### Middleware 加固（同次修复）

本次同时对 middleware 做了两项加固：

1. **添加 `config.matcher`：** 通过 Next.js 框架级配置排除 `_next/static`、`_next/image`、`favicon.ico`，确保 middleware 永远不会拦截静态资源
2. **`getCurrentUser()` 清除无效 Cookie：** auth 验证失败时，先删除过期/无效的 session cookie 再重定向到 `/login`，防止"middleware 放行但服务端拒绝"的循环

相关文件：

- `src/middleware.ts`
- `src/lib/current-user.ts`

## 0. 2026-04-02 补充结论：多用户认证与线上部署

本次会话完成了从"本地单用户工具"到"多用户线上部署"的架构升级。分支 `feature/multi-user-auth`，46 个文件，+1264 -118。

### 0.0.1 新增能力

1. **认证系统**：NextAuth.js v5 + Credentials Provider，JWT session，登录页 `/login`
2. **多用户数据隔离**：`users` 表、`tasks.user_id`、`app_settings` 改为 `(user_id, key)` 复合主键
3. **每用户配置**：LLM API Key、模型、并发、Prompt 均为用户级，互不干扰
4. **管理面板**：`/admin` 页面，admin 角色可创建用户、重置密码、删除用户
5. **Docker 部署**：多阶段构建 Dockerfile + docker-compose.yml，SQLite 数据挂载 volume

### 0.0.2 架构变更要点

**设置传递链路重构（最大的架构变更）：**

原来 LLM 模块内部直接调 `getAppSettings()` / `getPromptSettings()` 读全局配置。多用户后这些函数需要 `userId`，而后台任务（setTimeout / after）中 auth 上下文已丢失。

新链路：
```
server action / API route
  → getCurrentUser() 获取 userId
  → getAppSettings(userId) + getPromptSettings(userId)  // 提前捕获
  → service function(taskId, batchId, settings, promptSettings)
    → LLM function(request, settings, promptSettings)
```

所有 service 函数和 LLM 函数的签名都已加 `settings` / `promptSettings` 参数。

**数据隔离方式：**

- 所有数据通过 `task_id` 外键关联，只在 `tasks` 表加 `user_id`
- 所有 server actions（20+）顶部调 `getCurrentUser()` + `assertTaskOwnership()`
- 所有 API routes（9 个）加 auth 检查 + ownership 检查
- 所有页面查询加 `WHERE user_id = ?`

**Middleware 限制：**

Next.js middleware 运行在 Edge Runtime，不支持 `better-sqlite3` 原生模块。当前 middleware 只检查 session cookie 是否存在（轻量），实际 JWT 验证和用户信息获取由 server 端 `auth()` 完成。

### 0.0.3 数据库迁移

首次启动时自动执行：
- 创建 `users` 表
- `tasks` 加 `user_id` 列（nullable，兼容旧数据）
- `app_settings` 从 `key` 主键迁移到 `(user_id, key)` 复合主键
- 自动种子 admin 用户（密码由 `ADMIN_PASSWORD` 环境变量控制，默认 `admin123`）
- 旧数据中 `tasks.user_id IS NULL` 的记录归入 admin
- 旧 `app_settings` 数据迁移到 admin 名下
- SQLite 新增 `busy_timeout = 5000` 应对多用户写冲突

### 0.0.4 部署方式

**Docker 部署（推荐）：**
```bash
git clone https://github.com/chairlong-create/Cluster-Analysis.git
cd Cluster-Analysis && git checkout feature/multi-user-auth
cp .env.production.example .env.production
# 编辑 .env.production：修改 AUTH_SECRET 和 ADMIN_PASSWORD
docker compose --env-file .env.production up -d --build
```

访问 `http://服务器IP:3000`，admin / admin123 登录。

**服务器推荐配置：** 2核4G Ubuntu，50-100 元/月。

### 0.0.5 当前操作约束

- 默认管理员 `admin` / `admin123`，部署后**必须修改密码**
- `AUTH_SECRET` 必须设为随机字符串（至少 32 字符），否则 JWT 不安全
- SQLite 仍是单文件数据库，<20 用户场景够用，不需要换 PostgreSQL
- 前后端仍在同一个 Next.js 进程里（未拆分），如遇性能瓶颈优先考虑抽 worker 进程
- `.env` 文件包含敏感信息，不要提交到 git

### 0.0.6 关键新文件

| 文件 | 用途 |
|------|------|
| `src/lib/auth.ts` | NextAuth 配置 |
| `src/lib/current-user.ts` | getCurrentUser / requireAdmin / assertTaskOwnership |
| `src/middleware.ts` | Edge-compatible session cookie 检查 |
| `src/app/login/page.tsx` | 登录页 |
| `src/app/admin/page.tsx` + `actions.ts` | 管理面板 |
| `src/components/sign-out-button.tsx` | 退出登录按钮 |
| `src/types/next-auth.d.ts` | Session/JWT 类型扩展 |
| `Dockerfile` + `docker-compose.yml` | 容器化部署 |
| `.env.production.example` | 生产环境变量模板 |

## 0. 2026-03-31 补充结论

本次会话新增了 4 组需要优先记住的变化：

1. 做了一轮本地性能优化，重点不是“修一个点”，而是同时减轻页面刷新、数据库写入和查询压力。
2. Prompt 配置逻辑已经重构成“参考模板只展示、实际生效 Prompt 才运行”，之前的 `*_user_prompt_template` 不再参与运行。
3. 批量分类现在已经补齐“失败重试”链路，和提取保持一致。
4. 面向同事的部署文档和升级文档已经补齐，README 也有入口，老用户不需要重新安装。

当前最重要的操作约束：

- 同事日常使用尽量走 `npm run build && npm run start`，不要长期用 `npm run dev`
- 看分类日志时，`prompt_text` 现在代表真正生效、且已经带变量渲染后的 system prompt
- 批量分类如果遇到 `limit_burst_rate`，优先走“失败重试”，不要立刻整批重跑
- 当前“并发设置看起来像没生效”的主因更像模型服务商吞吐/限流，而不是代码把并发写成了 1

### 0.1 性能优化现状

已完成的第一轮优化：

- 任务页自动刷新从 2 秒放宽到 8 秒，且页面不在前台时不刷新
- 移除了任务页 render 阶段的 `repairOtherCategoryReferences()` 写数据库动作
- 提取/分类的 `step_runs` 进度写入改为按时间节流，不再每条记录都写一次
- `step_runs`、`step_run_items`、`llm_call_logs`、`dialog_analysis_results` 补了热路径索引
- 部署文档里已经明确建议正式使用走 `build + start`

仍未彻底解决的点：

- 任务执行和页面渲染仍在同一个 Next/Node 进程里
- 当前 LLM 服务商在分类阶段存在高延迟和 `limit_burst_rate`
- 所以“并发设为 10 但体感像 1”更像服务商侧吞吐限制，不是本地代码把并发写坏了

相关文件：

- [/Users/chenlong/vibe coding/Cluster Analysis/src/components/task-live-refresh.tsx](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/components/task-live-refresh.tsx)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/app/tasks/[taskId]/page.tsx](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/app/tasks/%5BtaskId%5D/page.tsx)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/lib/extraction-service.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/extraction-service.ts)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/lib/classification-service.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/classification-service.ts)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/lib/db.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/db.ts)

### 0.2 Prompt 配置逻辑已重构

现在的规则已经不是“双可编辑 Prompt”。

当前真实规则：

- 首页每个环节都分成：
  - `参考模板（只读）`
  - `实际生效 Prompt`
- 参考模板只用于展示，不参与运行
- 用户保存的是：
  - `extraction_system_prompt`
  - `clustering_system_prompt`
  - `classification_system_prompt`
  - `category_merge_system_prompt`
- 运行时真正发给模型的，是这些 `*_system_prompt` 渲染变量后的结果
- 固定的 `user message` 现在是代码内置，不再让用户编辑
- 如果用户从未修改过，实际生效 Prompt 的默认值和参考模板完全相同

影响：

- 数据库里旧的 `*_user_prompt_template` 仍然可能存在，但已经不参与运行
- 分类日志里的 `prompt_text` 现在应理解为“真正生效的 system prompt”，不是旧 user template

相关文件：

- [/Users/chenlong/vibe coding/Cluster Analysis/src/lib/prompt-config.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/prompt-config.ts)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/lib/prompts/extraction.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/prompts/extraction.ts)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/lib/prompts/clustering.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/prompts/clustering.ts)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/lib/prompts/classification.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/prompts/classification.ts)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/lib/prompts/category-merge.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/prompts/category-merge.ts)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/app/page.tsx](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/app/page.tsx)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/app/actions.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/app/actions.ts)

### 0.3 批量分类已补齐“失败重试”

现在分类和提取一致，支持两种按钮语义：

- `重新批量分类`
  - 整批重新过 LLM
- `失败重试`
  - 只把最近一轮 `classify / classify_retry` 里的失败条目重新过一遍

当前设计：

- 新增了 `classify_retry` step type
- 新增了 `/api/tasks/[taskId]/batches/[batchId]/classify/retry-failed`
- 任务页聚合“最新分类状态”时，同时看 `classify` 和 `classify_retry`
- stalled run reconcile 也已经覆盖 `classify_retry`

注意：

- `limit_burst_rate` 这类 HTTP / 服务端限流，当前仍记为失败，只是现在可以单独点“失败重试”
- 这和“模型正常分类到其他”不是一回事，不要混淆

相关文件：

- [/Users/chenlong/vibe coding/Cluster Analysis/src/lib/classification-service.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/classification-service.ts)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/app/api/tasks/[taskId]/batches/[batchId]/classify/route.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/app/api/tasks/%5BtaskId%5D/batches/%5BbatchId%5D/classify/route.ts)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/app/api/tasks/[taskId]/batches/[batchId]/classify/retry-failed/route.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/app/api/tasks/%5BtaskId%5D/batches/%5BbatchId%5D/classify/retry-failed/route.ts)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/components/batch-detail-panel.tsx](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/components/batch-detail-panel.tsx)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/app/tasks/[taskId]/page.tsx](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/app/tasks/%5BtaskId%5D/page.tsx)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/lib/step-run-utils.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/step-run-utils.ts)

### 0.4 文档和 Git 状态

文档方面已经补齐：

- README 已增加“老用户升级”入口
- `docs/同事本地部署说明.md` 已新增“老用户如何升级到最新版”
- 同事更新方式已统一成：
  - `git pull` 或 GitHub Desktop `Pull origin`
  - `npm install`
  - `npm run build`
  - `npm run start`

当前最近提交：

- `ef5d987 Update upgrade guidance docs`
- `a4a6788 做了一波性能优化`

## 0. 2026-03-29 补充结论

本次会话补充了 3 条和稳定性直接相关的结论，后续不要再重复踩坑：

1. 早期“提取失败但日志里没有失败明细”的现象，不代表模型没有报错，而是因为提取失败分支原本存在一个事务未执行的问题，导致失败日志没有落库。
2. 批次提取的后台执行和页面侧 `reconcileStalledStepRuns()` 之间，曾经出现过“run 还活着但被提前收口”的问题；当前已经加了 `last_heartbeat_at` 心跳字段来降低误判。
3. DeepSeek 在提取阶段的主要失败原因，已经确认不是 HTTP 报错，而是模型在 `has_buy_block_reason=false` 时会省略部分字段；如果 Prompt 又要求“不要输出未购买原因字段内容”，就会和代码解析契约冲突。

当前代码层面的处理状态：

- 失败日志已能正常落库
- 提取 run 已有心跳
- 提取解析器已兼容 `false` 分支缺省字段
- 解析失败时会优先保留原始 `response_text` 以便继续排查

当前最重要的操作约束：

- 不要再把“模型问题”和“日志缺失问题”混为一谈
- 看提取失败时，先查 `llm_call_logs.response_text`
- 调 Prompt 时，不要同时写出互相矛盾的规则

## 1. 项目当前状态

项目已经完成可分发的本地 MVP，当前定位是：

- `对话聚类分析工作台`
- 本地单用户 Web 工具
- 支持围绕一个任务持续演进类别体系
- 支持多批次导入、建类、分类、任务级收敛、导出

当前主流程已经能跑通：

- 新建任务
- 一次上传最多 10 个 CSV
- 第一个批次默认建类，后续批次默认直接分类
- 建类批次：信号提取 -> 聚类建议 -> 确认入表 -> 分类
- 直接分类批次：直接按当前类别表分类
- 任务级 `处理全部其他`
- 合并近似类别
- 日志查看
- 任务结果汇总和 CSV 导出

## 2. 当前产品规则

### 2.1 任务

一个任务代表一套独立的分析体系。

任务下包含：

- 多个批次
- 一套任务级类别表
- 当前分析结果
- 过程日志

### 2.2 批次用途

批次有两种用途：

- `seed`
- `classify_only`

默认规则：

- 任务下第一个上传的批次默认 `seed`
- 后续上传的批次默认 `classify_only`
- 用户可以在 Batch Detail 里手动修改批次用途

### 2.3 类别表

类别表是任务级长期资产。

当前入口是 `任务收敛 > Category Snapshot`，不再保留单独的“管理类别”模块。

行内能力：

- 编辑
- 删除
- 新增

特殊规则：

- `其他` 是系统保留类别
- `其他` 只能改定义，不能改名称，不能删除
- 一次只允许一行进入编辑态
- 行内新增/编辑失败时错误直接显示在当前行

### 2.4 删除类别的语义

删除类别不再总是物理删除。

当前规则：

- 如果类别没有命中记录：直接删除
- 如果类别已有命中记录：
  - 这些记录会回流到 `其他`
  - `result_status` 改成 `classified_other`
  - 原类别标记成 `inactive`

这条能力的目的不是普通删除，而是支持：

- 把过于抽象的大类拆回 `其他`
- 再通过 `处理全部其他` 重新拆成更细的类别

## 3. 页面结构

### 3.1 首页

当前首页从上到下：

1. 已有任务
2. 新建任务
3. 模型与并发配置
4. LLM 提示词配置

规则：

- 单列布局
- `新建任务` 仅在任务数为 0 时默认展开
- `模型与并发配置` 默认收起
- `LLM 提示词配置` 默认收起
- 顶部主视觉区现在只保留标题和说明，不再显示任务/批次/对话总数卡片

### 3.2 任务工作台

任务页结构：

- 顶部任务总览
- `批次推进`
- `任务收敛`

`批次推进`：

- 批次表整行可点击
- 会记住上次选中的批次
- 切 Tab / 回日志 / 回首页再进入任务页，都应尽量保留当前批次
- Batch Detail 负责展示当前批次的操作和结果

`任务收敛`：

- Category Snapshot
- 处理全部其他
- 合并近似类别
- 当前任务分析结果

## 4. Batch Detail 当前规则

### 4.1 顶部四步时间线固定

始终显示四步：

1. 导入
2. 信号提取
3. 聚类建议
4. 批量分类

对 `classify_only` 批次：

- 第 2 步固定显示 `跳过`
- 第 3 步固定显示 `跳过`

### 4.2 Latest Result 跟随 Primary Action

右侧 `Latest Result` 不再固定显示分类结果，而是跟当前主动作走：

- 当前在提取：显示提取样例
- 当前在聚类：显示聚类建议
- 当前在分类：显示分类结果

运行中的步骤优先级最高。

### 4.3 建类批次提取后的状态

建类批次完成提取后：

- 左侧操作为：
  - `重新提取`
  - `失败重试`（如果有失败）
  - `下一步`
- `下一步` 只切到第三步待启动界面
- 不会自动发起聚类

### 4.4 聚类建议后的状态

聚类建议生成后，左侧给两种选择：

- `确认建议写入类别表`
- `废弃`

`废弃` 后：

- 当前建议标记废弃
- 批次回到提取完成后的状态

## 5. 任务收敛当前规则

### 5.1 处理全部其他

已经是任务级动作，不再逐批处理 `其他`。

设计原因：

- 避免多个批次各自处理 `其他` 时产生同义不同名类别
- 用统一池子聚类更容易收敛

当前界面展示的是：

- 当前轮次
- 提取状态
- 聚类状态
- 重分状态

不是“各步骤最近一轮”的拼接状态。

### 5.2 处理全部其他的高容错规则

当前规则：

- 如果提取阶段 `partial_success`
- 系统会继续基于当前轮次已经成功落库的提取结果往后走
- 失败项先留在 `其他`

为了避免后台链路在“提取结束 -> 聚类启动前”中断，当前已经加了两层兜底：

1. UI 过渡桥接  
在提取 `partial_success/succeeded` 后、后续 run 还没出现前：
- 仍视为当前轮次运行中
- 按钮保持禁用
- 当前轮次状态继续显示聚类/重分推进中

2. 自动续跑  
如果当前轮次停在：
- 提取完成但没有聚类 run
- 或聚类完成但没有重分 run

页面会自动调用：
- `/api/tasks/[taskId]/iterate/resume`

继续把当前轮次从已落库的成功结果往下接。

相关文件：

- [/Users/chenlong/vibe coding/Cluster Analysis/src/lib/iterate-others-service.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/iterate-others-service.ts)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/app/api/tasks/[taskId]/iterate/resume/route.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/app/tasks/%5BtaskId%5D/iterate/resume/route.ts)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/components/task-iterate-resume.tsx](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/components/task-iterate-resume.tsx)

注意：

- 这已经明显提升容错，但不代表底层“后台串行任务偶发中断”的根因被完全消灭
- 如果新会话继续排查稳定性，这里仍是优先观察点

### 5.3 合并近似类别

当前支持：

- 设定最大合并后类别数
- 生成合并建议
- 确认应用
- 丢弃建议

规则：

- 如果模型漏掉少量类别，系统会优先自动补齐为“原类别保留”
- 仅在补齐后超过上限时才报错
- 按钮当前带 pending 动效

## 6. 模型配置与 Prompt 规则

### 6.1 OpenAI-compatible 接入

当前模型配置统一采用 `OpenAI-compatible` 接口方式。

支持：

- OpenAI 官方兼容接口
- OpenAI-compatible 网关
- MiniMax 兼容端点

配置优先级：

1. 首页保存到数据库的配置
2. `.env`
3. 代码默认值

### 6.2 并发配置

并发分两类：

- `extraction_concurrency`
- `classify_concurrency`

对应关系：

- 信号提取、失败重试、处理全部其他中的重新提取：走 `extraction_concurrency`
- 批量分类、重新分类、处理全部其他中的重分：走 `classify_concurrency`
- 聚类建议、合并近似类别：单次请求，不走并发配置

### 6.3 Prompt 可改，但 JSON key 不能随便改

这是当前非常重要的一条规则：

- Prompt 的分析口径、目标、判断标准、示例都可以改
- 但各步骤返回的结构化 JSON key 目前仍是代码固定契约

以提取阶段为例，当前代码仍要求模型返回固定字段：

```json
{
  "has_buy_block_reason": true,
  "buy_block_reason": "一句话概括提取出的分析摘要",
  "evidence_quote": "直接引用原文",
  "evidence_explanation": "说明为什么这句原文支持该判断",
  "confidence": 0.85
}
```

这些字段名带有早期版本历史痕迹，但代码内部会映射成更通用语义。

结论：

- 可以改 Prompt 内容
- 不要改 JSON key 名

文档已经同步：

- [/Users/chenlong/vibe coding/Cluster Analysis/README.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/README.md)
- [/Users/chenlong/vibe coding/Cluster Analysis/docs/使用手册.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/docs/%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C.md)

## 7. 数据一致性与自愈

### 7.1 已处理过的历史脏数据

已经手工处理过两类历史脏数据：

1. 旧删除逻辑遗留的“记录不再属于任何活跃类别”
2. `category_name_snapshot = '其他'`，但 `category_id` 没挂到活跃“其他”类别的记录

### 7.2 当前已加的数据自愈

为了避免 `其他` 统计再次出现：

- `处理全部其他` 显示 41
- Category Snapshot 的 `其他` 只显示 28

这类口径不一致，现在已加了两层保护：

1. 分类写入时兜底  
如果分类结果是 `其他`，但 provider 没给出正确 `matchedCategoryId`：
- 会强制回落到系统“其他”类别的真实 ID

文件：

- [/Users/chenlong/vibe coding/Cluster Analysis/src/lib/llm/classification.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/llm/classification.ts)

2. 页面加载时轻量自愈  
任务页加载时会执行：
- `repairOtherCategoryReferences(taskId)`

把所有：
- `category_name_snapshot = '其他'`
- 但 `category_id` 没挂到当前活跃“其他”类别

的记录自动补齐。

文件：

- [/Users/chenlong/vibe coding/Cluster Analysis/src/lib/data-integrity.ts](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/lib/data-integrity.ts)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/app/tasks/[taskId]/page.tsx](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/app/tasks/%5BtaskId%5D/page.tsx)

## 8. 当前任务分析结果区域

### 8.1 饼图

当前已经做过这些调整：

- 色块按占比从大到小连续排布
- 引线说明最多显示 6 个类别
- 超出的类别依赖下方列表说明
- 字体比初版更小

但这里仍然是一个相对脆弱区域。

最近这块修过多次，核心文件是：

- [/Users/chenlong/vibe coding/Cluster Analysis/src/components/task-convergence-panel.tsx](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/components/task-convergence-panel.tsx)
- [/Users/chenlong/vibe coding/Cluster Analysis/src/app/tasks/[taskId]/page.tsx](/Users/chenlong/vibe%20coding/Cluster%20Analysis/src/app/tasks/%5BtaskId%5D/page.tsx)

如果新会话继续做视觉修整，建议先人工看图，不要只靠代码推断。

### 8.2 类别样例

底部类别样例已经从“全局最近 20 条”改成：

- 每个类别最多取 2 条
- 优先：
  - 摘要不为空
  - 摘要更完整
  - 更新时间更近

目的：

- 避免大类占满样例名额
- 保证每个类别尽量都有代表性举例

## 9. 日志页当前规则

日志页当前支持：

- 每个 run 的基本信息
- 结构化 item
- LLM 调用日志
- 失败的结构化输出单独高亮
- 失败的 LLM 调用单独高亮
- `未完整落库的失败 case` 单独提醒

最后这一类说明：

- run 计数显示有失败
- 但没有完整落到 `step_run_items` / `llm_call_logs`
- 通常表示执行过程半截中断

## 10. 已知风险 / 未彻底根治的点

### 10.1 任务级“处理全部其他”后台链路偶发中断

虽然已经加了：

- `reconcileStalledStepRuns()`
- 过渡桥接
- 自动续跑

但从最近排查结果看，后台链路仍可能在：

- 提取完成
- 聚类 step run 创建之前

这段出现中断。

当前体验已经从“直接卡死”提升到“会自动尝试续跑”，但如果要进一步压低出错率，这里仍是首要攻坚点。

### 10.2 Prompt / schema 仍有历史命名痕迹

外部 LLM 返回字段名仍保留：

- `has_buy_block_reason`
- `buy_block_reason`

内部虽然已映射成更通用语义，但数据库列名和部分底层变量也还有历史命名。

这是有意保留的兼容层，当前不要轻易大改。

## 11. 新会话接手建议

如果准备在新对话窗口继续，建议这样开场：

1. 先读：
   - [/Users/chenlong/vibe coding/Cluster Analysis/docs/handoff.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/docs/handoff.md)
   - [/Users/chenlong/vibe coding/Cluster Analysis/README.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/README.md)
   - [/Users/chenlong/vibe coding/Cluster Analysis/docs/使用手册.md](/Users/chenlong/vibe%20coding/Cluster%20Analysis/docs/%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C.md)
2. 再接着当前优先问题推进

如果是继续稳态优化，我建议优先级：

1. 继续降低“处理全部其他”后台中断率
2. 让日志页对当前轮次和失败恢复更易读
3. 如果要给同事持续分发，评估是否增加一键初始化或桌面打包

---

最后更新时间：2026-03-29 01:50 CST
