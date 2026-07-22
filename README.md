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

- **PMX/PMD 加载** — 完整 babylon-mmd 管线（SDEF 球面变形 / IK / Grant），多模型同场，6 种阵型
- **材质系统** — 智能分类（皮肤/头发/眼睛/服装/配件），逐材质调参，预设快照一键应用
- **换装** — `outfits.json` 纹理/mesh 变体，自动发现 + 一键切换
- **卡通化渲染** — Cel-shading 后处理，预设快照
- **舞台灯光** — 真实光锥 Mesh + ShaderMaterial，多灯位预设
- **反射系统** — 实时/烘焙双模，平面反射引擎 + SSR 管线
- **无限地面** — 相机追踪跟随，世界空间 UV 补偿，PBR 材质 + 接触阴影
- **Pose Studio** — 构图辅助、景深、T-pose/A-pose 转换、批量截图

### 💃 动作与音频

- **VMD 播放** — 多模型独立绑定，进度拖拽 / 循环 / 键盘控制
- **程序化动作** — Idle 呼吸眨眼、AutoDance 节拍律动、Lifelike 微动叠加
- **Motion 工具链** — 双槽位动作系统、Motion Override 逐骨骼覆写（IK 感知）、VPD 姿势导入、LipSync 口型同步
- **动作重定向** — AnimationRetargeter 骨骼映射，跨骨架动作迁移
- **动作预设** — 一键保存/应用动作快照，Go 端 CRUD + UI 卡片
- **场景级动作意图** — 全局 Motion Intent 统一调度，per-motion 程序化参数
- **撤销/重做** — 动作覆盖 + 场景级破坏性操作均可撤销（Memento 快照）
- **程序化运镜** — 8 种自动相机预设，节拍驱动，CameraControl × CameraBehavior 双轴控制
- **StreamAudioPlayer** — 低延迟音频管线，VMD 时间轴同步 + 节拍检测

### 🌍 环境与物理

- **WASM Bullet 物理** — MMD 原生刚体/关节/柔体，时间轴同步，按类别开关（裙/胸/发/配件）
- **风格化水体** — 波光粼粼（Sun Glitter + 高频法线扰动 + 焦散 + 双尺度波高 + 地平线淡出）
- **体积云** — 地平线延展 + 自适应步长 + 双瓣散射
- **地面系统** — PBR 材质 + 程序化木纹 + 反射模糊 + 接触阴影
- **环境预设** — 天空/地面/水面/大气四类分类预设，一键切换
- **环境亮度** — 统一标量旋钮，联动所有消费点
- **后处理** — Bloom / DOF / SSAO / SSR / 色调映射 / FXAA
- **性能守护** — 刷新率感知自动降级（相对阈值 + 运行时峰值校准）

### 🧠 感知层（程序化生命力）

- **呼吸** — 胸廓/肩部周期微动
- **眨眼** — 随机间隔自然眨眼
- **注视追踪** — 头部/眼球跟随相机，dt 驱动指数衰减（帧率无关）
- **表情** — 基于上下文自动表情
- **平衡摇摆** — 重心周期微摆（周期 + 振幅独立可调）
- **LipSync** — 音频振幅驱动口型 morph
- **全员感知** — 多模型同时启用，三档自动降级（high/medium/low）

### 📷 AR 相机

- 摄像头透传 + 模型叠加，前置/后置切换，Gaze 协同，一键截图合成

### 📚 库与工具

- **模型库管理** — 递归扫描、zip 内省、标签/收藏/搜索、下载监听自动导入
- **模型广场浏览器** — 多站点聚合（Bowlroll/DeviantArt 等），内嵌浏览 + 下载代理 + 创作者模式
- **zip 容器** — 不解压直接加载，SHA-256 cache 复用
- **Scene Bundle** — 场景打包为 zip，跨设备导入/导出
- **Blender 唤起** — 需 [mmd_tools](https://github.com/powroupi/blender_mmd_tools) 插件

### 🌐 国际化

- 5 种语言热切换：简体中文 / English / 日本語 / 한국어 / 繁體中文
- Go 后端错误信息 i18n 化（信封方案 + CI 门禁）

### ♿ 无障碍

- 焦点环（`:focus-visible`）、Toast/状态栏 `aria-live`、Focus Trap + 焦点恢复

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
| [设计决策](docs/adr/) | 160+ ADR 技术决策记录 |
| [竞品分析](docs/competitive-analysis.md) | 23 个项目调研对比 |
| [项目现状](docs/status.md) | 当前状态 + 已完成功能 |
| [菜单指南](docs/menu-how-to.md) | 声明式菜单 Schema 开发手册 |
| [编码奇谭](novel/README.md) | 代码演化叙事 |

---

## 📁 项目结构

```
MikuMikuAR/
├── main.go / main_android.gen.go   # Wails 入口（桌面 + Android）
├── internal/               # Go 后端（文件IO / HTTP / 扫描 / i18n / 缩略图）
├── frontend/src/
│   ├── core/               # 入口 / 状态 / i18n / 响应式 / UI 组件库
│   ├── scene/              # 3D 场景（AR / 相机 / 动作 / 感知层 / 环境 / 渲染 / 物理）
│   ├── menus/              # 声明式菜单系统（57 面板 Schema 驱动）
│   ├── motion-algos/       # 动作算法（无 Babylon 依赖，纯数学）
│   ├── outfit/             # 换装 + 音频
│   └── physics/            # 物理桥接 + 风场
└── docs/                   # 架构 / ADR / 竞品 / 状态
```

详见 [架构方案](docs/architecture.md)。

---

## ⚠️ 已知限制

- **贴图兼容性** — 部分 PMX 贴图路径不标准，`basenameFallbackFS` 兜底但不保证 100%
- **Blender 编辑** — 需用户自行安装 [mmd_tools](https://github.com/powroupi/blender_mmd_tools) 插件
- **Android 渲染性能** — 移动 GPU 算力/带宽客观差距，大模型场景 FPS 低于桌面
- **SSS 次表面散射** — 依赖 babylon-mmd PBR 支持，上游阻塞中
- **VMD 图层混合** — WASM 运行时仅支持单图层，多图层需 JS 运行时

---

## 🔍 竞品定位

与 [DanceXR](https://github.com/Chewhern/DanceXR)（VR/离线渲染）、[Coocoo3D](https://github.com/hkrn/coocoo3d)（光追/GI）等桌面播放器相比，MikuMikuAR 的差异在于 **Web 技术栈 + AR 实拍 + 程序化生命力**。完整对比见 [竞品分析](docs/competitive-analysis.md)。

---

## 📜 许可

[MIT](LICENSE) — 代码自由使用。

> ⚠️ 本工具不主张任何模型 / 动作 / 贴图文件的版权。用户加载的 PMX / VMD / 贴图文件受各自创作者许可约束，与本项目无关。
