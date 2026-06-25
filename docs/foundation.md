# 🏛️ 项目地基

> 以下决策是 **MikuMikuAR 的项目地基**。AI 代理不得自行修改。
> 如需调整其中任一项，必须先出具影响分析（波及哪些文件/功能/构建链），经人工确认后再执行。

| 层级 | 地基决策 | 如果替换… |
|------|---------|-----------|
| **桌面壳** | Wails v2 (Go + WebView2) | 前端框架、文件 I/O、构建流程全部重写 |
| **3D 渲染** | Babylon.js + babylon-mmd | WASM 物理、PMX/VMD 加载器、材质系统全部更换 |
| **数据通道** | Go 本地 HTTP 服务器传文件（非 Wails bridge） | `basenameFallbackFS`、`loadPMXFile`、纹理回退全部作废 |
| **物理引擎** | WASM Bullet（SPR） | `MmdWasmRuntime`、动画绑定、刚体模拟全部更换 |
| **文档契约** | `AGENTS.md` 为 AI 入口 + `docs/status.md` 实时状态 | AI 协作方式重置，无状态跟踪 |
| **工作流** | 小步修改 → 立即构建验证 → `complete_step` 签收 | 代码质量保障机制失效 |
| **项目结构** | 嵌套 `MikuMikuAR/`（含 `.git`）+ 外层 `docs/` | 所有文件路径引用断裂 |

## 约束

1. **AI 不得** 修改地基表中任一项，除非收到明确人工指令并附带影响分析
2. **AI 修改代码前** 必须通过 `read_file` 确认当前状态，不得基于记忆
3. **每次修改后** 必须执行对应层的构建命令（`go build ./...` / `npx vite build`），失败则回滚
