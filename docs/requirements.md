# MikuMikuAR — 需求与技术文档

## 项目概述

MikuMikuAR 是一个跨平台 MMD PMX 模型查看器 / 聚合启动器。基于 Wails (Go) + babylon-mmd 技术栈，实现桌面三端（Windows / macOS / Linux）的 PMX 模型加载、VMD 动作播放、WASM Bullet 物理模拟，并具备本地模型库管理、生态聚合（DanceXR 共用、模之屋下载接管、Blender 唤起）能力。

> 核心价值定位详见 [`status.md`](status.md) §「核心价值定位」。

### 技术栈

| 层级 | 选型 |
|------|------|
| 桌面壳 | Wails v2 (Go + WebView2) |
| 前端框架 | Vite + TypeScript |
| 3D 渲染 | Babylon.js + babylon-mmd |
| 物理引擎 | WASM Bullet (MmdBulletPhysics) |
| 存储容器 | zip 原档 + 惰性 cache 解压 |

---

## 核心需求（按优先级）

### P0 — 壳选型（已完成）
- 使用 Wails (Go) 作为桌面壳
- Go 端提供文件对话框、文件读取、目录扫描等能力
- 前端通过 Wails Bind 调用 Go 方法

### P1 — 存储容器
- zip 作为统一原档格式
- 播模型时惰性解压到 cache 目录
- 模之屋下载 .rar/.7z 后解压重打包为 .zip
- DanceXR actors/ 原生认 zip 包

### P2 — 渲染层
- babylon-mmd 加载 PMX/PMD 模型
- VMD 动作播放
- WASM Bullet 物理模拟（MmdBulletPhysics 后端）
- SDEF / Grant / IK 完整支持
- 文件通过 `ReadFileBytes` / `ReadDirFiles` Go bind 从本地读取

### P3 — 聚合生态
1. **PMX 自身描述读取** — Rust 侧非必须，Go 侧可读 PMX header 前 1KB 提取 4 段 text
2. **DanceXR 文件夹共用** — 外部扫描 actors/，不修改 DanceXR 私有状态
3. **Blender 唤起** — 卡片上 "Edit in Blender" 按钮，Command 唤起

### P4 — Android（预留）
- 桌面三端跑通后再开
- Android 侧用 Capacitor 或等 Wails mobile 成熟

---

## 技术选型决策

### 为什么选 Wails (Go) 而不是 Tauri (Rust)
- Go 端生态成熟，PMX 解析有现成库
- Wails 直接使用系统 WebView2，包体小
- 项目已锁定 babylon-mmd（Web 渲染层），壳语言只影响 fs/下载/解压等周边能力

### 为什么选 zip 为主容器
- DanceXR actors/ 原生认 zip
- 四端（Win/Mac/Linux/Android）通用
- TGA/BMP 无压贴图 zip deflate 收益明显

### 为什么选 babylon-mmd
- WebGL2 + WebGPU 双后端
- WASM Bullet 物理批处理性能优于 ammo.js
- SDEF / IK / Grant 完整实现
- 手机中高端设备单模型可扛

### CORS 策略

桌面应用无跨站请求伪造（CSRF）风险，因此文件服务器统一设置 `Access-Control-Allow-Origin: *`（无条件允许）。详见 `app.go:corsMiddleware`。

> **架构说明**：每个模型/动作目录启动独立 HTTP 文件服务器（`StartFileServer`），绑定 `127.0.0.1:0`（随机端口）。所有响应通过 `corsMiddleware` 注入 CORS 头，配合 `basenameFallbackFS` 实现贴图路径容错。前端通过 `resolveFileUrl()` 统一构造 URL。

---

## 开发指南

### 环境要求
- Go 1.21+
- Node.js 18+
- Wails CLI

### 本地开发
```bash
cd MikuMikuAR
wails dev
```

### 构建
```bash
wails build
```

---

## DanceXR 功能对标与规划参考

> DanceXR 是 PMX/MMD 生态的标杆播放器。以下将其 10 大类 ~120 子功能按 MikuMikuAR 的「聚合管理器 + 播放器」定位进行对标。

### 标记说明

| 标记 | 含义 |
|------|------|
| ✅ 已覆盖 | MikuMikuAR 已有等价能力 |
| 📋 可规划 | 作为管理器应支持，有明确价值 |
| 🔄 转发层 | 转发给 DanceXR 执行，不自行实现 |
| ❌ 不适配 | VR/AR/NSFW 等，不涉及 |

### 1. ✨ 新功能与亮点

| 功能 | 标记 | 说明 |
|------|------|------|
| Discovery 资源发现 | 🔄 | DanceXR 内置，保留跳转入口 |
| Operator AI 后端 | 🔄 | AI 推理，不实现 |
| AI 语音聊天 | 🔄 | DanceXR PRO |
| 离线渲染录制 | 🔄 | DanceXR Creator |

### 2. 🤖 AI 功能

全部 🔄 — DanceXR 独有功能，MikuMikuAR 不实现。

### 3. 📦 模型支持

| 功能 | 标记 | 说明 |
|------|------|------|
| 模型文件整理 | ✅ | 扫描 + zip 容器已实现 |
| 标签系统 | ✅ | 自定义标签 + 分类过滤（Phase 1） |
| 加载选项 | 🔄 | DanceXR 运行时 |
| 播放列表 | ✅ | 保存模型顺序列表，从文件夹/标签/收藏自动生成，可排序删除 |
| 队形 | ✅ | arrangeModels() |
| ZIP 格式 | ✅ | 完整支持 |
| Bone Mapper | 🔄 | DanceXR 内部 |
| PMX Physics | ✅ | WASM Bullet |
| Blendshape Morph | ✅ | babylon-mmd |
| 角色预设 | 📋 P3 | 保存角色设置快照(物理/材质/服装/动作)→跨相似模型复用，存 presets/ 目录 |

### 4. 🎨 外观（竞品对标 — 提升至 P1）

> 竞品 MMD Viewer (纯 Web) 渲染调参极丰富。MikuMikuAR 需补齐。
> 标记：📋 = 自行实现  🔄 = 转发 DanceXR  ❌ = 不做

| 功能 | 标记 | 说明 |
|------|------|------|
| 材质参数调节 | ✅ | 按部位分类(皮肤/头发/眼睛/衣服)，调节 Diffuse/高光/Toon/SPH/SSS |
| 单独材质编辑器 | 📋 P2 | 逐材质独立调参，高亮定位，参数标记已修改 |
| 渲染预设系统 | ✅ | 5 内置预设 + 用户自定义（Phase 2） |
| 色调映射 | ✅ | 6 种色调映射算法（Phase 2） |
| 后处理滤镜 | ✅ | Bloom/FXAA/轮廓线/色彩校正（Phase 2） |
| 曝光 / FOV | ✅ | 曝光 ±2，FOV 20°~120°（Phase 2） |
| 重力控制 | ✅ | 衣物/头发物理摆动强度滑块 |
| 线框/骨骼显示切换 | ✅ | 场景 toggle 开关，参考 MmdOnlineStudioV1 |
| 模型统计信息 | ✅ | 顶点/面/骨骼/表情（Phase 5） |
| 表情(Facial morph)预览 | ✅ | morph 滑块实时调节（Phase 5） |

### 5. ⚡ 物理

核心 WASM Bullet ✅，增强物理（布料/粒子/软体/ragdoll）全部 🔄 属 DanceXR PRO。

### 6. 💃 动作与媒体

| 功能 | 标记 | 说明 |
|------|------|------|
| VMD 加载/播放 | ✅ | 完整链路 |
| 多模型 VMD 绑定 | ✅ | targetModelId |
| 自动循环 | ✅ | auto-loop |
| 暂停/播放 | ✅ | 空格键 |
| 进度条拖拽 | ✅ | pointer events |
| 程序化动作 | 🔄 | DanceXR 运行时 |
| 眨眼/呼吸/眼神 | 🔄 | 运行时角色行为 |
| 音乐同步 | ✅ | MP3/WAV/OGG 加载，与 VMD 同步播放（Phase 3） |
| 音频偏移 | ✅ | 音频与 VMD 时间偏移调整（Phase 3） |
| 音视频播放 | 🔄/❌ | 视频播放器❌，空间音频🔄 |
| 舞蹈套装 | ✅ | VMD+音频捆绑包（Phase 3） |
| 姿势文件 .vpd | 📋 P3 | 加载 .vpd/.pose 静态姿势，支持姿势序列(自动过渡动画)，跨格式骨骼角度调整 |
| VMD2PNG / Remix / Override | 🔄 | DanceXR PRO |
| 相机 VMD | ✅ | 读取 camera VMD 轨道，驱动相机动画（Phase 3） |

### 7. 🌍 氛围与环境

| 功能 | 标记 | 说明 |
|------|------|------|
| 场景基础光照 | ✅ | 已有 |
| 参考地面 | ✅ | 已有 |
| 场景保存/加载 | 📋 P1 | 捕获完整状态(模型/VMD/舞台/灯光/相机/队形)，用库标识符引用资源避免路径依赖，缺失跳过不失败；另有场景包=场景文件+资源文件便于分发 |
| 天空/水/粒子/舞台/道具 | ❌ | 渲染环境，不规划 |
| 光线追踪 | ❌ | 高性能渲染 |

### 8. 🎥 相机

| 功能 | 标记 | 说明 |
|------|------|------|
| 轨道相机 + auto-framing | ✅ | 默认实现 |
| 多相机模式 | 📋 P3 | Freefly/One-shot/Concert |

### 9. ⚙️ 系统与平台

| 功能 | 标记 | 说明 |
|------|------|------|
| 内容库管理 | ✅ | 全面实现 |
| 应用设置 | ✅ | config.json |
| 键盘快捷键 | ✅ | 空格/←/→/Esc |
| 多语言 | 📋 P4 | UI 国际化 |
| 软件管理 | 📋 P3 | 扫描 software/ 目录，菜单栏自动识别 .exe |
| 自动更新 | ❌ | 后续考虑 |
| VR/AR/移动端 | ❌ | 不适配 |

### 10. 🔞 全部 ❌

### 规划优先级汇总

| 优先级 | 功能 | 预估 | 状态 |
|--------|------|------|------|
| **P1** | 标签系统 | 中型 | ✅ 已完成 |
| **P1** | 渲染预设 + 色调映射 | 中型 | ✅ 已完成 |
| **P1** | 后处理滤镜 (Bloom/轮廓线/色彩校正) | 中型 | ✅ 已完成 |
| **P1** | 材质参数调节 (按部位) | 中型 | ✅ 已完成 |
| **P1** | 曝光 / FOV 控制 | 小型 | ✅ 已完成 |
| **P1** | 音乐同步 | 小型 | ✅ 已完成 |
| **P1** | 场景保存/加载 | 中型 | ✅ 已完成 |
| **P1** | 单独材质编辑器 | 中型 | 📋 待实现 |
| **P2** | 舞蹈套装（VMD+音频） | 小型 | ✅ 已完成 |
| **P2** | 相机 VMD | 小型 | ✅ 已完成 |
| **P2** | 批量截图 | 小型 | ✅ 已完成 |
| **P2** | 导出到 MMD 软件 | 小型 | ✅ 已完成 |
| **P2** | 播放列表 | 小型 | ✅ 已完成 |
| **P2** | 模型统计信息 | 小型 | ✅ 已完成 |
| **P2** | 线框/骨骼显示切换 | 小型 | ✅ 已完成 |
| **P2** | 表情(Facial morph)预览 | 小型 | ✅ 已完成 |
| **P2** | 音频偏移 | 小型 | ✅ 已完成 |
| **P2** | 重力控制 | 小型 | ✅ 已完成 |
| **P3** | 多相机模式 | 中型 | 📋 待实现 |
| **P3** | 模型加载预设 | 小型 | 📋 待实现 |
| **P3** | VPD 姿势导入 | 小型 | 📋 待实现 |
| **P3** | 软件管理 | 小型 | 📋 待实现 |
| **P3** | 多语言 UI | 中型 | 📋 待实现 |
