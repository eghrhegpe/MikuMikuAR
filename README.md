# 🎵 MikuMikuAR

> 基于 Wails v3 + Babylon.js / babylon-mmd 的跨平台 MMD 桌面播放器——
> PMX 模型查看、VMD 动作播放、即时换装、程序化舞蹈、XPBD 布料物理，一处搞定。

[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go)](https://go.dev/)
[![Wails](https://img.shields.io/badge/Wails-v3-DF0000?logo=wails)](https://wails.io)
[![Babylon.js](https://img.shields.io/badge/Babylon.js-MMD-AD1F23?logo=babylondotjs)](https://babylonjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

| 平台 | 状态 |
|------|------|
| 🪟 Windows | ✅ 已验证 |
| 🤖 Android | ✅ 实验性（c-shared + WebView） |
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

- **Go 1.25+**
- **Node.js 18+**（前端构建）
- Wails v3 CLI（可选，仅用于 `dev` 热重载）：`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`

### 开发运行

```bash
# 方式一：纯 Go 构建（无 Wails CLI 依赖，官方推荐）
go build -o MikuMikuAR.exe .

# 方式二：Wails v3 热重载开发（需 wails3 CLI）
wails3 dev -config ./build/config.yml -port 9245
```

### 生产构建（平台脚本）

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -Production

# Linux
bash scripts/build-linux.sh

# 或通过 Taskfile
task build        # 当前平台
task package      # 打包发布版
```

构建产物输出到 `bin/`，单文件可执行 `MikuMikuAR.exe` 也在仓库根。

---

## 📁 项目结构

```
MikuMikuAR/
├── app.go                  # Go 后端 Binding（文件IO / HTTP服务器 / 扫描 / 下载 / Blender）
├── pmx.go                  # PMX header 二进制解析
├── main.go / main_android.gen.go   # Wails 应用入口（桌面 + Android）
├── internal/               # Go 内部包
├── Taskfile.yml            # Wails v3 任务编排
├── build/                  # 各平台构建配置（windows/darwin/linux/ios/android）
├── scripts/                # 构建 / E2E 脚本
├── tests/                  # 契约测试
├── frontend/src/
│   ├── core/               # 入口 / 共享状态 / 文件URL / 图标
│   ├── scene/              # 3D 场景编排
│   │   ├── camera/         # 相机模式
│   │   ├── motion/         # VMD / 程序化动作 / LipSync / 播放
│   │   ├── manager/        # ModelManager / 材质 / 加载 / 操作
│   │   ├── env/            # 环境（天空/水面/云/粒子/光照推导）
│   │   └── render/         # 渲染管线 / 灯光 / 性能降级
│   ├── menus/              # SlideMenu 通用导航 + 各弹窗（库/模型/动作/环境/设置）
│   ├── motion/             # 程序化动作算法 / VMD写入 / VPD解析 / 节拍检测
│   ├── outfit/             # 换装核心 + 音频
│   └── physics/            # XPBD 求解器 / 布料 / SDF碰撞器 / 调试渲染
└── docs/                   # 项目文档（架构 / 状态 / 路线图 / ADR / 修复流程）
```

> 前端已于 2026-07 按业务域拆分为 `core / scene / menus / motion / outfit / physics`，详见 [`AGENTS.md`](AGENTS.md) 文档地图。

---

## 📖 文档

> 本项目有一份面向 AI 协作的「文档宪法」[AGENTS.md](AGENTS.md)——它定义了谁该读什么、怎么改、怎么并发，也含完整文档地图。

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
| [决策档案](docs/adr/) | ADR-001 ~ ADR-024 关键设计决策 |

---

## ⚠️ 已知限制

- **贴图兼容性** — 部分 PMX 贴图路径不标准（`../tex/` vs `textures/`），已经 `basenameFallbackFS` 兜底，但不保证 100% 覆盖
- **Blender 编辑** — 需用户自行安装 [mmd_tools](https://github.com/powroupi/blender_mmd_tools) 插件，否则 Blender 无法打开 PMX
- **Android 实验** — `main_android.gen.go` 用 c-shared 模式 + WebView，文件访问受 Scoped Storage 约束（见 [ADR-023](docs/adr/adr-023-android-file-access-strategy.md)）
- **跨平台路径** — Blender 自动检测仅覆盖 Windows，macOS/Linux 需在设置中手动配置

---

## 🤝 贡献

本项目采用单仓多 AI 协作流。改动前请先通读 [AGENTS.md](AGENTS.md) 的「文档地图」与「多 AI 并发约束」——它会告诉你哪些文件互斥、哪些函数可复用（见 `docs/reusables.md`）。

## 📜 许可

[MIT](LICENSE) — 本项目代码自由使用。

> ⚠️ 本工具不主张任何模型 / 动作 / 贴图文件的版权。用户加载的 PMX / VMD / 贴图文件可能受其各自创作者的许可限制，与本项目无关。

## 🙏 致谢

- [babylon-mmd](https://github.com/noname0310/babylon-mmd) — Babylon.js MMD 渲染引擎
- [Wails](https://wails.io) — Go + WebView 桌面框架
- [DanceXR](https://github.com/Chewhern/DanceXR) — 目录结构与功能对标参考
