# 技术栈与工具
- 桌面：Wails v3；后端：Go。
- 前端：Vite + TypeScript；3D：Babylon.js 9.x + babylon-mmd；测试：Vitest/Playwright。
- 包管理：npm。根目录与 `frontend/` 各有 TypeScript 依赖，前端类型检查必须在 `frontend/` 使用本地 TypeScript。
- Serena：Windows 本机通过 `uv tool install -p 3.13 serena-agent` 安装；项目启动参数在 `.mcp.json`。
- Context7：由项目/Reasonix MCP 配置提供，使用 `@upstash/context7-mcp`。