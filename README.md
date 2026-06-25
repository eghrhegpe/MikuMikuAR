# 🎵 MikuMikuAR

Wails + babylon-mmd 桌面 PMX 模型查看器与聚合播放器。

[![Go](https://img.shields.io/badge/Go-1.23-00ADD8?logo=go)](https://go.dev/)
[![Wails](https://img.shields.io/badge/Wails-v2-DF0000?logo=wails)](https://wails.io)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

---

## ✨ 功能

- 🎭 **PMX/PMD 加载** — 完整 MMD 渲染管线（babylon-mmd），支持 SDEF / IK / Grant
- 💃 **VMD 动作播放** — 加载 motion 驱动模型动画，多模型独立绑定
- 🧪 **WASM Bullet 物理** — 刚体/关节/柔体模拟，共享时间轴
- 📚 **模型库管理** — 递归扫描、DanceXR 分类、zip 内省、搜索过滤
- 📦 **zip 容器** — 不解压直接加载 PMX/VMD，cache 复用
- 🔗 **多模型同场** — 多个 PMX 共享场景，自动排列，焦点切换
- 🖼️ **缩略图预览** — 模型加载后自动截图，库卡片显示
- ⬇ **HTTP 下载引擎** — 直链下载 + 进度推送 + 自动解压落库
- 🎬 **播放控制** — 暂停/播放、拖拽进度条、自动循环、键盘快捷键
- ⚙ **Blender 唤起** — 点击 ✏️ 按钮在 Blender 中编辑 PMX（需安装 mmd_tools 插件）

## 🚀 快速开始

### 前置依赖

- Go 1.21+
- Node.js 18+
- [Wails CLI](https://wails.io/docs/gettingstarted/installation)

### 开发运行

```bash
cd MikuMikuAR
wails dev
```

### 生产构建

```bash
cd MikuMikuAR
wails build
```

生成的可执行文件在 `MikuMikuAR/build/bin/`。

## 📁 项目结构

```
├── MikuMikuAR/             ← Wails 应用
│   ├── app.go              ← Go 后端（文件IO/HTTP服务器/扫描/下载/Blender）
│   ├── pmx.go              ← PMX header 解析器
│   ├── frontend/src/       ← TypeScript 前端
│   │   ├── config.ts       ← 状态管理 + 工具函数
│   │   ├── scene.ts        ← 3D 场景 + PMX/VMD 加载 + 物理
│   │   ├── library.ts      ← 模型库弹窗 + 搜索 + 导航
│   │   └── main.ts         ← 入口 + 事件绑定
│   ├── tests/              ← 契约测试
│   └── scripts/            ← 构建脚本
└── docs/                   ← 项目文档（架构/状态/决策/排障）
```

## 📖 文档

| 文档 | 内容 |
|------|------|
| [项目现状](docs/status.md) | 已实现功能、路线图、Bug 记录 |
| [架构方案](docs/architecture.md) | 各环节技术实现细节 |
| [项目地基](docs/foundation.md) | 不可修改的技术决策 |
| [故障排查](docs/troubleshooting.md) | 常见问题与解决方案 |
| [修复流程](docs/fix-cycle.md) | Bug 修复验收契约模板 |
| [决策档案](docs/adr/) | 关键设计决策记录 |

## ⚠️ 已知限制

- **贴图兼容性** — 部分 PMX 贴图路径不标准（`../tex/` vs `textures/`），已通过 `basenameFallbackFS` 兜底，但不保证 100% 覆盖
- **Blender 编辑** — 需用户自行安装 [mmd_tools](https://github.com/powroupi/blender_mmd_tools) 插件，否则 Blender 无法打开 PMX
- **macOS/Linux 路径** — Blender 自动检测仅覆盖 Windows，其他平台需手动在设置中配置路径
- **仅 Windows 构建验证** — macOS/Linux 理论上兼容 Wails，但未实测

## 📜 许可

[MIT](LICENSE) — 本项目代码自由使用。

> ⚠️ 本工具不主张任何模型/动作/贴图文件的版权。用户加载的 PMX/VMD/贴图文件可能受其各自创作者的许可限制，与本项目无关。

## 🙏 致谢

- [babylon-mmd](https://github.com/noname0310/babylon-mmd) — Babylon.js MMD 渲染引擎
- [Wails](https://wails.io) — Go + WebView2 桌面框架
- [DanceXR](https://github.com/Chewhern/DanceXR) — 目录结构参考
