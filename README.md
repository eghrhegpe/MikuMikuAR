# 🎵 MikuMikuAR

> 基于 Wails v3 + Babylon.js / babylon-mmd 的跨平台 MMD 桌面播放器——
> PMX 模型查看、VMD 动作播放、即时换装、程序化舞蹈、XPBD 布料物理，一处搞定。

[![CI](https://img.shields.io/github/actions/workflow/status/eghrhegpe/MikuMikuAR/ci.yml?logo=github)](https://github.com/eghrhegpe/MikuMikuAR/actions)
[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go)](https://go.dev/)
[![Wails](https://img.shields.io/badge/Wails-v3-DF0000?logo=wails)](https://wails.io)
[![Babylon.js](https://img.shields.io/badge/Babylon.js-MMD-AD1F23?logo=babylondotjs)](https://babylonjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs)](https://nodejs.org/)
[![Android SDK](https://img.shields.io/badge/Android%20SDK-API%2034-34A853?logo=android)](https://developer.android.com/studio)
[![babylon-mmd](https://img.shields.io/badge/babylon--mmd-1.2.0-FF6F00?logo=babylondotjs)](https://github.com/noname0310/babylon-mmd)
[![Vite](https://img.shields.io/badge/Vite-6.4-646CFF?logo=vite)](https://vitejs.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4-729B1A?logo=vitest)](https://vitest.dev/)
[![WebView2](https://img.shields.io/badge/WebView2-Windows-0078D4?logo=microsoft)](https://learn.microsoft.com/edge/webview2/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

| 平台 | 状态 |
|------|------|
| 🪟 Windows | ✅ 已验证 |
| 🤖 Android | ✅ 已验证（c-shared + WebView） |
| 🍎 iOS / 🐧 Linux | 🟡 理论兼容（Wails v3 任务已配置，未实测） |

---

## ✨ 功能

### 🎭 渲染与模型

- **PMX/PMD 加载** — 完整 babylon-mmd 渲染管线，支持 SDEF 顶点形变 / IK 骨骼 / Grant 权重
- **多模型同场** — 多个 PMX 共享场景，自动横向排列，焦点切换
- **缩略图预览** — 模型加载后自动截图，库卡片即用即看
- **逐材质调参** — 按部位 / 逐材质编辑，分类预设一键应用
- **模型预设** — 自动应用一组材质/表情/变换，库级管理

### 💃 动作与音频

- **VMD 动作播放** — 加载 motion 驱动模型动画，多模型独立绑定，进度拖拽 / 循环 / 键盘
- **程序化动作** — `Idle` 呼吸眨眼、`AutoDance` 节拍驱动律动，无需 VMD 也能动起来
- **VPD 姿势导入** — 文本解析 → VMD 帧，一键摆拍
- **相机 VMD 轨道** — 加载相机 VMD，多模式相机切换
- **节拍检测 · LipSync** — Web Audio 实时 BPM，振幅→口型 morph 权重

### 👗 换装 / 物理 / 环境

- **服装变体系统** — `outfits.json` 描述纹理 / mesh 可见性变体，自动发现 + 一键换装
- **XPBD 布料物理** — 自研 Verlet + XPBD 求解器 + SDF 胶囊身体碰撞器，裙摆不再穿模
- **WASM Bullet 物理** — MMD 原生刚体 / 关节 / 柔体模拟，与时间轴同步
- **环境系统** — 天空 / 地面 / 水面（Gerstner 波 + 焦散）/ 体积云 / 粒子（雨雪樱叶萤火烟花）/ 风场联动
- **灯光与渲染管线** — Bloom / DOF / 色调映射 / 边缘 / SSR 反射探针（ADR-024），性能自动降级

### 📚 库与下载

- **模型库管理** — 递归扫描、DanceXR 风格分类、zip 内省、搜索过滤
- **zip 容器** — 不解压直接加载 PMX/VMD，cache 惰性复用
- **HTTP 下载引擎** — 直链下载 + 进度推送 + 自动解压落库
- **Blender 唤起** — 点 ✏️ 在 Blender 中编辑 PMX（需 [mmd_tools](https://github.com/powroupi/blender_mmd_tools) 插件）

---

## 🚀 快速开始

### 前置依赖

| 依赖 | 版本 | 说明 |
|------|------|------|
| **Go** | 1.25+ | Go 后端 + Wails 编译 |
| **Node.js** | 22+ | 前端构建（CI 用 24，别用 18） |
| **npm** | 10+ | 前端包管理 |
| **Git** | 任意 | 代码克隆 |
| **Wails v3 CLI** | 最新 | 热重载开发必需：`go install github.com/wailsapp/wails/v3/cmd/wails3@latest` |
| **Playwright** | — | E2E 测试用：`cd frontend && npx playwright install --with-deps` |

**Linux 额外依赖**（构建桌面应用）：
```bash
sudo apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev libglib2.0-dev \
  libsoup-3.0-dev libgdk-pixbuf-2.0-dev libpango1.0-dev libcairo2-dev \
  libatk1.0-dev libgirepository1.0-dev
```

### 开发运行

```bash
# 克隆后初始化前端
cd frontend && npm install

# 启动热重载开发（Go 后端 + Vite 前端同时跑）
wails3 dev -config ./build/config.yml -port 9245
```

### 测试

```bash
cd frontend

# 类型检查（改完必跑）
npm run check

# 单元测试（Vitest）
npm run test
npm run test:watch     # 监听模式

# E2E 测试（需先启动 wails3 dev 或 5173+9222 端口）
npm run test:e2e
npm run test:e2e:headed   # 有界面调试
```

### 生产构建

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -Production

# Linux
bash scripts/build-linux.sh --production
```

---

## 📖 文档

| 文档 | 内容 |
|------|------|
| [AGENTS.md](AGENTS.md) | 🗝️ AI 入口 + 文档地图 + 工作流规则 + 函数映射表 |
| [项目现状](docs/status.md) | 已实现功能、路线图、Bug 记录 |
| [架构方案](docs/architecture.md) | 各环节技术实现细节 |
| [需求与选型](docs/requirements.md) | P0-P4 优先级 + 技术选型理由 |
| [路线图](docs/roadmap.md) | 下一阶段规划 + DanceXR 对标 |
| [项目地基](docs/foundation.md) | 不可修改的技术决策 |
| [故障排查](docs/troubleshooting.md) | CORS / WASM 404 / 纹理不显示 |
| [修复流程](docs/fix-cycle.md) | Bug 修复验收契约模板 |
| [编码奇谭](novel/README.md) | 开发日志 · 100+ 章节代码演化叙事 |
| [决策档案](docs/adr/) | 大量关键设计决策记录 |

## 🤖 AI 协作工具链

本项目由 **多个 AI 共同维护**，每个工具各司其职：

| AI 工具 | 角色 |
|---------|------|
| **Trae - GLM5.2+doubao2.1** | 首席架构师· 代码生成 · 审查  |
| **Workbuddy - hy3** | 任务规划 · 进度追踪 · 技能辅助 |
| **OpenCode - NVidia/mistral-samll-4** |  前端 UI 开发 · 后端调试 |
| **Reasonix - Deepseek-v4-flash** | 发git的 |
| **Mimocode - Mimo-v2.5** | 文档生成 · 推理分析 · 问题定位  |

## 📁 项目结构

```
MikuMikuAR/
├── main.go / main_android.gen.go   # Wails 应用入口（桌面 + Android）
├── internal/               # Go 内部包，需wails3 显示指定go目录。
│   ├── app/               # 核心业务（文件IO / HTTP服务器 / 扫描 / 下载 / Blender / 预设 / 缩略图）
│   ├── dialogs/           # 文件对话框
│   ├── thumbnail/         # 缩略图生成
│   └── util/              # 工具（pmx 解析 / hash / errors / safecall）
├── build/                  # 各平台构建配置（windows/darwin/linux/ios/android）
├── scripts/                # 构建 / E2E 脚本
├── frontend/src/
│   ├── core/               # 入口 / 共享状态 / 文件URL / 图标 / 响应式
│   ├── scene/              # 3D 场景编排
│   │   ├── camera/         # 相机模式
│   │   ├── motion/         # VMD 桥接 / 程序化动作 / LipSync / 播放控制
│   │   ├── manager/        # ModelManager / 材质 / 加载 / 操作
│   │   ├── env/            # 环境（天空/水面/云/粒子/光照/风场）
│   │   └── render/         # 渲染管线 / 灯光 / 性能降级
│   ├── menus/              # SlideMenu 弹窗系统（库/模型/动作/环境/设置）
│   ├── motion-algos/       # 动作算法（无 Babylon 依赖，供 scene/motion/ 调用）
│   ├── outfit/             # 换装系统 + 音频
│   └── physics/            # XPBD 求解器 / 布料 / SDF碰撞器
└── docs/                   # 项目文档（架构 / 状态 / 路线图 / ADR / 修复流程）
```

---

## ⚠️ 已知限制

- **贴图兼容性** — 部分 PMX 贴图路径不标准（`../tex/` vs `textures/`），已经 `basenameFallbackFS` 兜底，但不保证 100% 覆盖
- **Blender 编辑** — 需用户自行安装 [mmd_tools](https://github.com/powroupi/blender_mmd_tools) 插件，否则 Blender 无法打开 PMX
- **Android 实验** — `main_android.gen.go` 用 c-shared 模式 + WebView，文件访问受 Scoped Storage 约束（见 [ADR-023](docs/adr/adr-023-android-file-access-strategy.md)）
- **跨平台路径** — Blender 自动检测仅覆盖 Windows，macOS/Linux 需在设置中手动配置


## 🔍 竞品分析

详见 [docs/competitive-analysis.md](docs/competitive-analysis.md)（23 个项目调研），简要：

**渲染引擎 / 查看器**
- [babylon-mmd](https://github.com/noname0310/babylon-mmd) — Babylon.js MMD 渲染引擎（本项目基于此）
- [mmd-viewer-js](https://github.com/pixiставь/mmd-viewer-js) — 零依赖 JS WebGL 查看器，Toon 着色 + 视频录制
- [Saba](https://github.com/mmd不开心/Saba) — C++ 轻量查看器，Lua 脚本/多后端/宏命令

**桌面播放器**
- [DanceXR](https://github.com/Chewhern/DanceXR) — 动作组合/角色在场/离线渲染/VR（主要对标）
- [Coocoo3D](https://github.com/hkrn/coocoo3d) — C#+DX12，光线追踪/GI/SSAO/Decal
- [flowerMiku](https://github.com/miku333/flowerMiku) — C++/Vulkan，PBR 材质

**DCC 工具链**
- [mmd_tools](https://github.com/powroupi/blender_mmd_tools) — Blender PMX 插件（本项目 Blender 集成依赖）
- [MMD Bridge](https://github.com/mmd-bridge/MMDBridge) — Alembic 导出/Python 脚本

**AR / XR**
- [ar-mmd](https://github.com/code4fukui/ar-mmd) — WebXR AR 空间 MMD 模型播放演示
- [MikuMikuMixed](https://github.com/importantimport/mikumikumixed) — Experimental WebXR MMD Viewer（React-Three-Fiber + WebXR）
- [web-mmd](https://github.com/culdo/web-mmd) — 浏览器 MMD 播放器，含 AR 模式（手机相机控制）

**框架**
- [Wails](https://wails.io) — Go + WebView 桌面框架（本项目选型）

## 📜 许可

[MIT](LICENSE) — 本项目代码自由使用。

> ⚠️ 本工具不主张任何模型 / 动作 / 贴图文件的版权。用户加载的 PMX / VMD / 贴图文件可能受其各自创作者的许可限制，与本项目无关。
