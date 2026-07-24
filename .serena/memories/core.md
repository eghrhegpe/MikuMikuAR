# 项目地图与不变量
- 根目录：Go/Wails 后端、脚本、ADR/知识库；`frontend/` 是 Vite + TypeScript + Babylon.js 主应用；`internal/` 放 Go 后端实现。
- 代码事实优先级：当前源码 > `docs/adr/` > `docs/knowledge/` > 架构/函数索引文档。
- 前端模块变更先读 `frontend/AGENTS.md`；Go 变更先读 `internal/AGENTS.md`。
- 项目级 MCP 配置：`.mcp.json`；Serena 项目配置：`.serena/project.yml`；本机 `reasonix.toml` 不提交。
- 相关记忆：前端细节见 `mem:frontend/core`；技术版本见 `mem:tech_stack`；完成门槛见 `mem:task_completion`。