# 完成验证门槛
- 前端改动至少运行：`cd frontend && npm run check`、相关 Vitest；重要改动再运行 `cd frontend && npm run build`。
- Go 改动运行：`go build ./...`。
- 文档/ADR 改动运行：`npm run check:docs`；函数签名或导出变化运行：`npm run check:funcmap`。
- 提交前运行 `git status --short`、`git diff --check`，确认只包含预期文件。