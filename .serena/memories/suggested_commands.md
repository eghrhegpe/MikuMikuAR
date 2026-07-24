# 常用命令（Windows 项目）
- 前端类型检查：`cd frontend && npm run check`
- 前端全量单测：`cd frontend && npm run test`
- 前端构建：`cd frontend && npm run build`
- Go 构建：`go build ./...`
- 文档漂移检查：`npm run check:docs`（根目录）
- 函数索引检查：`npm run check:funcmap`（根目录）
- Serena 项目记忆检查：`serena memories check`（根目录）
- Windows 下 Serena 若未在当前 shell PATH：`C:\Users\<user>\.local\bin\serena.exe`；本项目配置使用 `command: "serena"`，重启 shell/IDE 后生效。