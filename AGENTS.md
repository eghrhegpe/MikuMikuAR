# MikuMikuAR — AI 代理入职指南

> 你是《MikuMikuAR 联邦》的首席架构师。
> 回复需简洁精准，直接给出符合 TypeScript/Babylon.js 最佳实践的结论、代码或方案。
> 在非技术闲聊时，多用技术隐喻（城邦、议会、整顿），流露一丝幽默感。
> 本文件是项目的「文档宪法」——它定义你能读什么、不能读什么。
> 读完本文件即可开始工作。需要深水区信息时，按「文档地图」定向跳转，禁止自由探索。

## 启动约束（复制粘贴到会话开头）

```
本次任务硬约束：
- 只读 AGENTS.md §一「文档地图」列出的文件
- 禁止 ls / glob / 目录枚举
- 建议启动子代理（task / explore / research）
- 禁止读取 docs/research/ 下的档案文件，除非任务明确涉及对应主题
- 先输出修改计划 → 我确认 → 再 apply
- 失败熔断：同一命令连续失败 2 次 → 停止并分析原因，禁止无脑重试
- 仓库根 = 本文件所在目录；Go 代码在根目录；前端代码在 `frontend/`；文档目录 = `docs/`
- git 操作在仓库根执行；go build 在仓库根执行；npm / vitest 进 `frontend/` 执行
```

---

## 〇、索引即契约

**本节的每一条都是硬约束。违反 = 浪费时间 + 浪费 token。**

### 禁止操作

| # | 禁止 | 原因 | 正确做法 |
|---|------|------|----------|
| 1 | **禁止递归扫描 `docs/`** | 污染上下文 | 只读「文档地图」列出的文件 |
| 2 | **禁止读取 `docs/research/` 下任何文件** | 归档调研，日常任务零价值 | 除非用户明确说「查 research」 |
| 3 | **禁止用 `ls` 探索未知目录** | Token 黑洞 | 查 AGENTS.md 文档地图，没有的目录不存在 |
| 4 | **禁止全量读取大文件** | 文件再大也先 grep | 一律先 `grep` 关键词，再读匹配段落 |

### 跨目录引用自检

**任何 Markdown 链接写完后，必须确认目标文件存在。** 断链 = 下一个 AI 被误导。

```
# ✅ 正确：目标存在
[架构方案](docs/architecture.md)

# ❌ 错误：目标不存在（文件已改名/已移动）
[旧名](old-file.md)
```

---

## 一、文档地图

### 1.1 目录用途

```
docs/
├── README.md             📖 文档目录索引（人类浏览用）
├── AGENTS.md             # 🔑 AI 入口（本文件）— 文档宪法，必须先读
├── foundation.md         # 🏛️ 项目地基 — AI 不可自行修改
├── requirements.md       # 📋 需求 + 技术选型（P0-P4 优先级、选型理由）
├── status.md             # 📊 项目现状 + Bug 记录 + 快捷键 ← 每次会话起步必读
├── roadmap.md            # 🗺️ 路线图 + DanceXR 对标 + 下一步规划
├── architecture.md       # 🏗️ 架构与技术方案（Wails 骨架、PMX/VMD/纹理/zip等）
├── glossary.md           # 📖 术语表 + 历史命名（解释性词典，面向新读者）
├── terminology.md        # 📝 代码级规范（图标/状态栏/Go 错误/命名约定，面向开发者）
├── menu-architecture.md  # 📐 菜单架构设计（MenuStack 用法 + 添加新功能流程）
├── design.md             # 🎨 UI 设计规范（lcard/cs-row/preset-chip/折叠/分区体系）
├── fix-cycle.md          # 🧪 修复周期与验收契约（Bug 修复流程模板）
├── reusables.md          # 🔧 复用函数索引（AI 写代码前先查）
├── design-archive.md     # 🗑️ UI 设计归档（已否决的设计方案，供参考）
├── troubleshooting.md    # 🐛 故障排查（CORS、WASM 404、纹理不显示）
├── outfits-spec.md       # 👗 服装变体配置指南（换装系统用户文档）
├── adr/                  # 📜 决策记录（28条，adr-001 ~ adr-028）
├── changelog/            # 📋 变更记录（分阶段总结）
├── research/             # 🧊 调研归档 — AI 默认不读
│   ├── pmx-ecosystem.md
│   ├── tech-stack-comparison.md
│   ├── dancexr-structure.md
│   ├── dancexr-directory.md
│   ├── pmx-header-layout.md
│   ├── blender-integration.md
│   ├── mmd-tools-analysis.md
│   └── dancexr-zh/       # DanceXR 中文文档整站镜像（~200 文件）
├── audit-2026-06-30.md   # 🔍 前端全模块审计记录（第二轮）
```

> 📁 **嵌套 AGENTS.md**：[`frontend/AGENTS.md`](frontend/AGENTS.md) — 前端子包专用（构建/测试/TS 约定/目录索引）。改前端代码时优先读它。

### 1.2 关键文件速查

| 场景 | 读哪些文件 |
|------|-----------|
| **每次会话起步** | 本文件 |
| **接新任务** | `docs/requirements.md`（需求全貌）→ `docs/status.md`（当前状态）→ `docs/roadmap.md`（路线图） |
| **改前端代码** | [`frontend/AGENTS.md`](frontend/AGENTS.md)（前端构建/测试/TS 约定）→ 需要的子模块 |
| **改 Go 逻辑** | `docs/architecture.md`（整体架构）→ `app.go` |
| **改前端渲染** | `docs/architecture.md`（PMX/VMD 环节）→ `frontend/src/scene/scene.ts` |
| **换装 / 纹理变体** | `docs/architecture.md` §16 → `frontend/src/outfit/outfit.ts` + `frontend/src/menus/outfit-ui.ts` |
| **音频 / VMD 同步** | `frontend/src/outfit/audio.ts` |
| **场景菜单 / 灯光 / 渲染** | `docs/architecture.md` §渲染环节 → `frontend/src/menus/scene-menu.ts` + `frontend/src/menus/scene-render-levels.ts` |
| **环境 / 天空 / 粒子** | `frontend/src/menus/env-menu.ts` + `frontend/src/menus/env-feature-levels.ts` + `frontend/src/scene/env/env-lighting.ts` |
| **模型详情 / 材质调节 / 表情** | `frontend/src/menus/model-detail.ts` + `frontend/src/menus/model-material.ts` |
| **文件 URL / HTTP 服务器 / 安全隔离** | `docs/architecture.md` §数据通道 | `frontend/src/core/fileservice.ts` |
| **程序化动作 / 节拍检测** | `frontend/src/motion/procedural-motion.ts` + `frontend/src/motion/beat-detector.ts` |
| **模型库 / 扫描 / zip 解压 / 缩略图** | `docs/architecture.md` §模型库管理 | `frontend/src/menus/library-core.ts` + `frontend/src/menus/library.ts` |
| **VPD 姿势导入** | `frontend/src/motion/vpd-parser.ts` |
| **LipSync** | `frontend/src/motion/lipsync.ts` |
| **模型预设** | `frontend/src/menus/model-preset.ts` + `docs/architecture.md` §场景序列化 |
| **动作库弹窗 / 音乐 / 舞蹈套装** | `frontend/src/menus/motion-popup.ts` + `frontend/src/menus/motion-camera-levels.ts` + `frontend/src/menus/motion-cloth-levels.ts` + `internal/app/dancesets.go`（Go binding） |
| **遇到加载问题** | `docs/troubleshooting.md` |
| **查项目地基** | `docs/foundation.md` |
| **查命名演变 / 术语** | `docs/glossary.md` |
| **查代码级规范** | `docs/terminology.md` |
| **查已否决设计** | `docs/design-archive.md` |
| **查修复流程模板** | `docs/fix-cycle.md` |
| **查复用函数索引** | `docs/reusables.md` |
| **查菜单架构 + 添加新功能** | `docs/menu-architecture.md` |
| **查技术选型理由** | `docs/requirements.md` §「技术选型决策」 |
| **查项目路线图** | `docs/roadmap.md` |
| **查调研细节** | 先问用户 → 再读 `docs/research/` 对应文件 |
| **调子代理 / 多 AI 并发 / 会话边界** | [`docs/multi-ai.md`](docs/multi-ai.md) |
| **工作流细则（改前/改后/环境）** | [`docs/workflow.md`](docs/workflow.md) |

### 1.3 任务触发索引

**按任务关键词自动查表，不需要全读文档，按需 grep + 读段落。**

| 任务关键词 | 优先读 | 其次读 |
|-----------|--------|--------|
| MenuStack / 添加菜单项 / 弹窗导航 / `modelStack` | `docs/menu-architecture.md` | `frontend/src/menus/menu.ts` |
| 前端 UI / CSS / 样式修改 / 新增组件 | `docs/design.md`（组件规范） | `frontend/src/app.css` |
| 界面统一 / lcard / cs-row / preset-chip / 折叠 | `docs/design.md` | `frontend/src/menus/env-menu.ts` 等 |
| 3D 场景 / 模型加载 / PMX / VMD / 播放 | `docs/architecture.md` §渲染环节 | `frontend/src/scene/scene.ts` |
| 模型库 / 扫描 / zip 解压 / 缩略图 | `docs/architecture.md` §模型库管理 | `frontend/src/menus/library-core.ts` + `frontend/src/menus/library.ts` |
| 文件 URL / HTTP 服务器 / 安全隔离 | `docs/architecture.md` §数据通道 | `frontend/src/core/fileservice.ts` |
| 相机 / 灯光 / 渲染参数 / 后处理 | `docs/architecture.md` §渲染环节 | `frontend/src/menus/motion-camera-levels.ts` + `frontend/src/menus/scene-render-levels.ts` |
| 环境 / 天空 / 粒子 / 地面 | `docs/architecture.md` §环境系统 | `frontend/src/menus/env-menu.ts` + `frontend/src/menus/env-feature-levels.ts` |
| 材质调节 / 按部位 / 逐材质调参 | `docs/architecture.md` §材质系统 | `frontend/src/scene/manager/material.ts`（`_catOf`/`_applyAll`/`setMatParams`）+ `frontend/src/menus/model-material.ts` |
| 模型详情 / 模型信息 / 可见性 / 变换 | `frontend/src/menus/model-detail.ts`（`build*Level`） | `frontend/src/scene/manager/model-manager.ts`（ModelManager）+ `frontend/src/scene/scene.ts`（`focusedModelId`） |
| 配置 / 外部库 / Blender / MMD | `docs/architecture.md` §生态聚合 | `frontend/src/menus/settings.ts` |
| 场景序列化 / 自动保存 / libraryRef | `docs/architecture.md` §场景序列化 | `frontend/src/scene/scene.ts` |
| 修复 / Bug / 崩溃 / 不显示 | `docs/troubleshooting.md` | `docs/fix-cycle.md` |
| Go 后端 / Binding / 文件操作 | `docs/architecture.md` §Go 后端 | `app.go` |
| 换装 / 纹理变体 / outfits.json | `docs/architecture.md` §16 | `frontend/src/outfit/outfit.ts` + `frontend/src/menus/outfit-ui.ts` |
| 音频 / 音乐 / VMD 同步 | `frontend/src/outfit/audio.ts` | `frontend/src/scene/scene.ts`（`syncAudioPlayback`） |
| 程序化动作 / Idle / Auto Dance | `frontend/src/motion/procedural-motion.ts` | `frontend/src/menus/motion-procmotion-levels.ts`（UI）+ `frontend/src/motion/beat-detector.ts` |
| VPD 姿势导入 | `frontend/src/motion/vpd-parser.ts` | `docs/architecture.md` §VMD 环节 |
| LipSync / 口型同步 | `frontend/src/motion/lipsync.ts` | `frontend/src/scene/motion/lipsync-bridge.ts` + `frontend/src/menus/motion-procmotion-levels.ts`（UI） |
| 舞蹈套装 / 动作库弹窗 | `frontend/src/menus/motion-dance-sets.ts` | `frontend/src/menus/motion-popup.ts` + `frontend/src/menus/library-core.ts` |
| 模型预设 / 自动应用 | `frontend/src/menus/model-preset.ts` | `frontend/src/menus/model-detail.ts`（`buildPresetListLevel`） |
| XPBD / 布料 / 物理模拟 / 软体 | `frontend/src/physics/xpbd-solver.ts` | `frontend/src/physics/xpbd-cloth.ts` + `cloth-manager.ts` |
| SDF / 碰撞胶囊 / 身体碰撞 | `frontend/src/physics/xpbd-collider.ts` | `frontend/src/physics/cloth-manager.ts` |
| VMD 生成 / 程序化动作 VMD | `frontend/src/motion/vmd-writer.ts` | `frontend/src/motion/procedural-motion.ts` |
| VPD 姿势导入 / 文本解析 | `frontend/src/motion/vpd-parser.ts` | `frontend/src/motion/vmd-writer.ts` |
| 环境预设 / envAutoLink / 时间流转 | `frontend/src/scene/env/env-bridge.ts` | `frontend/src/scene/env/env-lighting.ts` |
| 灯光过渡 / shadowBias / 阴影重建 | `frontend/src/scene/render/lighting.ts` | `frontend/src/scene/env/env-bridge.ts` |
| SlideMenu / 菜单动画 / dispose | `frontend/src/menus/menu.ts` | `docs/menu-architecture.md` |
| 节拍检测 / BPM / BeatDetector | `frontend/src/motion/beat-detector.ts` | `frontend/src/outfit/audio.ts` |
| 音频 / 音量 / GainNode | `frontend/src/outfit/audio.ts` | `frontend/src/motion/beat-detector.ts` |
| 性能降级 / FPS / 渲染质量 | `frontend/src/scene/render/performance.ts` | — |
| 软件管理 / MMD / Blender / 自定义软件 | `frontend/src/menus/settings-software.ts` | `frontend/src/menus/settings.ts` |
| 任何新增函数 | `docs/reusables.md`（先查是否已存在） | — |

> `reusables.md` 是写代码前必查的索引表，不是让你全读的。按函数名/场景 grep。 |

> `docs/research/` 是历史调研归档，**默认不读**，除非用户明确说「查一下 research 里关于 X 的结论」。

---

## 二、工作流规则

> 细则（环境约定/会话边界/失败熔断）→ 见 [`docs/workflow.md`](docs/workflow.md)
> 本节只列**高频项**：改前读文件 + 改完立即构建。

### 2.1 确认当前状态

```bash
git log --oneline -5
```

### 2.2 改前读文件

**禁止基于记忆修改。** 每次改前先确认最新状态：

- `read_file` — 读文件内容
- `grep` — 搜索关键词
- `lsp_*` — 查代码符号
- **写新函数前先查 `docs/reusables.md`** — 已有现成函数时不重复实现

**灵活处理**：
- 小文件 / 近期刚看过 → 直接改
- 不确定是否变更 → 先用 `read_file` 确认
- 搜索没找到 → 不报错，先尝试修改看构建结果
- **核心原则**：保持进度，不过度谨慎

### 2.3 改完立即构建

```bash
# Go 改了
cd <repo-root> && go build ./... 2>&1

# 前端改了
cd frontend && npx vite build 2>&1
```

不攒多个修改。一个改一个 build。

### 2.4 构建失败处理

1. **立即回滚** → 撤销修改
2. **诊断原因** → 读完整错误信息
3. **修复后重试** → 小步修改，每次构建验证

### 2.5 research/ 隔离规则

> ⚠️ 除非用户明确提及 `research/` 下的文件路径，否则 AI 不主动读取 `docs/research/` 目录下的任何文档。违反即污染上下文。

---

## 三、项目速查

### 3.1 仓库结构总览

```
仓库根（本文件所在目录）
├── AGENTS.md          # 🔑 AI 入口（本文件）
├── app.go             # Wails Binding 入口（Go 后端）
├── main.go            # Wails 应用入口
├── go.mod             # Go 依赖
├── Taskfile.yml       # Wails v3 任务配置
├── frontend/         # 前端源码（Vite + TypeScript + Babylon.js）
├── build/            # Wails 构建配置
├── internal/         # Go 内部包
├── tests/            # 测试脚本
├── scripts/          # 构建脚本
├── docs/              # 📖 项目文档（需求/架构/状态/ADR 等）
├── .github/           # GitHub Actions CI
└── .env.example       # 环境变量示例
```

### 3.2 Go 端（仓库根）

Go 端核心文件（均在仓库根目录）：
- `app.go` — Wails Binding 入口（文件IO/HTTP服务器/扫描/标签/预设/换装）
- `pmx.go` — PMX Header 二进制解析
- `main.go` — Wails 应用入口

### 3.3 前端

```
frontend/
├── src/
│   ├── core/
│   │   ├── main.ts           # ★ 入口 — 事件绑定 + 快捷键 + 初始化
│   │   ├── config.ts         # ★ 共享状态 + DOM 引用 + 类型定义 + 工具函数
│   │   ├── fileservice.ts    # 统一文件 URL 解析层（resolveFileUrl）
│   │   ├── icons.ts          # Iconify 图标创建函数（createIconifyIcon）
│   │   ├── iconify-registry.ts # Iconify 本地图标注册表（自动生成，图标常量定义）
│   │   └── ui-helpers.ts     # DOM 构建函数（slideRow/addToggleRow/addSliderRow）
│   ├── scene/
│   │   ├── scene.ts              # ★ 3D 场景编排入口
│   │   ├── scene-serialize.ts    # 场景序列化
│   │   ├── camera/
│   │   │   └── camera.ts         # 相机模式管理
│   │   ├── motion/               # 动作桥接（依赖 Babylon.js）
│   │   │   ├── vmd-loader.ts     # VMD 加载/播放入口
│   │   │   ├── proc-motion-bridge.ts # 程序化动作桥接
│   │   │   ├── lipsync-bridge.ts # LipSync 桥接
│   │   │   └── playback.ts       # 播放控制（进度条/seek）
│   │   ├── manager/              # 模型管理器（依赖 Babylon.js）
│   │   │   ├── model-manager.ts  # ModelManager（模型注册表 + 生命周期）
│   │   │   ├── material.ts       # 材质系统（分类/逐材质/序列化）
│   │   │   ├── model-loader.ts   # PMX 加载 + 缩略图
│   │   │   └── model-ops.ts      # 模型操作（变换/可见性/VMD清空）
│   │   ├── env/                  # 环境系统（依赖 Babylon.js）
│   │   │   ├── env.ts            # 环境系统门面
│   │   │   ├── env-impl.ts       # 环境实现（天空/地面/雾/云/水/粒子/风）
│   │   │   ├── env-bridge.ts     # 环境→灯光联动 + 预设 + 时间流转
│   │   │   ├── env-water.ts      # 水面系统（Gerstner波浪+焦散+水下）
│   │   │   ├── env-clouds.ts     # 体积云
│   │   │   ├── env-particles.ts  # 粒子（雨/雪/樱花/落叶/萤火虫/烟花）
│   │   │   ├── env-lighting.ts   # 光照推导（天空色→方向光参数）
│   │   │   └── props.ts          # 道具系统
│   │   └── render/               # 渲染管线（依赖 Babylon.js）
│   │       ├── renderer.ts       # 渲染管线（Bloom/DOF/色调映射/边缘）
│   │       ├── lighting.ts       # 灯光 + 阴影生成器 + 太阳盘
│   │       └── performance.ts    # 性能降级
│   ├── menus/
│   │   ├── menu.ts                      # SlideMenu 通用菜单导航（动画 + 键盘）
│   │   ├── library.ts                   # 模型库入口 barrel
│   │   ├── library-core.ts              # 模型库核心（扫描/搜索/层级/标签）
│   │   ├── model-detail.ts              # 模型详情（信息/变换/可见性/标签/表情）
│   │   ├── model-material.ts            # 逐材质 + 分类调参
│   │   ├── model-preset.ts              # 模型预设保存/加载/库管理/自动应用
│   │   ├── outfit-ui.ts                 # 服装变体子菜单
│   │   │
│   │   ├── scene-menu.ts                # 场景弹窗入口 + 路由器
│   │   ├── scene-render-levels.ts       #   后处理/舞台/渲染预设
│   │   │
│   │   ├── env-menu.ts                  # 环境弹窗入口 + 导航
│   │   ├── env-feature-levels.ts        #   天空/地面/水面/风/云/实验功能
│   │   ├── scene-prop-levels.ts         #   道具系统（从 env 迁入 scene）
│   │   ├── env-preset-levels.ts         #   环境预设（内置 + 用户保存）
│   │   │
│   │   ├── motion-popup.ts              # 动作弹窗入口 + 动作绑定/音乐/相机
│   │   ├── motion-camera-levels.ts      #   相机模式 + 参数面板
│   │   ├── motion-procmotion-levels.ts  #   程序化动作 + LipSync
│   │   ├── motion-dance-sets.ts         #   舞蹈套装数据 + UI
│   │   ├── motion-cloth-levels.ts       #   布料参数面板
│   │   │
│   │   ├── settings.ts                  # 设置页（UI/主题/字体/外部库）
│   │   └── settings-software.ts         #   软件管理子菜单（MMD/Blender/自定义软件）
│   ├── motion/
│   │   ├── procedural-motion.ts # 程序化动作（Idle/AutoDance VMD生成）
│   │   ├── vmd-writer.ts     # VMD 二进制写入（Shift-JIS骨骼名）
│   │   ├── vpd-parser.ts     # VPD 姿势解析→VMD转换
│   │   ├── beat-detector.ts  # 音乐节拍检测（Web Audio API）
│   │   └── lipsync.ts        # 口型同步（振幅→morph权重）
│   ├── outfit/
│   │   ├── outfit.ts         # 换装核心（load/apply/reset + 自动发现）
│   │   └── audio.ts          # 音频播放 + VMD同步 + 节拍检测挂载
│   ├── physics/
│   │   ├── xpbd-solver.ts    # XPBD 核心求解器（Verlet+约束+地面碰撞）
│   │   ├── xpbd-cloth.ts     # 布料生成 + 网格更新 + 每帧回调
│   │   ├── xpbd-collider.ts  # SDF 胶囊碰撞体
│   │   ├── xpbd-renderer.ts  # 调试可视化（粒子/约束/胶囊线框）
│   │   └── cloth-manager.ts  # 布料管理器（创建/销毁/重建/碰撞缩放）
│   └── app.css               # 全局样式（CSS 变量体系）
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts            # Vite 配置
```

> 📁 目录重组记录：2026-07 scene/ 按业务域拆分为 camera/motion/manager/env/render 子目录。相机 UI 迁移到 motion-popup。physics/ 为独立目录（XPBD 引擎），motion/ 为动作算法独立目录。

### 3.4 技术栈速览

| 层级 | 选型 |
|------|------|
| 桌面壳 | Wails v2 (Go + WebView2) |
| 前端框架 | Vite + TypeScript |
| 3D 渲染 | Babylon.js + babylon-mmd |
| 物理引擎 | WASM Bullet (MmdBulletPhysics) |
| 存储容器 | zip 原档 + 惰性 cache 解压 |

---

### 3.5 函数映射表（AI 找代码用）

改前端功能时先查此表定位文件，避免在错误的文件中搜索。

#### 入口 & 事件

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `init()` | `core/main.ts` | 应用启动入口 |
| keyboard shortcuts | `core/main.ts` | Ctrl+1/2/3/4, Space, Escape, ←/→, WASD |
| seek bar events | `core/main.ts` | pointerdown/move/up |
| `closeAllOverlays()` | `core/config.ts` | 关闭所有弹窗 |

#### 3D 场景 & 模型

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `engine`, `scene`, `camera` | `scene/scene.ts` | Babylon.js 核心对象 |
| `initScene()` | `scene/scene.ts` | 注册 MMD loader、创建 runtime、地面 |
| `loadPMXFile()` | `scene/scene.ts` | HTTP 加载 PMX + `createMmdModel` |
| `loadVMDMotion()` | `scene/motion/vmd-loader.ts` | ArrayBuffer → VMD → `createRuntimeAnimation` |
| `loadVMDFromPath()` | `scene/motion/vmd-loader.ts` | 路径→HTTP fetch→`loadVMDMotion` |
| `loadCameraVmdFromPath()` | `scene/motion/vmd-loader.ts` | VMD 文件→相机轨道 |
| `loadVPDPose()` | `scene/motion/vmd-loader.ts` | VPD 姿势→VMD 帧→绑定 |
| `removeModel()` | `scene/scene.ts`（委托 modelManager） | 销毁 MMD 模型 + 清理 mesh |
| `focusModel()` | `scene/scene.ts`（委托 modelManager） | 相机自动 framing |
| `arrangeModels()` | `scene/scene.ts`（委托 modelManager） | 多模型横向排列 |
| `updatePlaybackUI()` | `scene/motion/playback.ts` | 进度条 + 时间显示 |
| `seekFromEvent()` | `scene/motion/playback.ts` | 点击/拖拽定位 |
| `ModelManager` | `scene/manager/model-manager.ts` | 模型注册表 + 生命周期 + 属性管理 |
| `focusedMmdModel()` | `scene/manager/model-manager.ts`（->modelManager） | 当前聚焦模型的 WASM 对象 |
| `focusedModel()` | `scene/manager/model-manager.ts`（->modelManager） | 当前聚焦模型实例 |
| `removeModel()` / `focusModel()` / `arrangeModels()` | `scene/manager/model-ops.ts` | 模型生命周期操作（委托 modelManager） |
| `setModelVisibility()` / `setModelOpacity()` | `scene/manager/model-ops.ts` | 可见性/透明度 |
| `setModelWireframe()` / `setModelBoneLinesVis()` | `scene/manager/model-ops.ts` | 线框/骨骼调试 |
| `setModelPhysics()` / `setPhysicsCategory()` | `scene/manager/model-ops.ts` | 物理开关/按分类控制 |
| `setModelScaling()` / `setModelRotationY()` / `setModelPosition()` | `scene/manager/model-ops.ts` | 变换操作 |
| `stopVMD()` / `applyVPDPose()` | `scene/manager/model-ops.ts` | VMD 停止/VPD 姿势应用 |
| `setModelMorphWeight()` / `resetModelMorphs()` | `scene/manager/model-ops.ts` | 表情权重/重置 |
| `_catOf()`, `_applyAll()`, `setMatParams()` | `scene/manager/material.ts` | 材质分类/批量应用/按类设参 |

#### 模型库 & 弹窗

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `togglePopup()`, `showPopup()`, `hidePopup()` | `menus/library.ts` | 模型库弹窗开关 |
| `showMotionPopup()`, `hideMotionPopup()` | `menus/library.ts` | 动作库弹窗开关 |
| `refreshMotionRoot()` | `menus/motion-popup.ts` | 重算动作弹窗根级 items + reRender（toggle/slider 状态变化后调用）|
| `refreshEnvRoot()` | `menus/env-menu.ts` | 重算环境弹窗根级 items + reRender |
| `initLibrary()` | `menus/library.ts` | 启动时加载配置 + 扫描模型库 |
| `refreshLibrary()` | `menus/library.ts` | 重新扫描 + 刷新弹窗 |
| `loadThumbnailsForLevel()` | `menus/library.ts` | 批量加载缩略图 |
| `ensureModelMeta()` | `menus/library.ts` | 按需解析 PMX header |
| `buildLevel()`, `modelToRow()`, `onModelRowClick()` | `menus/library-core.ts` | 文件浏览层级构建 |
| `handlePopupSearchInput()` | `menus/library.ts` | 搜索输入处理 |
| `showSettings()` | `menus/settings.ts` | 设置页（MenuStack） |
| `buildSettings*Level()`, `handleSettingsAction()` | `menus/settings.ts` | 设置页各层级构建与选项处理 |
| `renderExternalList()` | `menus/settings.ts` | 外部库管理列表 |
| `buildSettingsSoftwareLevel()` | `menus/settings-software.ts` | 软件管理子菜单（MMD/Blender/自定义） |
| `detectMMD()` / `setBlenderPath()` / `setMMDPath()` | `menus/settings-software.ts` | 路径设置 API |
| `scanSoftwareDir()` | `menus/settings-software.ts` | 软件目录扫描 |
| `MenuStack` | `menus/menu.ts` | 通用菜单导航组件 |

#### 相机

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `switchCameraMode()` | `scene/camera/camera.ts` | 切换相机模式 |
| `getCameraMode()` | `scene/camera/camera.ts` | 当前模式 |
| `freeflyInput` | `scene/camera/camera.ts` | WASD 自由飞行输入状态 |
| `hasCameraVmd()`, `clearCameraVmd()`, `animateCameraVmd()` | `scene/camera/camera.ts` | 相机 VMD 轨道 |
| `buildCameraLevel()` / `buildCameraParamsLevel()` | `menus/motion-camera-levels.ts` | 相机 UI 面板（在动作弹窗中） |

#### 共享状态 & 工具

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `mmdRuntime`, `modelRegistry` | `core/config.ts` | 全局可变状态 |
| `libraryRoot`, `allModels`, `popupStack` | `core/config.ts` | 模型库/弹窗状态 |
| `thumbnailCache`, `modelMetaCache` | `core/config.ts` | 内存缓存 |
| `displayNamePriority`, `cameraMode` | `core/config.ts` | 用户偏好 |
| `dom` | `core/config.ts` | 所有 DOM 元素引用 |
| `setStatus()`, `showHint()`, `hideHint()` | `core/config.ts` | 底部状态栏 |
| `formatTime()`, `toBase64()`, `escapeHtml()` | `core/config.ts` | 纯工具函数 |
| `normPath()` | `core/fileservice.ts` | 路径标准化（原在 config.ts） |

#### 图标

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `createIconifyIcon()` | `core/icons.ts` | Iconify 图标元素创建（替代旧 Lucide SVG） |

#### XPBD 物理引擎

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `XpbdSolver` | `physics/xpbd-solver.ts` | XPBD 求解器（Verlet 积分 + 约束求解 + 地面碰撞）|
| `createCloth()` | `physics/xpbd-cloth.ts` | 创建布料实例（粒子网格 + 约束 + Mesh）|
| `buildClothUpdateFn()` | `physics/xpbd-cloth.ts` | 构建布料每帧更新闭包（锚定+碰撞+step+Mesh更新）|
| `SdfCollider` | `physics/xpbd-collider.ts` | SDF 胶囊碰撞器（13个身体胶囊 + 粒子碰撞求解）|
| `DEFAULT_BODY_CAPSULES` | `physics/xpbd-collider.ts` | 默认身体胶囊规格 |
| `XpbdRenderer` | `physics/xpbd-renderer.ts` | 调试可视化（粒子球/约束线/胶囊线框）|
| `toggleCloth()` / `recreateCloth()` | `physics/cloth-manager.ts` | 布料开关/重建（UI入口）|
| `disposeCloth()` | `physics/xpbd-cloth.ts` | 销毁布料实例 |

#### 程序化动作 & VMD

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `generateIdleVmd()` | `motion/procedural-motion.ts` | 生成 Idle 动作 VMD（呼吸+眨眼）|
| `generateAutoDanceVmd()` | `motion/procedural-motion.ts` | 生成 AutoDance VMD（节拍驱动律动）|
| `buildVmd()` | `motion/vmd-writer.ts` | VMD 二进制构建（含 Shift-JIS 编码表）|
| `loadVPDFromBuffer()` | `motion/vpd-parser.ts` | VPD 文本解析→VMD 二进制 |
| `BeatDetector` | `motion/beat-detector.ts` | 节拍检测器（attach/dispose/setVolume/getLevel/getBPM）|
| `amplitudeToWeight()` / `findLipMorph()` | `motion/lipsync.ts` | 振幅→morph权重映射 + morph名查找 |
| `buildProcMotionLevel()` / `buildProcMotionModeLevel()` | `menus/motion-procmotion-levels.ts` | 程序化动作面板（mode/参数/自动切换）|
| `buildLipSyncLevel()` | `menus/motion-procmotion-levels.ts` | LipSync 面板（启用/灵敏度）|

#### 环境系统

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `initLighting()` / `setLightState()` / `transitionLighting()` | `scene/render/lighting.ts` | 灯光初始化/设置/平滑过渡 |
| `setSkipLightAutoSave()` | `scene/render/lighting.ts` | 预设动画期间抑制灯光自动保存 |
| `initEnvFacade()` / `applyEnvState()` | `scene/scene-env.ts` | 环境门面入口 |
| `setEnvState()` / `redoEnvAutoLink()` | `scene/env/env-bridge.ts` | 环境状态设置 + 光照联动 |
| `applyEnvPreset()` | `scene/env/env-bridge.ts` | 环境预设切换（带取消机制）|
| `deriveLighting()` / `ENV_PRESETS` | `scene/env/env-lighting.ts` | 天空色→光照参数推导 + 预设表 |
| `createWater()` / `disposeWater()` | `scene/env/env-water.ts` | 水面创建/销毁 |
| `createParticleEmitter()` / `updateParticleWind()` | `scene/env/env-particles.ts` | 粒子系统 |
| `createClouds()` / `disposeClouds()` | `scene/env/env-clouds.ts` | 体积云 |

#### 材质系统

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `_catOf()` / `_applyAll()` / `setMatParams()` | `scene/manager/material.ts` | 材质分类/批量应用/逐材质设参 |
| `_capture()` | `scene/manager/material.ts` | 材质原始值捕获（模型加载时预调用）|
| `getMatCatGroups()` / `getMatDetailList()` | `scene/manager/material.ts` | 材质分组/详情查询 |
| `resetMatCatParams()` / `disposeModelMaterialState()` | `scene/manager/material.ts` | 重置分类参数 + 清理模型材质状态 |

---

## 四、多 AI 并发约束（重要）

> 已独立成 [`docs/multi-ai.md`](docs/multi-ai.md)：文件级互斥 + 操作纪律 + 冲突熔断 + 子代理速查。

---

## 五、审计记录

> 审计详情移入独立文件 → [`docs/audit-2026-06-30.md`](docs/audit-2026-06-30.md)

---

## 六、沟通风格

> 已迁入 [`docs/terminology.md`](docs/terminology.md) §九「开发沟通风格」。

---

## 七、环境提示 / 会话边界 / 多 AI / 子代理

> 全部迁出：
> - 环境 + 会话边界 → [`docs/workflow.md`](docs/workflow.md)
> - 多 AI 并发 + 子代理详情 → [`docs/multi-ai.md`](docs/multi-ai.md)

