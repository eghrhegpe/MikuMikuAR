# MikuMikuAR 项目长期记忆

## 项目定位
Wails (Go) + babylon-mmd 桌面 PMX 查看器/编辑器，当前处于体验打磨阶段（Phase 9）。核心渲染、模型库、多模型场景、zip 解压、外部库挂载、下载引擎、换装系统、程序化动作、LipSync、天空/水体/粒子均已就绪。

## 技术栈
- **后端**: Go + Wails v2（app.go / pmx.go / main.go）
- **前端**: TypeScript + Babylon.js + babylon-mmd + Vite
- **物理**: WASM Bullet（共享时间轴，多模型同场）
- **UI**: MenuStack 导航栈系统 + Iconify 图标 + CSS 变量体系

## 文档宪法
- `AGENTS.md` 是 AI 入口，定义文档地图和硬约束
- 禁止递归扫描 `docs/`、禁止读 `docs/research/`（除非明确指定）
- 先读后改、小步快跑、失败熔断（连续 2 次失败停止分析）

## 关键架构决策
- 文件服务器：每目录独立端口 + basenameFallbackFS 兜底
- zip 容器：全解到 cache + manifest.json 比对 mtime+size
- Shift-JIS 编码问题：URL 中 %EF%BF%BD 乱码，计划 Base64 + 查询参数方案
- 多模型：ModelInstance + Map 注册表，共享 WASM 物理时间轴

## 已安装 Skills
- `babylon-mmd-helper` — 前端 Babylon.js/MMD 开发助手
- `wails-go-helper` — Go/Wails 后端开发助手

## 用户偏好
- 结构化表达（表格、检查清单、🔴🟡🟢 分类）
- 迭代式开发，改完立即构建验证
- 事件驱动增量方案 > 一次性 IIFE
- 签退风格：「全部完成。构建通过。」
