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
git stash                                              # 暂存自己
npm run check                                          # 记录基线错误数
git stash pop                                          # 解暂存
npm run check                                          # 确认未新增错误
```

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
| `include` | `src`, `bindings` | Wails 生成的 binding 也参与类型检查 |

### 2.2 写新代码的约定

> ⚠️ **如实记录现状，不承诺 strict 化政策**。靠 code review 人工把关。

- **不要新增 `any` 逃生** — 即使 `strict: false` 允许，新代码仍要避免 `as any` / `@ts-ignore` / `@ts-expect-error`。需要时加注释说明业务理由。
- **类型定义就近放置** — 项目**没有**集中的 `src/types/` 目录。interface/type 与使用它的文件同模块放置；跨模块共享类型放 `core/types.ts`（config.ts 已拆分为 types / state / dom / utils 四个子模块，通过 barrel re-export 保持 import 兼容）。
- **没有路径别名** — `tsconfig.json` 无 `paths` 配置。一律用相对路径 import（如 `import { dom } from '../core/config'`）。
- **binding 自动生成** — 绑定文件在 `frontend/bindings/`，由 Wails v3 自动生成。**严禁手动编辑**。改 Go 端 struct/方法后，在 `frontend/` 目录跑 `npm run generate:bindings` 重新生成。生成参数为 `-ts -i`（TypeScript + interface 模式），输出目录 `frontend/bindings`。TS 侧统一通过 `src/core/wails-bindings.ts` re-export 引入，不要直接 import bindings 目录。

---

## 三、前端目录索引

```
frontend/src/
├── core/                # 基础设施
│   ├── main.ts          # ★ 应用入口（事件绑定 + 快捷键 + 初始化）
│   ├── config.ts        # barrel re-export → types.ts / state.ts / dom.ts / utils.ts
│   ├── fileservice.ts   # resolveFileUrl 统一文件 URL 解析
│   ├── icons.ts         # Iconify 图标创建
│   ├── iconify-registry.ts  # 本地图标注册表
│   ├── ui-helpers.ts    # DOM 构建工具（slideRow / addToggleRow 等）
│   ├── dialog.ts        # 通用对话框
│   ├── reactivity.ts    # 简易响应式（signal / effect）
│   ├── wails-bindings.ts # Wails Go binding 类型封装
│   └── physics/         # 状态→桥接辅助（仅 wind-utils；新物理逻辑放 src/physics/）
├── scene/               # 3D 场景（Babylon.js）
│   ├── scene.ts             # ★ 场景编排入口
│   ├── scene-serialize.ts   # 场景序列化
│   ├── camera/              # 相机模式
│   ├── motion/              # [桥接层] 动作桥接（vmd-loader / proc-motion-bridge / lipsync-bridge / playback）→ 调 src/motion-algos/ 算法
│   ├── manager/             # 模型管理（model-manager / material / loader / ops）
│   ├── env/                 # 环境系统（env.ts + env-impl.ts + env-bridge.ts + env-water / cloud / particle / lighting-preset / props）
│   └── render/              # 渲染管线（renderer / lighting 灯光管理 / performance）
├── menus/               # SlideMenu 弹窗系统
│   ├── menu.ts          # 通用菜单导航组件
│   ├── library*.ts      # 模型库（扫描/搜索/层级/标签）
│   ├── model-*.ts       # 模型详情/材质/预设
│   ├── env-*.ts         # 环境菜单（天空/水面/风/云/预设）
│   ├── scene-*.ts       # 场景菜单（渲染/舞台/道具）
│   ├── motion-*.ts      # [UI层] 动作菜单（动作绑定/相机/程序化/LipSync/布料）
│   └── settings*.ts     # 设置页（UI 主题 / 外部库 / 软件管理）
├── motion-algos/              # [算法层] 动作生成算法，无 Babylon 依赖（供 scene/motion/ 调用）
│   ├── procedural-motion.ts    # Idle / AutoDance VMD 生成
│   ├── vmd-writer.ts           # VMD 二进制写入（Shift-JIS 骨骼名）
│   ├── vpd-parser.ts           # VPD 姿势解析→VMD
│   ├── beat-detector.ts        # 节拍检测（Web Audio API）
│   └── lipsync.ts              # 振幅→morph 权重
├── outfit/              # 换装系统
│   ├── outfit.ts        # 加载/应用/重置 + 自动发现
│   └── audio.ts         # 音频播放 + VMD 同步 + 节拍检测挂载
├── physics/             # XPBD 物理引擎（独立目录）
│   ├── xpbd-solver.ts    # Verlet + 约束 + 地面碰撞
│   ├── xpbd-cloth.ts     # 布料生成 + 每帧更新
│   ├── xpbd-collider.ts  # SDF 胶囊碰撞体
│   ├── xpbd-renderer.ts  # 调试可视化
│   └── cloth-manager.ts  # 创建/销毁/重建（UI 入口）
└── app.css              # 全局样式（CSS 变量体系）
```

### 目录重组记录（2026-07）

`scene/` 已按业务域拆分为 `camera/` / `motion/` / `manager/` / `env/` / `render/` 子目录。`physics/` 为独立目录（XPBD 引擎），`motion-algos/` 为动作算法独立目录。相机 UI 已迁移到 `motion-popup`。

---

## 四、维护风险清单

> 2026-07-08 排查，按优先级排列。

### 4.1 已修复

| 问题 | 状态 |
|------|------|
| `store/` 模块 6 个 tsc 编译错误 | ✅ 已修复（import 路径、RootState 字段、类型导出） |
| `proc-motion-bridge.ts` 9 个 `as any` | ✅ 已修复（引入 `MmdRuntimeBoneExtended` / `MeshMetadata` 接口） |
| `env-water.ts` 4 个 `as any` | ✅ 已修复（引入 `PostProcessInternal` 接口） |
| `wasm-layers-blender.ts` 1 个 `as any` | ✅ 已修复（复用 `MmdRuntimeBoneExtended`） |
| `env-bridge.ts` 1 个 `as any` | ✅ 已修复（移除冗余断言） |

### 4.2 高风险文件（需关注）

#### `menus/settings.ts` — 2085 行 🔴

| 维度 | 发现 |
|------|------|
| 可拆分区 | 外部库管理(L995-1042)、性能设置(L1110-1135)、导入/导出/重置(L1604-1713)、快捷键(L2018-2050)、语言(L2158-2174)、路由(L2143-2189) |
| 耦合热点 | 从 config.ts 导入 18 个符号；`SETTINGS_ACTIONS` 声明式映射（L905-969）是好的，但函数体仍耦合多模块 |
| 状态泄漏 | `autoImportCached`(L103)、`autoLoadCompanionAudio`(L115) 模块级可变变量 |
| `as any` | 0 处 |
| 死代码 | `formatBytes`(L2131) 仅内部用，无冗余 |
| 测试 | 无 |

#### `motion-algos/procedural-motion.ts` — 1424 行 🔴

| 维度 | 发现 |
|------|------|
| 可拆分区 | Idle(L194-535)、AutoDance(L540-1112)、Lifelike(L1119-1473)、状态判断(L1478-1496) |
| 耦合热点 | 严重依赖 babylon-mmd 的 BoneKeyFrame/MorphKeyFrame；所有生成函数调 vmd-writer.buildVmd |
| 状态泄漏 | `BONE_CENTER_CANDIDATES` 等模块级常量数组（只读安全）；`DEFAULT_PROC_STATE` 共享默认值 |
| `as any` | 0 处 |
| 数值硬编码 | `FPS=30`、`MAX_FRAMES=600`；骨骼旋转幅度 `0.03*intensity` 等散落各函数体 |
| 测试 | 有 `procedural-motion.test.ts`，但 `shouldIdle`/`shouldAutoDance` 分支未覆盖 |

#### `scene/render/lighting.ts` — 1135 行 🟡

| 维度 | 发现 |
|------|------|
| 可拆分区 | 灯光创建(L1-200)、阴影(L100-200)、状态读写(L200-400)、舞台灯(L400-600)、Gizmo(L600-800)、Tween(L800-1000)、预设(L1000-1150) |
| 耦合热点 | 依赖 scene.ts 场景对象、env-bridge.ts 环境变量、state.ts 注册表 |
| 状态泄漏 | `_stageLights`、`_envSysShadow`、`_sunDisc` 模块级 Babylon 对象引用 |
| 资源泄漏 | `removeStageLight` + `_disposeStageShadow` 有 dispose ✅ |
| `as any` | `setLightState` 中 `_envSysShadow?.generator` 访问（1 处） |
| 测试 | 有 `__tests__/env-lighting.test.ts` ✅ |

#### `menus/env-feature-levels.ts` — 1059 行 🟡

| 维度 | 发现 |
|------|------|
| 可拆分区 | 天空(L26-189)、地面(L192-435)、水面(L438-667)、风(L670-707)、云(L710-780)、实验(L783-830)、雾(L832-940)、阴影(L943-1078) |
| 重复模式 | 大量相似 `addSliderRow`/`addColorSliderRow`/`addToggleRow`/`addCollapsible` 调用，结构一致但参数不同 |
| `as any` | 0 处 |
| 测试 | 无 |

#### `scene/env/env-water.ts` — 1035 行 🟡

| 维度 | 发现 |
|------|------|
| 可拆分区 | 水面创建(L571-763)、涟漪(L170-175)、Uniform 同步(L426-513)、销毁(L765-799)、水下过渡(L821-921)、Tint 后处理(L110-133) |
| `as any` | 4 处 — 均为 `(_tintPostProcess as any)._enabled` / `as unknown as PostProcessInternal`（访问 Babylon 私有属性） |
| 资源泄漏 | `disposeWater` 释放 mesh/LOD/材质/纹理/后处理 ✅；需调用 `clearRipples()` ⚠️ |
| 测试 | 无 |

#### `core/main.ts` — 1026 行 🟡

| 维度 | 发现 |
|------|------|
| 可拆分区 | 快捷键注册(L239-378)、弹窗切换(L139-199)、Freefly 控制(L380-435)、拖拽(L761-828)、Seek(L437-464)、初始化(L590-652)、状态恢复(L654-733)、调试暴露(L919-1017) |
| 耦合热点 | 从 config.ts 导入 18 个符号；`navActions` 依赖懒加载 import |
| 状态泄漏 | `_lastOverlayFn`(Map)、`_longPressTimer`、`_lastHiddenOverlay`、`_lastTapTime` — 模块级可变状态无生命周期管理 |
| `as any` | 1 处 — `(window as any).__scene`（E2E/调试用） |
| 事件泄漏 | `window.keydown/keyup`、`pointermove/pointerup` 无 removeEventListener |
| 测试 | 无 |

### 4.3 `as any` 重灾区（生产代码）

| 文件 | 数量 | 问题 |
|------|------|------|
| ~~`scene/motion/proc-motion-bridge.ts`~~ | ~~10~~ | ✅ 已修复 |
| ~~`scene/env/env-water.ts`~~ | ~~4~~ | ✅ 已修复 |
| ~~`scene/motion/wasm-layers-blender.ts`~~ | ~~1~~ | ✅ 已修复 |
| ~~`scene/env/env-bridge.ts`~~ | ~~1~~ | ✅ 已修复 |
| ~~`core/state.ts`~~ | ~~2~~ | ✅ 已修复 |
| `core/main.ts` | 1 | `(window as any).__scene` 调试用，可接受 |

### 4.4 结构性风险

- ~~**状态双源**~~：`store/index.ts` 已删除（2026-07-08），`core/state.ts` 为唯一状态源
- **深链 import**：无路径别名，深嵌套文件的相对路径 import 容易写错
- **Barrel re-export**：`core/config.ts` re-export 多个子模块，任一改导出名会级联报错

