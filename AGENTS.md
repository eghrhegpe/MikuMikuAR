# MikuMikuAR — AI 代理入职指南

> **你是 AI 代理。本文件是项目的「文档宪法」——它定义你能读什么、不能读什么。**
> **读完本文件即可开始工作。需要深水区信息时，按「文档地图」定向跳转，禁止自由探索。**

## 启动约束（复制粘贴到会话开头）

```
本次任务硬约束：
- 只读 AGENTS.md §一「文档地图」列出的文件
- 禁止 ls / glob / 目录枚举
- 建议启动子代理（task / explore / research）
- 禁止读取 docs/research/ 下的档案文件，除非任务明确涉及对应主题
- 先输出修改计划 → 我确认 → 再 apply
- 失败熔断：同一命令连续失败 2 次 → 停止并分析原因，禁止无脑重试
- 仓库根 = 本文件所在目录；代码子目录 = `MikuMikuAR/`；文档目录 = `docs/`；不是嵌套仓库
- git 操作在仓库根执行；go build / npm / vitest 进 `MikuMikuAR/` 对应子目录执行
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
├── status.md             # 📊 项目现状 + 路线图 + Bug 记录 ← 每次会话起步必读
├── architecture.md       # 🏗️ 架构与技术方案（Wails 骨架、PMX/VMD/纹理/zip等）
├── naming.md             # 📛 命名决策记录（项目名演变、历史名称对照）
├── menu-architecture.md  # 📐 菜单架构设计（MenuStack 用法 + 添加新功能流程）
├── fix-cycle.md          # 🧪 修复周期与验收契约（Bug 修复流程模板）
├── reusables.md          # 🔧 复用函数索引（AI 写代码前先查）
├── design-archive.md     # 🗑️ UI 设计归档（已否决的设计方案，供参考）
├── troubleshooting.md    # 🐛 故障排查（CORS、WASM 404、纹理不显示）
├── outfits-spec.md       # 👗 服装变体配置指南（换装系统用户文档）
├── adr/                  # 📜 决策记录（15条，adr-001 ~ adr-015）
├── research/             # 🧊 调研归档 — 禁止自由读取，按需索引
    ├── pmx-ecosystem.md
    ├── tech-stack-comparison.md
    ├── dancexr-structure.md
    ├── dancexr-directory.md
    ├── pmx-header-layout.md
    └── blender-integration.md
```

### 1.2 关键文件速查

| 场景 | 读哪些文件 |
|------|-----------|
| **每次会话起步** | 本文件 |
| **接新任务** | `docs/requirements.md`（需求全貌）→ `docs/status.md`（当前状态 + 阻塞点） |
| **改 Go 逻辑** | `docs/architecture.md`（整体架构）→ `MikuMikuAR/app.go` |
| **改前端渲染** | `docs/architecture.md`（PMX/VMD 环节）→ `MikuMikuAR/frontend/src/scene.ts` |
| **换装 / 纹理变体** | `docs/architecture.md` §16 → `frontend/src/outfit.ts` + `frontend/src/outfit-ui.ts` |
| **音频 / VMD 同步** | `frontend/src/audio.ts` |
| **场景菜单 / 相机 / 灯光 / 渲染** | `docs/architecture.md` §渲染环节 → `frontend/src/scene-menu.ts` + `frontend/src/camera.ts` |
| **环境 / 天空 / 粒子** | `frontend/src/env-menu.ts` + `frontend/src/env-lighting.ts` |
| **模型详情 / 材质调节 / 表情** | `frontend/src/model-detail.ts` + `frontend/src/model-material.ts` |
| **文件 URL / HTTP 服务器 / 安全隔离** | `docs/architecture.md` §数据通道 | `frontend/src/fileservice.ts` |
| **程序化动作 / 节拍检测** | `frontend/src/procedural-motion.ts` + `frontend/src/beat-detector.ts` |
| **模型库 / 扫描 / zip 解压 / 缩略图** | `docs/architecture.md` §模型库管理 | `frontend/src/library-core.ts` + `frontend/src/library.ts` |
| **VPD 姿势导入** | `frontend/src/vpd-parser.ts` |
| **LipSync** | `frontend/src/lipsync.ts` |
| **模型预设** | `frontend/src/model-preset.ts` + `docs/architecture.md` §场景序列化 |
| **动作库弹窗 / 音乐 / 舞蹈套装** | `frontend/src/motion-popup.ts` |
| **遇到加载问题** | `docs/troubleshooting.md` |
| **查项目地基** | `docs/foundation.md` |
| **查命名演变** | `docs/naming.md` |
| **查已否决设计** | `docs/design-archive.md` |
| **查修复流程模板** | `docs/fix-cycle.md` |
| **查复用函数索引** | `docs/reusables.md` |
| **查菜单架构 + 添加新功能** | `docs/menu-architecture.md` |
| **查技术选型理由** | `docs/requirements.md` §「技术选型决策」 |
| **查项目路线图** | `docs/status.md` §「开发路线图」 |
| **查调研细节** | 先问用户 → 再读 `docs/research/` 对应文件 |

### 1.3 任务触发索引

**按任务关键词自动查表，不需要全读文档，按需 grep + 读段落。**

| 任务关键词 | 优先读 | 其次读 |
|-----------|--------|--------|
| MenuStack / 添加菜单项 / 弹窗导航 / `modelStack` | `docs/menu-architecture.md` | `frontend/src/menu.ts` |
| 前端 UI / CSS / 样式修改 | `docs/menu-architecture.md`（CSS 类说明） | `frontend/src/app.css` |
| 3D 场景 / 模型加载 / PMX / VMD / 播放 | `docs/architecture.md` §渲染环节 | `frontend/src/scene.ts` |
| 模型库 / 扫描 / zip 解压 / 缩略图 | `docs/architecture.md` §模型库管理 | `frontend/src/library-core.ts` + `frontend/src/library.ts` |
| 文件 URL / HTTP 服务器 / 安全隔离 | `docs/architecture.md` §数据通道 | `frontend/src/fileservice.ts` |
| 相机 / 灯光 / 渲染参数 / 后处理 | `docs/architecture.md` §渲染环节 | `frontend/src/scene-menu.ts` + `frontend/src/camera.ts` |
| 环境 / 天空 / 粒子 / 地面 | `docs/architecture.md` §环境系统 | `frontend/src/env-menu.ts` + `frontend/src/env-lighting.ts` |
| 材质调节 / 按部位 / 逐材质调参 | `docs/architecture.md` §材质系统 | `frontend/src/scene.ts`（`_catOf`/`_applyAll`/`setMatParams`）+ `frontend/src/model-material.ts` |
| 模型详情 / 模型信息 / 可见性 / 变换 | `frontend/src/model-detail.ts`（`build*Level`） | `frontend/src/library-core.ts`（入口） |
| 配置 / 外部库 / Blender / MMD | `docs/architecture.md` §生态聚合 | `frontend/src/settings.ts` |
| 场景序列化 / 自动保存 / libraryRef | `docs/architecture.md` §场景序列化 | `frontend/src/scene.ts` |
| 修复 / Bug / 崩溃 / 不显示 | `docs/troubleshooting.md` | `docs/fix-cycle.md` |
| Go 后端 / Binding / 文件操作 | `docs/architecture.md` §Go 后端 | `MikuMikuAR/app.go` |
| 换装 / 纹理变体 / outfits.json | `docs/architecture.md` §16 | `frontend/src/outfit.ts` + `frontend/src/outfit-ui.ts` |
| 音频 / 音乐 / VMD 同步 | `frontend/src/audio.ts` | `frontend/src/scene.ts`（`syncAudioPlayback`） |
| 程序化动作 / Idle / Auto Dance | `frontend/src/procedural-motion.ts` | `frontend/src/beat-detector.ts` |
| VPD 姿势导入 | `frontend/src/vpd-parser.ts` | `docs/architecture.md` §VMD 环节 |
| LipSync / 口型同步 | `frontend/src/lipsync.ts` | — |
| 舞蹈套装 / 动作库弹窗 | `frontend/src/motion-popup.ts` | `frontend/src/library-core.ts` |
| 模型预设 / 自动应用 | `frontend/src/model-preset.ts` | `frontend/src/model-detail.ts`（`buildPresetListLevel`） |
| 任何新增函数 | `docs/reusables.md`（先查是否已存在） | — |

> `reusables.md` 是写代码前必查的索引表，不是让你全读的。按函数名/场景 grep。 |

> `docs/research/` 是历史调研归档，**默认不读**，除非用户明确说「查一下 research 里关于 X 的结论」。

---

## 二、工作流规则

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
cd MikuMikuAR && go build ./... 2>&1

# 前端改了
cd MikuMikuAR/frontend && npx vite build 2>&1
```

不攒多个修改。一个改一个 build。

### 2.4 构建失败处理

1. **立即回滚** → 撤销修改
2. **诊断原因** → 读完整错误信息
3. **修复后重试** → 小步修改，每次构建验证

---

## 三、项目速查

### 3.1 仓库结构总览

```
仓库根（本文件所在目录）
├── AGENTS.md          # 🔑 AI 入口（本文件）
├── docs/              # 📖 项目文档（需求/架构/状态/ADR 等）
├── .github/           # GitHub Issue 模板
├── .env.example       # 环境变量示例
└── MikuMikuAR/        # 📦 代码子目录（Go + 前端）
    ├── app.go         # Wails Binding 入口（文件IO、对话框、HTTP文件服务器）
    ├── main.go        # Wails 应用入口
    ├── go.mod         # Go 依赖
    ├── wails.json     # Wails 配置
    ├── tests/
    │   └── test_config_syntax.py   # 契约测试
    └── scripts/
        └── build.ps1               # 构建验证脚本
```

### 3.2 Go 端（MikuMikuAR/ 下）

Go 端核心文件：
- `app.go` — Wails Binding 入口（文件IO/HTTP服务器/扫描/标签/预设/换装）
- `pmx.go` — PMX Header 二进制解析
- `main.go` — Wails 应用入口

### 3.3 前端

```
MikuMikuAR/frontend/
├── src/
│   ├── main.ts           # ★ 入口 — 事件绑定 + 快捷键 + 初始化
│   ├── config.ts         # ★ 共享状态 + DOM 引用 + 类型定义 + 工具函数
│   ├── scene.ts          # ★ 3D 场景 + PMX/VMD 加载 + 物理引擎 + 播放控制
│   ├── audio.ts          # 音乐播放 + VMD 同步 + 节拍检测挂载
│   ├── camera.ts         # 相机模式管理（轨道/自由飞行/镜头预设/演唱会）
│   ├── fileservice.ts    # 统一文件 URL 解析层（resolveFileUrl）
│   ├── menu.ts           # MenuStack 通用菜单导航组件
│   ├── library.ts        # 模型库弹窗入口（MenuStack 初始化）
│   ├── library-core.ts   # 模型库核心（扫描/搜索/构建层级/标签）
│   ├── model-detail.ts   # 模型详情子菜单（信息/变换/可见性/标签/表情/材质）
│   ├── model-material.ts # 逐材质调参子菜单
│   ├── model-preset.ts   # 模型预设保存/加载
│   ├── outfit.ts         # 换装系统（loadOutfits/applyOutfitVariant/resetOutfit）
│   ├── outfit-ui.ts      # 服装变体子菜单 UI
│   ├── scene-menu.ts     # 场景弹窗（相机/灯光/渲染/音乐/程序化动作）
│   ├── motion-popup.ts   # 动作库弹窗（VMD/姿势/舞蹈套装）
│   ├── settings.ts       # 设置页 + 外部库管理
│   ├── env-menu.ts       # 环境弹窗（天空/地面/粒子/风/云）
│   ├── env-lighting.ts   # 环境光照推导
│   ├── icons.ts          # Iconify 图标注册表
│   ├── ui-helpers.ts     # DOM 构建函数（slideRow/addToggleRow/addSliderRow）
│   ├── vpd-parser.ts     # VPD 姿势导入 → VMD 帧转换
│   ├── vmd-writer.ts     # VMD 二进制写入（程序化动作用）
│   ├── procedural-motion.ts  # 程序化动作（Idle Motion / Auto Dance）
│   ├── beat-detector.ts  # 音乐节拍检测
│   ├── lipsync.ts        # 口型同步
│   └── app.css           # 全局样式（CSS 变量体系）
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts       # Vite 配置（optimizeDeps.exclude babylon-mmd）
```

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
| `init()` | `main.ts` | 应用启动入口 |
| keyboard shortcuts | `main.ts` | Ctrl+1/2/3/4, Space, Escape, ←/→, WASD |
| seek bar events | `main.ts` | pointerdown/move/up |
| `closeAllOverlays()` | `config.ts` | 关闭所有弹窗 |

#### 3D 场景 & 模型

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `engine`, `scene`, `camera` | `scene.ts` | Babylon.js 核心对象 |
| `initScene()` | `scene.ts` | 注册 MMD loader、创建 runtime、地面 |
| `loadPMXFile()` | `scene.ts` | HTTP 加载 PMX + `createMmdModel` |
| `loadVMDMotion()` | `scene.ts` | ArrayBuffer → VMD → `createRuntimeAnimation` |
| `loadVMDFromPath()` | `scene.ts` | 路径→HTTP fetch→`loadVMDMotion` |
| `removeModel()` | `scene.ts` | 销毁 MMD 模型 + 清理 mesh |
| `focusModel()` | `scene.ts` | 相机自动 framing |
| `arrangeModels()` | `scene.ts` | 多模型横向排列 |
| `updatePlaybackUI()` | `scene.ts` | 进度条 + 时间显示 |
| `seekFromEvent()` | `scene.ts` | 点击/拖拽定位 |

#### 模型库 & 弹窗

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `togglePopup()`, `showPopup()`, `hidePopup()` | `library.ts` | 模型库弹窗开关 |
| `showMotionPopup()`, `hideMotionPopup()` | `library.ts` | 动作库弹窗开关 |
| `initLibrary()` | `library.ts` | 启动时加载配置 + 扫描模型库 |
| `refreshLibrary()` | `library.ts` | 重新扫描 + 刷新弹窗 |
| `loadThumbnailsForLevel()` | `library.ts` | 批量加载缩略图 |
| `ensureModelMeta()` | `library.ts` | 按需解析 PMX header |
| `buildLevel()`, `modelToRow()`, `onModelRowClick()` | `library-core.ts` | 文件浏览层级构建 |
| `handlePopupSearchInput()` | `library.ts` | 搜索输入处理 |
| `showSettings()` | `settings.ts` | 设置页（MenuStack） |
| `buildSettings*Level()`, `handleSettingsAction()` | `settings.ts` | 设置页各层级构建与选项处理 |
| `renderExternalList()` | `settings.ts` | 外部库管理列表 |
| `MenuStack` | `menu.ts` | 通用菜单导航组件 |

#### 相机

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `switchCameraMode()` | `camera.ts` | 切换相机模式 |
| `getCameraMode()` | `camera.ts` | 当前模式 |
| `freeflyInput` | `camera.ts` | WASD 自由飞行输入状态 |

#### 共享状态 & 工具

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `mmdRuntime`, `modelRegistry` | `config.ts` | 全局可变状态 |
| `libraryRoot`, `allModels`, `popupStack` | `config.ts` | 模型库/弹窗状态 |
| `thumbnailCache`, `modelMetaCache` | `config.ts` | 内存缓存 |
| `displayNamePriority`, `cameraMode` | `config.ts` | 用户偏好 |
| `dom` | `config.ts` | 所有 DOM 元素引用 |
| `setStatus()`, `showHint()`, `hideHint()` | `config.ts` | 底部状态栏 |
| `formatTime()`, `toBase64()`, `escapeHtml()`, `normPath()` | `config.ts` | 纯工具函数 |

#### 图标

| 函数/符号 | 文件 | 说明 |
|-----------|------|------|
| `getLucideIconMap()` | `icons.ts` | Lucide SVG 图标名称→JSX 映射（已废弃，迁移至 Iconify） |

---

## 四、沟通风格

- 简洁：能用 1 句话不说 2 句
- 精确：给行号、文件路径、函数名
- 结构化：表格 > 段落
- 不废话：不做无谓的「总的来说」「总结一下」
- 不改不拆：发现不够改的问题先问「要修吗」

---

## 五、环境提示

- **Shell**：优先用 `bash`
- **路径分隔符**：统一正斜杠 `/`
- **调试日志用完即删**：`console.log` / `fmt.Print` 测试完后**必须请示用户确认**再删
- **发版**：`cd MikuMikuAR && wails build`

---

## 六、会话边界

### 什么时候开新窗口

当前会话出现以下任一情况时，**关闭当前会话，开新窗口继续**：

| 条件 | 原因 |
|------|------|
| ✅ 一个功能做完，验收通过 | 上下文干净，下个功能从头开始 |
| ✅ 新功能与当前会话无关（不同模块、不同文件） | 避免无关代码污染上下文 |
| ✅ 会话超过 30 轮 AI 交互 | 上下文窗口前半段被压缩，AI 开始遗忘早期约定 |
| ✅ AI 开始重复问同一个问题 | 退化信号，换窗口恢复精度 |

### 新窗口加载清单

```
1. AGENTS.md（项目宪法 + 文档地图）
2. docs/status.md（当前状态 + 阻塞点）
3. 本次任务的 spec（你写的需求描述或 fix-cycle.md 模板）
4. docs/reusables.md（复用函数索引）
5. "本次不改的文件不要读"（你指定的范围）
```

不给：之前会话的完整对话记录、不相关模块的代码、`docs/research/`。

### AI 的义务

- AI 发现自己走过 20 轮还没收尾 → 主动提醒「是否拆小或开新窗口」
- AI 发现自己需要反复读同一段代码来理解 → 建议提取到 `docs/reusables.md`

---

## 七、多 AI 并发约束（重要）

### 7.1 文件级互斥

| 文件 | 最多同时修改的 AI 数 | 原因 |
|------|----------------------|------|
| `frontend/src/config.ts` | **1** | 共享类型定义，合并冲突极高 |
| `frontend/src/scene.ts` | **1** | 模块级副作用（import 即执行），diff 三向合并必碎 |
| `frontend/src/model-detail.ts` | **1** | 同上 |
| `app.go` | **1** | Wails binding 注册表，同名 binding 覆盖无提示 |
| `frontend/wailsjs/go/` | **0**（不手动改） | Wails 自动生成，谁 build 谁覆盖 |
| 其余 `*.ts` / `*.go` | 不限制 | 函数级新增，冲突概率低 |

### 7.2 操作纪律

1. **改前 `git pull && git log --oneline -5`** — 确认 HEAD 不是别人的半成品
2. **不改已声明「本会话独占」的文件** — 如果另一个 AI 先占了 config.ts，你去改 scene 需要等它提交
3. **新增类型优先放独立文件** — 避免 config.ts 成为瓶颈
4. **提交前检查 tsc 基线** — 先 `git stash` → `npx tsc --noEmit` 确认基线错误数 → `git stash pop` 后确认未新增
5. **`wails dev / build` 只在一个 AI 上跑** — 自动生成文件会覆盖其他人的 binding
6. **测试文件名带系统前缀** — 如 `outfit.test.ts` ✓，`test-helpers.ts` ✗（冲突）

### 7.3 冲突时的熔断

```bash
git stash                  # 暂存自己
git pull --rebase          # 变基拉取
git stash pop              # 解暂存
# 如果 pop 失败（文件级冲突）：
git checkout --theirs path # 接受对方版本，重新 apply 自己的改动
```
