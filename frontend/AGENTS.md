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
│   ├── procedural-motion.ts    # barrel re-export → shared / idle / autodance / lifelike
│   ├── proc-motion-shared.ts   # 类型定义 + 骨骼候选名 + 常量
│   ├── proc-motion-idle.ts     # Idle VMD 生成（呼吸+眨眼）
│   ├── proc-motion-autodance.ts # AutoDance VMD 生成（节拍驱动律动）
│   ├── proc-motion-lifelike.ts # Lifelike VMD 生成（微动叠加层）
│   ├── vmd-writer.ts           # VMD 二进制写入（Shift-JIS 骨骼名）
│   ├── vmd-evaluator.ts        # VMD 多图层混合求值器
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

#### `menus/settings.ts` — 107 行 🟢 已拆分

| 维度 | 发现 |
|------|------|
| 状态 | 已拆分为 barrel re-export 文件（107 行），子模块：`settings-shared.ts`(200) + `settings-appearance.ts`(260) + `settings-filename.ts`(210) + `settings-paths.ts`(180) + `settings-external.ts`(90) + `settings-performance.ts`(310) + `settings-screenshot.ts`(70) + `settings-audio.ts`(80) + `settings-about.ts`(270) + `settings-shortcuts.ts`(160) + `settings-language.ts`(20) |
| `as any` | 0 处 |
| 测试 | 无（纯 UI 构建，无业务逻辑） |
| 结论 | 拆分完成，各子模块职责清晰，外部消费者通过 barrel 保持路径不变 |

#### `motion-algos/procedural-motion.ts` — 60 行 🟢 已拆分

| 维度 | 发现 |
|------|------|
| 状态 | 已拆分为 barrel re-export 文件（26 行），子模块：`proc-motion-shared.ts`(146) + `proc-motion-idle.ts`(346) + `proc-motion-autodance.ts`(547) + `proc-motion-lifelike.ts`(353) |
| `as any` | 0 处 |
| 测试 | 有 `procedural-motion.test.ts`，但 `shouldIdle`/`shouldAutoDance` 分支未覆盖 |
| 结论 | 拆分完成，各子模块职责清晰 |

#### `scene/render/lighting.ts` — 1244 行 🟢 已审查

| 维度 | 发现 |
|------|------|
| 可拆分区 | 灯光创建(L1-200)、阴影(L100-200)、状态读写(L200-400)、舞台灯(L400-600)、Gizmo(L600-800)、Tween(L800-1000)、预设(L1000-1150) |
| 耦合热点 | 依赖 scene.ts 场景对象、env-bridge.ts 环境变量、state.ts 注册表 |
| 状态泄漏 | `_stageLights`、`_envSysShadow`、`_sunDisc` 模块级 Babylon 对象引用（singleton 设计，拆分收益低） |
| 资源泄漏 | `removeStageLight` + `_disposeStageShadow` + `detachLightGizmo` 有 dispose ✅ |
| `as any` | 0 处（`_envSysShadow.generator` 已内联类型 `{ generator: ShadowGenerator \| null }`） |
| 测试 | 有 `__tests__/env-lighting.test.ts` ✅ |
| 结论 | 无需改动。结构清晰，类型安全，资源释放完整 |

#### `menus/env-feature-levels.ts` — 1079 行 🟢 已审查

| 维度 | 发现 |
|------|------|
| 结构 | 8 个独立导出函数（`buildSkyLevel` / `buildGroundLevel` / `buildWaterLevel` / `buildWindLevel` / `buildCloudLevel` / `buildExperimentalLevel` / `buildFogLevel` / `buildShadowLevel`），每个构建一个 `PopupLevel` |
| 重复模式 | `addSliderRow` / `addColorSliderRow` / `addToggleRow` / `addCollapsible` 共 72 次调用——这是 UI 框架的设计模式，不是代码异味 |
| `as any` | 0 处 |
| 测试 | 无（纯 UI 构建，无业务逻辑） |
| 结论 | 无需改动。每个函数自包含，职责清晰，1079 行是 8 个独立 UI builder 的自然体量 |

#### `scene/env/env-water.ts` — 1128 行 🟢 已审查

| 维度 | 发现 |
|------|------|
| 结构 | 自包含水面渲染系统：shader uniform 同步(`_syncWaterUniforms`)、LOD 三层、涟漪系统、水下过渡、预设应用 |
| 可拆分区 | 波方向(L43-80)、涟漪(L86-180)、shader 代码(L88-107)、水下效果(L110-133)、创建/销毁(L200-400)、uniform 同步(L430-513)、LOD(L537-580)、预设(L800-1128) |
| 重复模式 | `applyWaterPresetToCurrent` 有 16 个 `if (preset.xxx !== undefined)` 检查——每个映射不同 shader 方法(setFloat/setVector3/setColor3)，提取 helper 会丢失类型安全 |
| `as any` | 0 处（`PostProcessInternal` 接口已引入） |
| 资源泄漏 | `disposeWater()` + `disposeTintPostProcess()` 完整 ✅ |
| 测试 | 有 `scene/env-water.test.ts`（20 个测试）✅ — dispose/ripple/underwater/preset 已覆盖 |
| 结论 | 无需改动。水面渲染系统的固有复杂度，结构清晰，资源管理完整 |

### 4.3 `as any` 重灾区（生产代码）

| 文件 | 数量 | 问题 |
|------|------|------|
| ~~`scene/motion/proc-motion-bridge.ts`~~ | ~~10~~ | ✅ 已修复 |
| ~~`scene/env/env-water.ts`~~ | ~~4~~ | ✅ 已修复 |
| ~~`scene/motion/wasm-layers-blender.ts`~~ | ~~1~~ | ✅ 已修复 |
| ~~`scene/env/env-bridge.ts`~~ | ~~1~~ | ✅ 已修复 |
| ~~`scene/render/lighting.ts`~~ | ~~1~~ | ✅ 审查确认：当前 0 处 as any，无需改动 |
| ~~`core/state.ts`~~ | ~~2~~ | ✅ 已修复 |
| `outfit/audio.ts` | 2 | 函数 monkey-patch（`ensureAudio`/`disposeAudio`），运行时替换无法避免 |
| `core/main.ts` | 1 | `(window as any).__scene` 调试用，可接受（另有 1 处 `@ts-ignore` 为 Wails v2→v3 过渡兼容） |

#### `menus/library-core.ts` — 954 行 🟢 已审查

| 维度 | 发现 |
|------|------|
| 导出 | 4 个函数（`buildLevel` / `modelToRow` / `buildModelRootItems` / `showModelPopup`） |
| `as any` | 0 处 |
| 测试 | 有 `library-core.test.ts`，44 个测试用例 ✅ |
| 结论 | 无需改动。职责清晰，测试充分 |

#### `scene/manager/model-manager.ts` — 989 行 🟢 已审查

| 维度 | 发现 |
|------|------|
| 导出 | 1 个类 `ModelManager` + 2 个辅助导出 |
| `as any` | 0 处 |
| 方法数 | 50+ 个（God Object 风险，但职责清晰：模型 CRUD + 属性 + 骨骼 + 物理 + Morph） |
| 设计 | 注释明确记录：注入式 `triggerAutoSave`、无循环依赖、状态封装 |
| 测试 | 有 `model-manager.test.ts`，116 个测试用例 ✅ |
| 结论 | 方法多但测试充分，拆分风险高于收益 |

#### `core/main.ts` — 1084 行 🟢 已审查

| 维度 | 发现 |
|------|------|
| 导出 | 无（应用入口，事件绑定 + 快捷键 + 初始化） |
| `as any` | 1 处（E2E 调试 hook，可接受） |
| `@ts-ignore` | 1 处（Wails v2→v3 过渡兼容，带注释说明） |
| 测试 | 无（入口文件，不适合单元测试） |
| 结论 | 无需改动。类型安全问题均为合理保留 |

### 4.4 结构性风险

- ~~**状态双源**~~：`store/index.ts` 已删除（2026-07-08），`core/state.ts` 为唯一状态源
- ~~**深链 import**~~：✅ 已添加 `@/` 和 `@bindings/` 别名（`tsconfig.json` + `vite.config.ts` + `vitest.config.ts`），60 处 `../../` 导入已替换
- **Barrel re-export**：`core/config.ts` re-export 多个子模块，任一改导出名会级联报错
- **测试覆盖**：92 个模块无直接测试（含 UI builder、i18n、工具函数），核心逻辑模块（xpbd、vmd、config）有间接覆盖
- **资源释放**：15 个文件调用 `.dispose()`，已审查的文件（lighting、env-water）释放完整
- ~~**事件监听器泄漏**~~：✅ 已修复（2026-07-08）。分析 31 个 `addEventListener` 文件：顶层监听器（10 个，应用生命周期）、元素附着监听器（20 个，DOM GC 自动清理）、临时自清理监听器（1 个）、动态累积监听器（1 个 `settings-about.ts`，已添加防重复注册标志）

### 4.7 运行时隐患修复（2026-07-08）

| 模块 | 问题 | 修复 |
|------|------|------|
| `outfit.ts` | `loadOutfits` / `applyOutfitVariant` 未检查 `modelRegistry.get()` | 添加 undefined 守卫 |
| `outfit.ts` | `applyOutfitVariant` 无并发锁 | 添加 `_applyingVariant` Map |
| `outfit.ts` | `resetOutfit` 丢弃异步 promise | 改为 async + await Promise.all |
| `outfit.ts` | `loadOutfits` 无请求去重 | 添加 `_loadingOutfits` Set |
| `camera.ts` | `setCameraState` 先切模式再设 preset | 将 preset 赋值移到 switchCameraMode 之前 |
| `camera.ts` | 旧相机未 dispose | 添加 `oldCam.dispose()` |
| `camera.ts` | Orbit→Freefly 丢失观察方向 | 添加 UniversalCamera.setTarget 分支 |
| `camera.ts` | AR 失败还原逻辑脆弱 | 改为只在 `_cameraMode === 'ar'` 时还原 |
| `env-bridge.ts` | time-of-day 与预设冲突 | 预设动画期间暂停 time-of-day |
| `env-bridge.ts` | 预设快速切换竞态 | 用 `_timeOfDayBeforePreset` 记录原始状态 |
| `vmd-loader.ts` | `loadVMDMotion` 无 generation counter | 添加 `_vmdLoadGeneration` |
| `vmd-layers.ts` | 异常时 vmdLoader.dispose() 不执行 | 移入 finally 块 |
| `vmd-layers.ts` | 闭包快照与实际不一致 | 开头捕获 layersSnapshot |
| `proc-motion-bridge.ts` | regeneratePending 重试时焦点已变更 | 重触发前检查 focusedModelId |
| `model-detail.ts` | 菜单关闭后 IPC 写操作仍执行 | 用 `container.isConnected` 守卫 |
| `model-detail.ts` | 三层嵌套 Promise 静默吞错 | `.catch` 改为 console.warn |
| `scene-stage-lights.ts` | 灯光删除后缺少存在性校验 | showConfirm 返回后重新检查 id |

### 4.5 测试覆盖更新（2026-07-08）

| 文件 | 测试数 | 新增覆盖 |
|------|--------|---------|
| `scene/env/env-water.test.ts` | 7→20 | dispose 资源释放、ripple 生命周期、underwater 过渡、preset 应用 |
| `scene/scene-serialize.test.ts` | 0 | 尝试补测试 → import 链触发 babylon-mmd 装饰器初始化，mock 成本过高，放弃（建议 E2E 覆盖） |

### 4.6 已拆分文件

| 文件 | 原行数 | 拆分结果 |
|------|--------|----------|
| `procedural-motion.ts` | 1496 | → `procedural-motion.ts`(60) + `proc-motion-shared.ts`(190) + `proc-motion-idle.ts`(340) + `proc-motion-autodance.ts`(570) + `proc-motion-lifelike.ts`(350) |
| `settings.ts` | 2189 | → `settings.ts`(107) + `settings-shared.ts`(200) + `settings-appearance.ts`(260) + `settings-filename.ts`(210) + `settings-paths.ts`(180) + `settings-external.ts`(90) + `settings-performance.ts`(310) + `settings-screenshot.ts`(70) + `settings-audio.ts`(80) + `settings-about.ts`(270) + `settings-shortcuts.ts`(160) + `settings-language.ts`(20) |

