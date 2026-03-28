# GitHub 发布前检查清单

这个清单面向“准备把仓库上传到 GitHub，并交给同事各自在本地部署”的场景。

## 1. 敏感信息

- 确认 `.env` 没有纳入版本控制
- 确认 API Key 只存在于个人本地 `.env`
- 确认本地数据库文件没有纳入版本控制
- 确认没有把包含真实业务数据的 CSV、截图、日志误提交

## 2. 文档

- `README.md` 已覆盖安装、启动、配置、测试、常见限制
- `docs/使用手册.md` 已覆盖实际操作流程
- `docs/handoff-2026-03-28.md` 已反映当前稳定性结论和已修复问题
- 如果仓库会公开，确认 `docs/` 下的业务材料是否适合公开

## 3. 本地验证

在准备推送前至少运行一次：

```bash
npm install
npm run lint
npm test
```

如果要给同事做首次部署，建议额外跑一次：

```bash
cp .env.example .env
npm run dev
```

并人工确认首页可正常打开。

## 4. Git 仓库准备

- 仓库根目录已有 `.gitignore`
- 确认忽略项覆盖：
  - `node_modules/`
  - `.next/`
  - `.env`
  - `*.db`
  - `*.sqlite`
  - `*.sqlite3`
- 如果当前目录还不是 Git 仓库，先执行：

```bash
git init
git add .
git status
```

重点检查暂存区里是否出现：

- `.env`
- 数据库文件
- 不希望公开的样本数据
- 不希望公开的业务文档

## 5. 推荐首批提交内容

建议首批提交至少包含：

- 源码
- `.env.example`
- `README.md`
- `docs/使用手册.md`
- `docs/handoff-2026-03-28.md`
- 基础测试

## 6. 建议同事的本地使用方式

- 每个人使用自己的 `.env`
- 每个人使用自己的 `DATABASE_FILE`
- 不共享 SQLite 文件
- 先用小样本跑通，再上正式数据
