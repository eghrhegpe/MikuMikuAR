# 🎵 MikuMikuAR

> 基于 Wails v3 + Babylon.js / babylon-mmd 的跨平台 MMD 桌面播放器——
> PMX 模型查看、VMD 动作播放、即时换装、程序化舞蹈、AR 相机、卡通化渲染，一处搞定。

[![CI](https://img.shields.io/github/actions/workflow/status/eghrhegpe/MikuMikuAR/ci.yml?logo=github)](https://github.com/eghrhegpe/MikuMikuAR/actions)
[![Release](https://img.shields.io/github/v/release/eghrhegpe/MikuMikuAR?logo=github)](https://github.com/eghrhegpe/MikuMikuAR/releases)
[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go)](https://go.dev/)
[![Wails](https://img.shields.io/badge/Wails-v3-DF0000?logo=wails)](https://wails.io)
[![Babylon.js](https://img.shields.io/badge/Babylon.js-9.14-AD1F23?logo=babylondotjs)](https://babylonjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs)](https://nodejs.org/)
[![Android SDK](https://img.shields.io/badge/Android%20SDK-API%2034-34A853?logo=android)](https://developer.android.com/studio)
[![babylon-mmd](https://img.shields.io/badge/babylon--mmd-1.2.0-FF6F00?logo=babylondotjs)](https://github.com/noname0310/babylon-mmd)
[![Vite](https://img.shields.io/badge/Vite-6.4-646CFF?logo=vite)](https://vitejs.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-729B1A?logo=vitest)](https://vitest.dev/)
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
- **多模型同场** — 多个 PMX 共享场景，6 种阵型排列，焦点切换
- **缩略图预览** — 模型加载后自动截图，库卡片即用即看
- **逐材质调参** — 按部位（皮肤/头发/眼睛/服装/配件/道具）批量调整 + 单材质覆盖
- **智能材质分类** — 自动检测皮肤/头发/眼睛/服装/配件/道具，支持自定义正则规则
- **模型预设** — 材质/表情/变换快照，库级管理，一键应用
- **服装变体** — `outfits.json` 描述纹理/mesh 变体，自动发现 + 一键换装
- **卡通化渲染** — 一键 Cel-shading 后处理模式（exposure/contrast/ACES/bloom/fxaa 预设快照）
- **Pose Studio** — 构图辅助、景深、T-pose/A-pose 转换、批量截图、水印

---

### 💃 动作与音频

- **VMD 动作播放** — 多模型独立绑定，进度拖拽 / 循环 / 键盘控制
- **程序化动作** — `Idle`（呼吸眨眼）、`AutoDance`（节拍驱动律动）、`Lifelike`（微动叠加）
- **VPD 姿势导入** — 文本解析 → VMD 帧，一键摆拍（支持 UTF-8/Shift-JIS 自动识别）
- **相机 VMD 轨道** — 加载相机 VMD，多模式自由切换
- **程序化运镜** — 8 种自动相机预设，节拍驱动闭环
- **LipSync** — 振幅 → 口型 morph 权重，多口型驱动（あ/い/う/え + 中/英/日候选名）
- **节拍检测** — Web Audio 能量峰值法实时 BPM，支持多轨道
- **Motion Layers** — 双 VMD 图层混合 + boneFilter 骨骼过滤
- **Motion Override** — 逐骨骼旋转/位移覆写，程序化动作与 VMD 共存

---

### ⚙️ 物理

- **WASM Bullet 物理** — MMD 原生刚体 / 关节 / 柔体，与时间轴同步

---

### 🌍 环境

- **水面** — Gerstner 波（4 层）+ 焦散 + 涟漪 + 水下过渡 + 反射 RenderTarget
- **体积云** — 3D 噪声 ray-marching + 风场驱动
- **粒子系统** — 樱/雨/雪/烟花/萤火虫/落叶/水花 7 种，与风场联动
- **程序化地形** — FBM 噪声高度图 + 坡度纹理滚动 + 镜面反射 + 法线贴图 + 高程着色
- **灯光与后处理** — Bloom / DOF / SSAO / SSR / 边缘渲染 / 色调映射 / FXAA，性能自动降级

---

### 📚 库与工具

- **模型库管理** — 递归扫描、zip 内省、标签/收藏/搜索、下载目录监听 + 自动导入
- **zip 容器** — 不解压直接加载 PMX/VMD，SHA-256 cache 惰性复用
- **Scene Bundle** — 场景打包为 zip（含所有引用资源），跨设备导入/导出
- **Blender 唤起** — 自动检测 / 手动配置路径，点 ✏️ 在 Blender 中编辑 PMX（需 [mmd_tools](https://github.com/powroupi/blender_mmd_tools) 插件）

---

### 👁️ 角色感知

- **视线追踪** — Eye Contact 眼神接触，无 VMD 也能让模型"活起来"
- **头部追踪** — 头部跟随相机/用户，增强生命力

---

### 📷 AR 相机

- **视频透传 + 模型叠加** — 摄像头画面作为场景背景，模型渲染在视频之上
- **前置/后置切换** — 移动端自动选后置，桌面端默认前置
- **Gaze 协同** — AR 模式下自动开启视线追踪，增强与真人眼神接触
- **截图合成** — 视频背景 + 3D 模型一键合成
- **Android 权限** — CAMERA 运行时权限原生桥接

---

### 🌐 国际化

- **5 种语言** — 简体中文 / English / 日本語 / 한국어 / 繁體中文，热切换

---

## ⌨️ 键盘快捷键

| 快捷键 | 行为 |
|--------|------|
| Ctrl+1~5 | 切换 5 个底部导航弹窗（模型/动作/场景/环境/设置） |
| Ctrl+6 | 切换 AR 相机模式 |
| Space | 播放/暂停 |
| Escape | 关闭所有弹窗 |
| ←/→ | seek ±5s |
| ↑/↓ | 菜单项导航（弹窗内） |
| Enter/→ | 激活选中项（弹窗内） |
| ←（弹窗内） | 返回上层 |
| WASD | 自由飞行相机（需开启 Freefly 模式） |

---

## 📖 文档

| 文档 | 内容 |
|------|------|
| [项目现状](docs/status.md) | 当前状态 + 已完成功能 |
| [架构方案](docs/architecture.md) | 全功能汇总 |
| [设计决策](docs/adr/) | 80+ ADR 技术思路 |
| [需求与选型](docs/requirements.md) | P0-P4 优先级 + 技术选型理由 |
| [竞品分析](docs/competitive-analysis.md) | 23 个项目调研 |
| [编码奇谭](novel/README.md) | 100+ 章节代码演化叙事 |
| [AI 工作流规则](AGENTS.md) | AI 协作指南 |

---

## 🚀 快速开始

### 前置依赖

| 依赖 | 版本 | 说明 |
|------|------|------|
| **Go** | 1.25+ | Go 后端 + Wails 编译 |
| **Node.js** | 24+ | 前端构建 |
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

#### 进阶：手动拆分（最大控制力）

若想要前端完全独立热更新、且 Go 进程长期常驻，可把前后端拆成两个终端跑：

```bash
# 终端 1 — 前端（Vite HMR，改 TS 秒级刷新，不碰 Go）
cd frontend && npm run dev          # 等价于 npx vite --port 9245

# 终端 2 — 后端（编译一次后常驻；仅改 Go 时才需要重跑这两步）
wails3 build DEV=true
wails3 task run
```

- 改 **TS / HTML / CSS** → 仅终端 1 的 Vite 自动刷新，应用窗口不重建。
- 改 **Go** → 回到终端 2 重跑 `wails3 build DEV=true && wails3 task run` 重启后端。
- 手动拆分时 `wails3 dev` 不参与，需自行保证 Vite 端口（默认 `9245`）与后端加载的 dev URL 一致。

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

# 校验 116 个 Go 绑定函数存在性 + FNV-1a method ID
npm run test -- src/__tests__/bindings/app.contract.test.ts
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
| **Trae** | GLM5.2+doubao2.1 | 首席架构师 · 代码生成 · 审查 |
| **Workbuddy** | hy3 | 任务规划 · 进度追踪 · 技能辅助 |
| **OpenCode** | NVidia/mistral-small-4 | 前端 UI 开发 · 后端调试 |
| **Reasonix** | Deepseek-v4-flash | git push |
| **Mimocode** | Mimo-v2.5 | 文档生成 · 推理分析 · 问题定位 |

---

## 📁 项目结构

```
MikuMikuAR/
├── main.go / main_android.gen.go   # Wails 应用入口（桌面 + Android）
├── internal/               # Go 内部包
│   ├── app/               # 核心业务（文件IO / HTTP服务器 / 扫描 / 下载 / Blender / 预设 / 缩略图）
│   ├── dialogs/           # 文件对话框
│   ├── thumbnail/         # 缩略图生成
│   └── util/              # 工具（pmx 解析 / hash / errors / safecall）
├── build/                  # 各平台构建配置（windows/darwin/linux/ios/android）
├── scripts/                # 构建 / E2E 脚本
├── frontend/src/
│   ├── core/               # 入口 / 共享状态 / 文件URL / 图标 / 响应式 / i18n
│   ├── scene/              # 3D 场景编排
│   │   ├── ar/             # AR 相机模式
│   │   ├── camera/         # 相机模式
│   │   ├── motion/         # VMD 桥接 / 程序化动作 / LipSync / 播放控制
│   │   ├── manager/        # ModelManager / 材质 / 加载 / 操作
│   │   ├── env/            # 环境（天空/水面/云/粒子/光照/风场）
│   │   ├── pose/           # Pose Studio / 构图辅助
│   │   └── render/         # 渲染管线 / 灯光 / 性能降级
│   ├── menus/              # SlideMenu 弹窗系统（库/模型/动作/环境/设置）
│   ├── motion-algos/       # 动作算法（无 Babylon 依赖，供 scene/motion/ 调用）
│   ├── outfit/             # 换装系统 + 音频
│   └── __tests__/          # 单元测试 + 绑定契约测试
└── docs/                   # 项目文档（架构 / 状态 / ADR / 修复流程）
```

---

## ⚠️ 已知限制

- **贴图兼容性** — 部分 PMX 贴图路径不标准（`../tex/` vs `textures/`），已经 `basenameFallbackFS` 兜底，但不保证 100% 覆盖
- **Blender 编辑** — 需用户自行安装 [mmd_tools](https://github.com/powroupi/blender_mmd_tools) 插件，否则 Blender 无法打开 PMX
- **Android 实验** — `main_android.gen.go` 用 c-shared 模式 + WebView，文件访问受 Scoped Storage 约束
- **跨平台路径** — Blender 自动检测仅覆盖 Windows，macOS/Linux 需在设置中手动配置
- **SSS 次表面散射** — 依赖 babylon-mmd 支持 PBR 材质，上游阻塞中
- **Windows 目录选择** — Wails v3 `CanChooseDirectories` 缺陷，实际弹出文件选择器

---

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
