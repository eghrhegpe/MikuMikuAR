# frontend/ — 前端子包专用 AGENTS.md

> **定位**：前端构建/测试/TypeScript 约定/目录索引。
> AI 在 `frontend/` 内编辑时优先读本文件；根 [`AGENTS.md`](../AGENTS.md) 是项目宪法 + 全局文档地图。
> 与本项目其他文档的关系见 AGENTS.md §一「文档地图」。

---

## 一、构建与测试命令

> **执行位置**：所有命令在 `frontend/` 目录内执行。

| 命令 | 用途 | 说明 |
|------|------|------|
| `npm run dev` | 启动 Vite 开发服务器（HMR） | 仅开发态，不调用 Wails binding |
| `npm run build` | 生产构建 | = `tsc && vite build`，先类型检查再打包 |
| `npm run build:dev` | 仅 vite build（跳过 tsc） | 快速验证 bundle 能否产出 |
| `npm run check` | 类型检查（`tsc --noEmit`） | **改完前端必跑**，验证未新增 tsc 错误 |
| `npm run test` | Vitest 单元测试（run 模式） | 一次性跑全量测试 |
| `npm run test:watch` | Vitest 监听模式 | 修改测试文件自动重跑 |
| `npm run test:coverage` | Vitest + 覆盖率 | v8 provider |
| `npm run test:e2e` | Playwright E2E | 端到端测试 |
| `npm run test:e2e:headed` | Playwright 有界面模式 | 调试用 |
| `npm run lint` | ESLint 检查 | `eslint src --ext .ts,.tsx,.js,.jsx` |
| `npm run lint:fix` | ESLint 自动修复 | |
| `npm run format` | Prettier 格式化 | 写代码后跑一次 |
| `npm run format:check` | Prettier 检查 | CI 用 |

### 高频最小集

```bash
# 改完一段代码后
npm run check && npm run test && npm run build
```

### tsc 基线检查（多 AI 协作时）

```bash
git add .                                              # 暂存自己
git commit -m "chore: cache work before check"        # 本地缓存（不触发 pre-commit）
npm run check                                          # 记录基线错误数
git reset --soft HEAD~1                                # 撤销缓存，改动放回暂存区
npm run check                                          # 确认未新增错误
```

> ⚠️ 禁止使用 `git stash`，多 AI 协作下 `git stash pop` 会产生大量工作区冲突。统一使用 `git commit` + `git reset --soft` 做本地缓存（详见根 AGENTS.md 本地缓存章节）。

---

## 二、TypeScript 约定

### 2.1 `tsconfig.json` 当前状态

| 选项 | 当前值 | 含义 |
|------|--------|------|
| `strict` | **`false`** | 历史遗留，未启用严格模式 |
| `target` / `module` | `ESNext` | 现代 ES |
| `moduleResolution` | `Bundler` | 配合 Vite |
| `noUnusedLocals` / `noUnusedParameters` | `false` | 不报未使用 |
| `noImplicitReturns` | `false` | 不报缺失 return |
| `isolatedModules` | `true` | 配合 esbuild 单文件转译 |
| `skipLibCheck` | `true` | 跳过 node_modules 类型检查 |
| `baseUrl` | `"."` | 路径别名基准 |
| `paths` | `@/*` → `src/*`、`@bindings/*` → `bindings/*` | 路径别名（2026-07-08 添加） |
| `include` | `src`, `bindings` | Wails 生成的 binding 也参与类型检查 |

### 2.2 写新代码的约定

> ⚠️ **如实记录现状，不承诺 strict 化政策**。靠 code review 人工把关。

- **不要新增 `any` 逃生** — 即使 `strict: false` 允许，新代码仍要避免 `as any` / `@ts-ignore` / `@ts-expect-error`。需要时加注释说明业务理由。
- **类型定义就近放置** — 项目**没有**集中的 `src/types/` 目录。interface/type 与使用它的文件同模块放置；跨模块共享类型放 `core/types.ts`（config.ts 已拆分为 types / state / dom / utils 四个子模块，通过 barrel re-export 保持 import 兼容）。
- **路径别名** — `tsconfig.json` 配置了 `@/` → `src/`、`@bindings/` → `bindings/` 别名（2026-07-08 添加）。新代码优先使用别名导入，已有代码逐步迁移。
- **binding 自动生成（禁手写 `bindings/`）** — `frontend/bindings/` 由 `wails3 generate bindings -ts -i -d frontend/bindings ./...`（= `npm run generate:bindings`）自动产出 .ts 绑定，含全部 `export function` 包装与 FNV-1a 32-bit method ID（**生成器自动算，无需手写**）。新增/删除 Go 方法后**重跑生成器**即可，禁止手维护 `bindings/` 下 .ts（手写多余且易漂移）。`app.contract.test.ts` 动态校验导出函数存在性 + FNV-1a ID，仅作生成器输出一致性护栏。`src/core/wails-bindings.ts`（model 类型登记 + re-export 聚合）**不归生成器管、保持手维护**（生成器只写 `bindings/`，不碰 `src/`）。**唯一真陷阱：`-clean` 默认 true 会先清空输出目录**——脚本已带 `-d frontend/bindings` 故安全；切勿裸跑 `wails3 generate bindings -dry`（仍会清空默认目录，已踩坑并用 `git restore frontend/bindings` 救回）。TS 侧统一通过 `src/core/wails-bindings.ts` re-export 引入。

---

## 三、前端目录索引

> 更新于 2026-07-13（v1.3.1 发布线）

```
frontend/src/
├── core/                     # ★ 基础设施
│   ├── main.ts               # 应用入口（事件绑定 + 快捷键 + 初始化）
│   ├── config.ts             # barrel re-export → types.ts / state.ts / dom.ts / utils.ts
│   ├── types.ts              # 全局类型定义
│   ├── state.ts              # UI/环境状态管理
│   ├── fileservice.ts        # resolveFileUrl 统一文件 URL 解析
│   ├── dialog.ts             # 通用对话框
│   ├── reactivity.ts         # 简易响应式（signal / effect）
│   ├── wails-bindings.ts     # Wails Go binding 类型封装（手维护，不归生成器管）
│   ├── audio-bus.ts          # 音效总线（ADR-088）
│   ├── load-manager.ts       # 资源加载管理器
│   ├── shortcut-registry.ts  # 快捷键注册表
│   ├── status-bar.ts         # 状态栏组件
│   ├── toast.ts              # Toast 提示
│   ├── platform.ts           # 平台判断（桌面 vs Android）
│   ├── icons.ts              # Iconify 图标创建
│   ├── icons-bundle.ts       # 本地图标包
│   ├── orbit.ts              # 轨道控制
│   ├── ui-helpers.ts         # DOM 构建工具（slideRow / addToggleRow 等）
│   ├── ui-types.ts           # UI 组件类型定义
│   ├── ui-rows.ts            # 通用行组件
│   ├── ui-slide-row.ts       # 滑块行
│   ├── ui-advanced-rows.ts   # 高级行组件
│   ├── ui-collapsible.ts     # 可折叠面板
│   ├── ui-fullscreen-overlay.ts # 全屏覆盖层
│   ├── ui-virtual-grid.ts    # 虚拟网格
│   ├── ui-resource-panel.ts  # 资源面板（目录记忆，ADR-090）
│   ├── i18n/                 # 国际化（5 语言：zh-CN/zh-TW/ja/en/ko）
│   │   └── locales/
│   └── __tests__/            # 单元测试
│       └── shortcut-registry.test.ts
│
├── scene/                    # 3D 场景（Babylon.js）
│   ├── scene.ts              # ★ 场景编排入口
│   ├── scene-bundle.ts       # 场景模块聚合导出
│   ├── scene-serialize.ts    # 场景序列化
│   ├── camera/               # 相机模式
│   ├── render/               # 渲染管线
│   │   ├── renderer.ts       # 渲染器
│   │   ├── lighting.ts       # 灯光管理
│   │   ├── lighting-presets.ts # 灯光预设
│   │   ├── performance.ts    # 性能监控
│   │   └── transform-gizmo.ts # 变换控制器
│   ├── manager/              # 模型管理
│   │   ├── model-manager.ts  # 模型管理器
│   │   ├── model-loader.ts   # 模型加载器
│   │   ├── model-ops.ts      # 模型操作
│   │   └── material.ts       # 材质管理
│   ├── motion/               # ★ 动作桥接层（ADR-079 感知层 + ADR-086 猫步）
│   │   ├── perception.ts     # 感知层总入口（呼吸/眨眼/注视/表情/平衡/LipSync）
│   │   ├── perception-balance.ts    # 平衡系统
│   │   ├── perception-blinking.ts   # 眨眼系统
│   │   ├── perception-breathing.ts  # 呼吸系统
│   │   ├── perception-expression.ts # 表情系统
│   │   ├── perception-gaze.ts       # 注视系统（总入口）
│   │   ├── perception-gaze-js.ts    # 注视 JS 实现
│   │   ├── perception-gaze-wasm.ts  # 注视 WASM 实现
│   │   ├── perception-lipsync.ts    # LipSync 层
│   │   ├── perception-shared.ts     # 共享工具
│   │   ├── feet-adjustment.ts       # 脚部地面跟随（ADR-085）
│   │   ├── footstep.ts              # 脚步声触发（ADR-088）
│   │   ├── bone-override.ts         # 骨骼覆盖
│   │   ├── vmd-layers.ts            # VMD 图层管理
│   │   ├── wasm-layers-blender.ts   # WASM 图层混合器
│   │   ├── wasm-layers-config.ts    # WASM 图层配置
│   │   ├── vmd-loader.ts            # VMD 加载器
│   │   ├── proc-motion-bridge.ts    # 程序化动作桥接
│   │   ├── lipsync-bridge.ts        # LipSync 桥接
│   │   └── playback.ts              # 播放控制
│   ├── physics/              # 物理（WASM Bullet）
│   │   ├── skirt-analyzer.ts  # 裙装分析器（ADR-084）
│   │   └── virtual-skirt.ts   # 虚拟裙骨（ADR-084）
│   ├── env/                  # ★ 环境系统（ADR-091/092 贴图与反射统一）
│   │   ├── env.ts             # 环境状态总入口
│   │   ├── env-impl.ts        # 环境实现
│   │   ├── env-bridge.ts      # 环境桥接
│   │   ├── env-terrain.ts     # 地形（ADR-089 模式拆分）
│   │   ├── env-texture.ts     # 纹理工厂（ADR-091）
│   │   ├── env-water.ts       # 水面 + 平面反射（ADR-092）
│   │   ├── env-clouds.ts      # 云层
│   │   ├── env-particles.ts   # 粒子
│   │   ├── env-lighting.ts    # 环境灯光
│   │   ├── accessory.ts       # 配件
│   │   ├── props.ts           # 道具
│   │   └── planar-reflection.ts # 平面反射引擎（ADR-092）
│   ├── ar/                   # AR 场景（ADR-055）
│   │   ├── ar-camera.ts
│   │   └── ar-scene.ts
│   └── pose/                 # 构图与水印
│       ├── camera-angle.ts
│       ├── composition-guide.ts
│       └── watermark.ts
│
├── menus/                    # ★ 声明式菜单系统（ADR-093 Schema 全量落地）
│   ├── menu.ts               # 通用菜单导航组件
│   ├── menu-schema.ts        # ★ 声明式 Schema 核心（ControlSpec / MenuNode / StatePath）
│   ├── menu-factory.ts       # Schema 渲染器
│   │
│   │── library.ts            # 模型库主菜单
│   │── library-core.ts       # 库核心（扫描/搜索/层级/标签）
│   │── model-detail.ts       # 模型详情
│   │── model-material.ts     # 材质编辑器
│   │── model-preset.ts       # 预设管理
│   │
│   │── env-menu.ts           # 环境菜单总入口
│   │── env-feature-levels.ts # 环境功能层级
│   │── env-preset-levels.ts  # 环境预设层级
│   │
│   │── motion-popup.ts       # 动作菜单总入口
│   │── motion-camera-levels.ts    # 相机控制
│   │── motion-cloth-levels.ts     # 布料质量（ADR-084）
│   │── motion-feet-levels.ts      # 脚部调整（ADR-085）
│   │── motion-gaze-levels.ts      # 注视控制
│   │── motion-override-levels.ts  # 骨骼覆盖
│   │── motion-pose-levels.ts      # 姿势控制
│   │── motion-procmotion-levels.ts # 程序化动作
│   │
│   │── scene-menu.ts         # 场景菜单总入口
│   │── scene-physics-levels.ts    # 物理设置
│   │── scene-prop-levels.ts       # 道具管理
│   │── scene-render-levels.ts     # 渲染设置
│   │── scene-render-presets.ts    # 渲染预设
│   │── scene-stage-levels.ts      # 舞台设置
│   │── scene-stage-lights.ts      # 舞台灯光
│   │
│   │── settings.ts           # 设置页总入口
│   │── settings-appearance.ts     # 外观主题
│   │── settings-audio.ts          # 音频设置
│   │── settings-external.ts       # 外部库
│   │── settings-filename.ts       # 文件命名
│   │── settings-language.ts       # 语言
│   │── settings-paths.ts          # 路径管理
│   │── settings-performance.ts    # 性能设置
│   │── settings-screenshot.ts     # 截图设置
│   │── settings-shared.ts         # 共享配置
│   │── settings-shortcuts.ts      # 快捷键
│   │── settings-software.ts       # 软件管理
│   │── settings-targets.ts        # 输出目标
│   │
│   │── outfit-ui.ts              # 换装 UI
│   │── plaza.ts                  # 模型广场
│   │── plaza-sites.ts            # 广场站点列表
│   │── preset-list-viewer.ts     # 预设列表查看器
│   │── resource-detail-helpers.ts # 资源详情辅助
│   │── render-menu.ts            # 渲染菜单（遗留，待 ADR-093 迁移）
│   │
│   └── __tests__/              # 单元测试
│       ├── menu-schema.test.ts
│       ├── menu.test.ts
│       ├── env-bridge.test.ts
│       ├── env-state.test.ts
│       ├── perception.test.ts
│       ├── library-core.test.ts
│       ├── settings-store.test.ts
│       ├── outfit.test.ts
│       ├── model-detail-ui.test.ts
│       ├── model-preset.test.ts
│       ├── model-manager.test.ts
│       ├── model-ops.test.ts
│       ├── audio.test.ts
│       ├── beat-detector.test.ts
│       ├── skirt-analyzer.test.ts
│       ├── virtual-skirt.test.ts
│       ├── feet-adjustment.test.ts
│       ├── lipsync-bridge.test.ts
│       ├── lipsync.test.ts
│       ├── vmd-evaluator.test.ts
│       ├── vmd.test.ts
│       ├── wasm-layers-blender.test.ts
│       ├── playback.test.ts
│       ├── camera.test.ts
│       ├── ui-helpers.test.ts
│       ├── config.test.ts
│       ├── dialog.test.ts
│       ├── fileservice.test.ts
│       ├── physics-bridge.test.ts
│       ├── material-editor.test.ts
│       ├── environment-integration.test.ts
│       ├── scene-model.test.ts
│       ├── vpd-parser-security.test.ts
│       ├── environment-integration.test.ts
│       └── scene/                # 场景子目录测试
│
├── motion-algos/             # ★ 动作生成算法层（无 Babylon 依赖）
│   ├── procedural-motion.ts  # barrel re-export → shared / idle / autodance / lifelike
│   ├── proc-motion-shared.ts  # 类型定义 + 骨骼候选名 + 常量
│   ├── proc-motion-idle.ts    # Idle VMD（呼吸+眨眼）
│   ├── proc-motion-autodance.ts       # AutoDance 主流程
│   ├── proc-motion-autodance-bones.ts       # 骨骼动作生成（骨架）
│   ├── proc-motion-autodance-bones-limbs.ts # 四肢骨骼
│   ├── proc-motion-autodance-bones-trunk.ts # 躯干骨骼
│   ├── proc-motion-autodance-emotion.ts     # 情绪动作
│   ├── proc-motion-lifelike.ts  # Lifelike（微动叠加层）
│   ├── vmd-writer.ts            # VMD 二进制写入（Shift-JIS）
│   ├── vmd-evaluator.ts         # VMD 多图层混合求值器
│   ├── vpd-parser.ts            # VPD 姿势解析→VMD
│   ├── beat-detector.ts         # 节拍检测（Web Audio API）
│   ├── lipsync.ts               # 振幅→morph 权重
│   ├── feet-adjustment-math.ts  # 脚部调整数学（ADR-085）
│   ├── footstep-detect.ts       # 脚步声检测（ADR-088）
│   └── pose-preset.ts           # 姿势预设
│
├── outfit/                   # 换装系统
│   ├── outfit.ts           # 加载/应用/重置 + 自动发现
│   ├── outfit-overlay.ts   # 换装覆盖层
│   └── audio.ts            # 音频播放 + VMD 同步 + 节拍检测
│
├── physics/                  # 物理辅助（XPBD 已移除，布料由 WASM Bullet 驱动）
│   ├── physics-bridge.ts   # 物理桥接
│   └── wind-physics.ts     # 风场辅助函数
│
├── __tests__/                # 测试夹具
│   ├── mocks/
│   └── setup-wails.ts
│
└── app.css                   # 全局样式（CSS 变量体系）
```

---

## 四、近期 ADR 快速索引（2026-06 至今）

> 与 `frontend/` 直接相关的架构决策，方便定位代码来源。

| ADR | 标题 | 状态 | 主要影响模块 |
|-----|------|------|-------------|
| ADR-093 | 菜单声明式 Schema（单一数据源 + 单渲染器） | 实施中（P0-P2 完成） | menus/ 全域（menu-schema.ts / menu-factory.ts） |
| ADR-092 | 贴图与反射统一（纹理工厂 + 平面反射引擎） | 已完成 | scene/env/（env-texture.ts / planar-reflection.ts） |
| ADR-091 | 地面纹理统一（4→1 canvas 路径） | 已完成 | scene/env/（env-texture.ts） |
| ADR-090 | 对话框默认目录记忆 | 已完成 | core/ui-resource-panel.ts |
| ADR-089 | 地面模式分类重构（类型 + 样式拆分） | 已完成 | scene/env/（env-terrain.ts） |
| ADR-088 | 音效系统（脚步声 + SFX 总线） | 部分实现 | core/audio-bus.ts / scene/motion/footstep.ts |
| ADR-087 | 模型广场浏览器体验 | 规划中 | menus/plaza*.ts |
| ADR-086 | 猫步程序化动作 | 已完成 | scene/motion/ / motion-algos/ |
| ADR-085 | 脚部地面跟随 | 已完成 | scene/motion/feet-adjustment.ts |
| ADR-084 | 虚拟裙骨生成（WASM Bullet 刚体注入） | 实施中 | scene/physics/（skirt-analyzer.ts / virtual-skirt.ts） |
| ADR-079 | 感知层扩展（breathing/gaze/balance/expression） | 已完成 | scene/motion/perception-*.ts |
| ADR-055 | AR 相机模式 | 已完成 | scene/ar/ |

> 完整 ADR 列表见 `docs/adr/`。新建 ADR 前取最大编号 +1，仅 ADR / novel 可编号。

---

## 五、关键架构变更提示

### 5.1 声明式菜单 Schema（ADR-093）— 最高优先级

- **核心文件**：`menus/menu-schema.ts`（ControlSpec / MenuNode / StatePath 类型定义）+ `menus/menu-factory.ts`（渲染器）
- **StatePath 前缀**：`env.*` / `render.*` / `light.*` / `ui.*` / `perception.*`
- **禁止手写**：新增菜单面板应定义 Schema 而非直接调用 builder API
- **测试**：`__tests__/menu-schema.test.ts`

### 5.2 感知层（ADR-079）— 动作系统新入口

- 入口：`scene/motion/perception.ts`，按功能拆分为 6 个子模块
- 注意 `perception-gaze.ts` 是 JS/WASM 双实现的总调度，不要直接调下层

### 5.3 虚拟裙骨（ADR-084）— 物理系统

- `scene/physics/skirt-analyzer.ts` 做几何分析，`virtual-skirt.ts` 做刚体注入
- 质量档位 UI 在 `menus/motion-cloth-levels.ts`

### 5.4 i18n 国际化

- 5 语言：zh-CN / zh-TW / ja / en / ko
- 所有菜单 label 用 i18n key，禁止硬编码文字
- 搜索 `innerText` / `textContent` / `innerHTML` 直接赋值，确认是否使用 `t()` 包裹
