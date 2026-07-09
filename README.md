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

- **PMX/PMD 加载** — 完整 babylon-mmd 渲染管线，支持 SDEF / IK 骨骼 / Grant 权重
- **多模型同场** — 多个 PMX 共享场景，自动排列（6 种阵型），焦点切换
- **缩略图预览** — 模型加载后自动截图，库卡片即用即看
- **逐材质调参** — 按部位（皮肤/头发/眼睛/服装/配件）批量调整 + 单材质覆盖
- **模型预设** — 材质/表情/变换快照，库级管理，一键应用
- **服装变体** — `outfits.json` 描述纹理/mesh 变体，自动发现 + 一键换装

---

### 💃 动作与音频

- **VMD 动作播放** — 多模型独立绑定，进度拖拽 / 循环 / 键盘控制
- **程序化动作** — `Idle`（呼吸眨眼）、`AutoDance`（节拍驱动律动）、`Lifelike`（微动叠加）
- **VPD 姿势导入** — 文本解析 → VMD 帧，一键摆拍（支持 UTF-8/Shift-JIS 自动识别）
- **相机 VMD 轨道** — 加载相机 VMD，多模式自由切换
- **LipSync** — 振幅 → 口型 morph 权重（支持あ/ア/A 等多种口型命名）
- **节拍检测** — Web Audio 能量峰值法实时 BPM，支持多轨道

---

### ⚙️ 物理

- **XPBD 布料物理** — 自研 Verlet + XPBD 求解器 + SDF 胶囊身体碰撞器
- **WASM Bullet 物理** — MMD 原生刚体 / 关节 / 柔体，与时间轴同步

---

### 🌍 环境

- **水面** — Gerstner 波（4 层）+ 焦散 + 涟漪 + 水下过渡
- **体积云** — 3D 噪声 ray-marching + 风场驱动
- **粒子系统** — 樱/雨/雪/烟花/萤火虫/落叶/水花 7 种，与风场联动
- **程序化地形** — FBM 噪声高度图生成
- **灯光与后处理** — Bloom / DOF / SSAO / SSR / 边缘渲染，性能自动降级

---

### 📚 库与工具

- **模型库管理** — 递归扫描、8 类分类、zip 内省、标签/收藏/搜索
- **zip 容器** — 不解压直接加载 PMX/VMD，SHA-256 cache 惰性复用
- **场景打包** — 场景序列化为 `.mmascene`，可跨设备恢复
- **Blender 唤起** — 自动检测 / 手动配置路径，点 ✏️ 在 Blender 中编辑 PMX（需 [mmd_tools](https://github.com/powroupi/blender_mmd_tools) 插件）
---

### 👁️ 角色感知

- **视线追踪** — 视线跟随（Eye Contact），无 VMD 也能让模型"活起来"

---


## 📖 文档

| 文档 | 内容 |
|------|------|
| [已实现功能](docs/status.md) | 当前状态 |
| [关键设计决策](docs/adr/) | 技术思路 |
| [编码奇谭 · 100+ 章节代码演化叙事](novel/README.md) | 趣味日志 |
|-
| [AI文档地图工作流规则](AGENTS.md) | AGENTS  |
| [架构方案](docs/architecture.md) | 全功能汇总 |
| [需求与选型](docs/requirements.md) | P0-P4 优先级 + 技术选型理由 |
| [路线图](docs/roadmap.md) | 阶段规划 + DanceXR 对标 |
| [项目地基](docs/foundation.md) | 好用框架 |
| [故障排查](docs/troubleshooting.md) | CORS / WASM 404 / 纹理不显示 |
| [修复流程](docs/fix-cycle.md) | Bug 修复验收契约模板 |

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

## 🤖 AI 协作工具链

本项目由 **多个 AI 共同维护**，每个工具各司其职：

| 终端 | 模型 | 角色 |
|---------|------|------|
| **Trae**|**GLM5.2+doubao2.1**| 首席架构师· 代码生成 · 审查  |
| **Workbuddy**|**hy3** | 任务规划 · 进度追踪 · 技能辅助 |
| **OpenCode**|**NVidia/mistral-samll-4** |  前端 UI 开发 · 后端调试 |
| **Reasonix**|**Deepseek-v4-flash** | git push |
| **Mimocode**|**Mimo-v2.5** | 文档生成 · 推理分析 · 问题定位  |

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
- **Android 实验** — `main_android.gen.go` 用 c-shared 模式 + WebView，文件访问受 Scoped Storage 约束
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
