# 🎵 MikuMikuAR

> 不只是 MMD 查看器——从模型浏览、动作播放到 AR 实拍合成，MMD 创作的全链路桌面工作站。

[![CI](https://img.shields.io/github/actions/workflow/status/eghrhegpe/MikuMikuAR/ci.yml?logo=github)](https://github.com/eghrhegpe/MikuMikuAR/actions)
[![Release](https://img.shields.io/github/v/release/eghrhegpe/MikuMikuAR?logo=github)](https://github.com/eghrhegpe/MikuMikuAR/releases)
[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go)](https://go.dev/)
[![Wails](https://img.shields.io/badge/Wails-v3-DF0000?logo=wails)](https://wails.io)
[![Babylon.js](https://img.shields.io/badge/Babylon.js-9.16-AD1F23?logo=babylondotjs)](https://babylonjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.4-646CFF?logo=vite)](https://vitejs.dev/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

| 平台 | 状态 |
|------|------|
| 🪟 Windows | ✅ 已验证 |
| 🤖 Android | ✅ 已验证（c-shared + WebView） |
| 🍎 iOS / 🐧 Linux | 🟡 理论兼容（Wails v3 任务已配置，未实测） |

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [繁體中文](README.zh-TW.md)

---

## 为什么选择 MikuMikuAR

大多数 MMD 工具要么是单一查看器（只能看），要么是重型 DCC 插件（必须会 Blender）。MikuMikuAR 填补了中间地带：

- **零门槛上手** — 不解压 zip 直接加载 PMX/VMD，拖进去就能看、就能播
- **程序化生命力** — 无需 VMD 也能让模型"活起来"：呼吸、眨眼、视线追踪、节拍驱动律动
- **AR 实拍合成** — 摄像头画面叠加 3D 模型，一键截图，手机也能用
- **跨平台** — Windows 桌面 + Android 移动，同一套代码

---

## 功能概览

### 🎭 渲染与模型

- **PMX/PMD 加载** — 完整 babylon-mmd 管线（SDEF / IK / Grant），多模型同场，6 种阵型
- **材质系统** — 智能分类（皮肤/头发/眼睛/服装/配件），逐材质调参，预设快照一键应用
- **换装** — `outfits.json` 纹理/mesh 变体，自动发现 + 一键切换
- **卡通化渲染** — Cel-shading 后处理，预设快照
- **Pose Studio** — 构图辅助、景深、T-pose/A-pose 转换、批量截图

### 💃 动作与音频

- **VMD 播放** — 多模型独立绑定，进度拖拽 / 循环 / 键盘控制
- **程序化动作** — Idle 呼吸眨眼、AutoDance 节拍律动、Lifelike 微动叠加
- **Motion 工具链** — 双图层混合、逐骨骼覆写、VPD 姿势导入、LipSync 口型同步
- **程序化运镜** — 8 种自动相机预设，节拍驱动

### 🌍 环境与物理

- **WASM Bullet 物理** — MMD 原生刚体/关节/柔体，时间轴同步
- **程序化场景** — Gerstner 水面、体积云、7 种粒子、FBM 地形
- **后处理** — Bloom / DOF / SSAO / SSR / 色调映射 / FXAA，性能自动降级

### 📷 AR 相机

- 摄像头透传 + 模型叠加，前置/后置切换，Gaze 协同，一键截图合成

### 📚 库与工具

- 模型库管理（递归扫描、zip 内省、标签/收藏/搜索、下载监听自动导入）
- zip 容器（不解压直接加载，SHA-256 cache 复用）
- Scene Bundle（场景打包为 zip，跨设备导入/导出）
- Blender 唤起（需 [mmd_tools](https://github.com/powroupi/blender_mmd_tools) 插件）

### 🌐 国际化

- 5 种语言热切换：简体中文 / English / 日本語 / 한국어 / 繁體中文

---

## ⌨️ 快捷键

| 快捷键 | 行为 |
|--------|------|
| Ctrl+1~5 | 切换底部导航弹窗（模型/动作/场景/环境/设置） |
| Ctrl+6 | 切换 AR 相机模式 |
| Space | 播放/暂停 |
| ←/→ | seek ±5s |
| WASD | 自由飞行相机（需开启 Freefly） |

---

## 🚀 快速开始

### 前置依赖

| 依赖 | 版本 | 说明 | 安装检查 |
|------|------|------|---------|
| **Go** | 1.25+ | 后端编译 | `go version` |
| **Node.js** | 24+ | 前端构建 | `node --version` |
| **npm** | 11+ | 包管理 | `npm --version` |
| **Wails v3 CLI** | 最新 | 热重载开发必需 | `wails3 version` → `go install github.com/wailsapp/wails/v3/cmd/wails3@latest` |
| **PowerShell 7** | — | Windows 构建脚本（可选） | `pwsh --version` |
| **GitHub CLI** | — | 发版流程（可选） | `gh --version` |

> **E2E 测试额外依赖：** Playwright 浏览器
> ```bash
> cd frontend && npx playwright install chromium
> ```
>
> **WASM Bullet 物理引擎（可选）：** 如需本地编译，安装 [Rust](https://rustup.rs/)
> ```bash
> rustc --version   # 查看是否已安装
> ```

### 开发运行

```bash
cd frontend && npm install
wails3 dev -config ./build/config.yml -port 9245
```

<details>
<summary>进阶：前后端拆分运行（最大控制力）</summary>

```bash
# 终端 1 — 前端（Vite HMR，改 TS 秒级刷新）
cd frontend && npm run dev

# 终端 2 — 后端（编译一次后常驻；仅改 Go 时重跑）
wails3 build DEV=true && wails3 task run
```

</details>

### 测试

```bash
cd frontend
npm run check          # 类型检查
npm run test           # 单元测试（Vitest）
npm run test:e2e       # E2E（需先启动 wails3 dev）
```

### 生产构建

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -Production

# Linux
bash scripts/build-linux.sh --production
```

<details>
<summary>Linux 额外依赖</summary>

```bash
sudo apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev libglib2.0-dev \
  libsoup-3.0-dev libgdk-pixbuf-2.0-dev libpango1.0-dev libcairo2-dev \
  libatk1.0-dev libgirepository1.0-dev
```

</details>

---

## 📖 文档

| 文档 | 内容 |
|------|------|
| [架构方案](docs/architecture.md) | 全功能汇总与技术细节 |
| [设计决策](docs/adr/) | ADR 技术决策记录 |
| [竞品分析](docs/competitive-analysis.md) | 23 个项目调研对比 |
| [需求与选型](docs/requirements.md) | P0-P4 优先级 + 技术选型理由 |
| [项目现状](docs/status.md) | 当前状态 + 已完成功能 |
| [编码奇谭](novel/README.md) | 代码演化叙事 |

---

## 📁 项目结构

```
MikuMikuAR/
├── main.go / main_android.gen.go   # Wails 入口（桌面 + Android）
├── internal/               # Go 后端（文件IO / HTTP / 扫描 / Blender / 缩略图）
├── frontend/src/
│   ├── core/               # 入口 / 状态 / i18n / 文件URL
│   ├── scene/              # 3D 场景（AR / 相机 / 动作 / 管理 / 环境 / 渲染）
│   ├── menus/              # 弹窗系统
│   ├── motion-algos/       # 动作算法（无 Babylon 依赖）
│   └── outfit/             # 换装系统
└── docs/                   # 架构 / ADR / 竞品 / 状态
```

详见 [架构方案](docs/architecture.md)。

---

## ⚠️ 已知限制

- **贴图兼容性** — 部分 PMX 贴图路径不标准，`basenameFallbackFS` 兜底但不保证 100%
- **Blender 编辑** — 需用户自行安装 [mmd_tools](https://github.com/powroupi/blender_mmd_tools) 插件
- **Android 实验** — c-shared + WebView，文件访问受 Scoped Storage 约束
- **SSS 次表面散射** — 依赖 babylon-mmd PBR 支持，上游阻塞中

---

## 🔍 竞品定位

与 [DanceXR](https://github.com/Chewhern/DanceXR)（VR/离线渲染）、[Coocoo3D](https://github.com/hkrn/coocoo3d)（光追/GI）等桌面播放器相比，MikuMikuAR 的差异在于 **Web 技术栈 + AR 实拍 + 程序化生命力**。完整对比见 [竞品分析](docs/competitive-analysis.md)。

---

## 📜 许可

[MIT](LICENSE) — 代码自由使用。

> ⚠️ 本工具不主张任何模型 / 动作 / 贴图文件的版权。用户加载的 PMX / VMD / 贴图文件受各自创作者许可约束，与本项目无关。
