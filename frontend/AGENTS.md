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
├── physics/             # 物理辅助（XPBD 已移除，布料由 WASM Bullet 驱动）
│   ├── physics-bridge.ts # 物理桥接
│   └── wind-physics.ts   # 风场辅助函数
└── app.css              # 全局样式（CSS 变量体系）
```

### 目录重组记录（2026-07）

`scene/` 已按业务域拆分为 `camera/` / `motion/` / `manager/` / `env/` / `render/` 子目录。`physics/` 为独立目录（物理辅助），`motion-algos/` 为动作算法独立目录。相机 UI 已迁移到 `motion-popup`。

---

## 四、功能审核计划

> 按功能模块依次遍历，每模块需同时验证 4 个维度：类型安全、资源管理、测试覆盖、功能正确性。

### 审核维度标准

| 维度 | 检查项 | 通过标准 |
|------|--------|---------|
| **类型安全** | `as any` / `@ts-ignore` | 生产代码中 0 处新增；遗留需有业务理由注释 |
| **资源管理** | `.dispose()` 配对 | 每个 `new Xxx()` Babylon / WebAudio 对象有对应释放 |
| **测试覆盖** | 直接测试 / 间接覆盖 | 核心逻辑有单元测试；UI builder 允许无测试 |
| **功能正确性** | 运行时隐患 | 并发守护 / undefined 守卫 / Promise 不丢弃 / 竞态处理 |

### 模块风险等级

| 等级 | 含义 | 模块 |
|------|------|------|
| 🔴 极高 | 外部契约 + 状态突变 + 难以测试 | `bindings/` · `core/wails-bindings.ts` |
| 🟠 高 | 图形资源 / WASM / 并发写入 | `physics/` · `scene/render/` · `scene/env/` · `outfit/` |
| 🟡 中高 | 场景状态聚合 / 桥接层 | `scene/scene.ts` · `scene/motion/` · `scene/camera/` |
| 🟢 中 | 纯 UI builder / 算法 | `menus/` · `motion-algos/` · `core/`（不含 bindings） |

---

### 🔴 模块 1：Binding 契约层

**优先级：最高，必须先过**

| 文件 | 验收维度 | 检查项 |
|------|---------|--------|
| `bindings/`（自动生成，禁止手改） | 类型安全 | `app.contract.test.ts` 跑通，116 个函数 + FNV-1a ID 全部对上 |
| `core/wails-bindings.ts` | 类型安全 | 手维护区无 `as any`；model 类型登记与 Go 侧一致 |
| `app.contract.test.ts` | 功能正确性 | 每次 Go 侧增删方法后重跑；新增函数必须有测试覆盖 |

**审核方法：** `npm run test -- src/__tests__/bindings/app.contract.test.ts`

---

### 🔴 模块 2：换装 + 音频系统

**优先级：最高**

| 文件 | 验收维度 | 检查项 |
|------|---------|--------|
| `outfit/outfit.ts` | 功能正确性 | `loadOutfits` 有 `_loadingOutfits` 去重；`applyOutfitVariant` 有 `_applyingVariant` 并发锁；`modelRegistry.get()` 有 undefined 守卫；`resetOutfit` 是 async + `Promise.all` |
| `outfit/outfit.ts` | 资源管理 | `disposeOutfit` 正确释放 outfit 资源 |
| `outfit/audio.ts` | 类型安全 | 2 处 `as any` 是 monkey-patch 运行时替换，业务上不可避免（有注释） |
| `outfit/audio.ts` | 资源管理 | `disposeAudio` 释放 WebAudio 节点 |
| `__tests__/outfit.test.ts` | 测试覆盖 | 覆盖 load/apply/reset 并发场景 |

---

### ~~🟠 模块 3：物理引擎（XPBD）~~（已移除）

> **状态**：已移除（commit 530af6e）。XPBD(TS) 布料系统与 PMX 内建 WASM Bullet 物理存在功能重叠，维护成本高于收益。布料/头发摆动由 WASM Bullet 刚体驱动，不再需要独立 XPBD 求解器。

---

### 🟠 模块 4：渲染管线

**优先级：高**

| 文件 | 验收维度 | 检查项 |
|------|---------|--------|
| `scene/render/renderer.ts` | 资源管理 | 每帧 `new Effect()` / shader 编译有缓存或 dispose |
| `scene/render/renderer.ts` | 类型安全 | 0 处 `as any` |
| `scene/render/lighting.ts` | 资源管理 | `removeStageLight` + `_disposeStageShadow` + `detachLightGizmo` 有 dispose ✅ |
| `scene/render/lighting.ts` | 类型安全 | 0 处 `as any` ✅ 已审查；`__tests__/env-lighting.test.ts` 存在 |
| `scene/render/performance.ts` | 功能正确性 | 性能降级阈值合理；降级后不破坏核心功能 |
| `__tests__/env-lighting.test.ts` | 测试覆盖 | 存在 ✅ |

---

### 🟠 模块 5：环境系统

**优先级：高**

| 文件 | 验收维度 | 检查项 |
|------|---------|--------|
| `scene/env/env.ts` + `env-impl.ts` | 资源管理 | 环境切换时旧 PostProcess / 粒子有 dispose |
| `scene/env/env-water.ts` | 资源管理 | `disposeWater()` + `disposeTintPostProcess()` 完整 ✅ 已审查 |
| `scene/env/env-water.ts` | 类型安全 | 0 处 `as any` ✅ 已审查；`__tests__/scene/env-water.test.ts` 20 个测试 |
| `scene/env/env-bridge.ts` | 功能正确性 | time-of-day 与预设冲突已修复；快速切换竞态已用 `_timeOfDayBeforePreset` 守卫 |
| `scene/env/env-bridge.ts` | 类型安全 | 0 处 `as any` ✅ 已修复 |
| `scene/env/`（cloud/particle/lighting-preset/props） | 资源管理 | 各自 dispose 路径完整 |
| `__tests__/env-bridge.test.ts` | 测试覆盖 | 存在 |
| `__tests__/scene/env-water.test.ts` | 测试覆盖 | 存在，20 个测试 ✅ |
| `__tests__/scene/env-terrain.test.ts` | 测试覆盖 | 存在 |

---

### 🟡 模块 6：场景编排

**优先级：中高**

| 文件 | 验收维度 | 检查项 |
|------|---------|--------|
| `scene/scene.ts` | 功能正确性 | 场景初始化/销毁链路完整；无状态残留 |
| `scene/scene-serialize.ts` | 功能正确性 | 序列化/反序列化 round-trip 正确（E2E 覆盖） |
| `scene/scene-serialize.ts` | 测试覆盖 | `scene-serialize.test.ts` 无直接测试（mock 成本高，建议 E2E 覆盖） |
| `scene/pose/` | 功能正确性 | 水印/构图指导/相机角度无副作用 |

---

### 🟡 模块 7：动作桥接层

**优先级：中高**

| 文件 | 验收维度 | 检查项 |
|------|---------|--------|
| `scene/motion/vmd-loader.ts` | 功能正确性 | `loadVMDMotion` 有 `_vmdLoadGeneration` 防竞态 ✅ 已修复 |
| `scene/motion/vmd-layers.ts` | 资源管理 | 异常时 `vmdLoader.dispose()` 在 `finally` 块内 ✅ 已修复 |
| `scene/motion/vmd-layers.ts` | 功能正确性 | 闭包快照在开头捕获 ✅ 已修复 |
| `scene/motion/proc-motion-bridge.ts` | 功能正确性 | `regeneratePending` 重试前检查 `focusedModelId` ✅ 已修复 |
| `scene/motion/proc-motion-bridge.ts` | 类型安全 | 0 处 `as any` ✅ 已修复；`__tests__/proc-motion-bridge.test.ts` 存在 |
| `scene/motion/wasm-layers-blender.ts` | 类型安全 | 0 处 `as any` ✅ 已修复 |
| `scene/motion/lipsync-bridge.ts` | 功能正确性 | 振幅 → morph 权重映射正确；`__tests__/lipsync-bridge.test.ts` 存在 |
| `__tests__/vmd-evaluator.test.ts` | 测试覆盖 | 存在 |
| `__tests__/vmd-evaluator.regression.spec.ts` | 测试覆盖 | 存在 |

---

### 🟡 模块 8：相机系统

**优先级：中高**

| 文件 | 验收维度 | 检查项 |
|------|---------|--------|
| `scene/camera/camera.ts` | 资源管理 | 旧相机 `dispose()` ✅ 已修复 |
| `scene/camera/camera.ts` | 功能正确性 | `setCameraState` 先设 preset 再切模式 ✅ 已修复；Orbit→Freefly 有 `setTarget` ✅ 已修复；AR 失败只在 `_cameraMode === 'ar'` 时还原 ✅ 已修复 |
| `__tests__/camera.test.ts` | 测试覆盖 | 存在 |
| `__tests__/orbit.test.ts` | 测试覆盖 | 存在 |

---

### 🟡 模块 9：模型管理层

**优先级：中高**

| 文件 | 验收维度 | 检查项 |
|------|---------|--------|
| `scene/manager/model-manager.ts` | 类型安全 | 0 处 `as any` ✅ 已审查 |
| `scene/manager/model-manager.ts` | 资源管理 | 50+ 方法职责清晰；模型卸载时 dispose 完整 |
| `scene/manager/model-manager.ts` | 测试覆盖 | `__tests__/model-manager.test.ts` 116 个测试用例 ✅ |
| `scene/manager/material/` | 功能正确性 | 材质编辑 undo/redo 链路；`__tests__/material-editor.test.ts` 存在 |
| `scene/manager/loader/` | 功能正确性 | PMX 加载错误处理；`__tests__/model-ops.test.ts` 存在 |
| `__tests__/scene-model.test.ts` | 测试覆盖 | 存在 |

---

### 🟢 模块 10：菜单系统

**优先级：中（纯 UI builder）**

| 文件 | 验收维度 | 检查项 |
|------|---------|--------|
| `menus/menu.ts` | 功能正确性 | 菜单开/闭无状态泄漏；`__tests__/menu.test.ts` 存在 |
| `menus/library-core.ts` | 类型安全 | 0 处 `as any`；`__tests__/library-core.test.ts` 44 个测试 ✅ |
| `menus/model-detail.ts` | 功能正确性 | `container.isConnected` 守卫防止菜单关闭后 IPC 写 ✅ 已修复；Promise 嵌套 `.catch` 改为 `console.warn` ✅ 已修复 |
| `menus/env-feature-levels.ts` | 类型安全 | 0 处 `as any`；1079 行是 8 个独立 builder 的自然体量，无需拆分 ✅ |
| `menus/scene-stage-lights.ts` | 功能正确性 | 灯光删除后存在性校验 ✅ 已修复 |
| `menus/settings*.ts`（11 个子模块） | 类型安全 | barrel 导出路径不变；各子模块 0 处 `as any` |
| `__tests__/model-detail-ui.test.ts` | 测试覆盖 | 存在 |

---

### 🟢 模块 11：动作算法（无 Babylon 依赖）

**优先级：中**

| 文件 | 验收维度 | 检查项 |
|------|---------|--------|
| `motion-algos/procedural-motion.ts` | 类型安全 | barrel re-export，0 处 `as any`；`__tests__/procedural-motion.test.ts` 存在 |
| `motion-algos/vmd-writer.ts` | 功能正确性 | Shift-JIS 骨骼名编码正确；`__tests__/vmd.test.ts` 存在 |
| `motion-algos/vpd-parser.ts` | 功能正确性 | UTF-8/Shift-JIS 自动识别；`__tests__/vpd-parser-security.test.ts` 存在（安全边界） |
| `motion-algos/vmd-evaluator.ts` | 功能正确性 | 多图层混合逻辑正确 |
| `motion-algos/beat-detector.ts` | 功能正确性 | Web Audio 能量峰值计算正确；`__tests__/beat-detector.test.ts` 存在 |
| `motion-algos/lipsync.ts` | 功能正确性 | 振幅→morph 权重映射；`__tests__/lipsync.test.ts` 存在 |

---

### 🟢 模块 12：核心基础设施

**优先级：中**

| 文件 | 验收维度 | 检查项 |
|------|---------|--------|
| `core/main.ts` | 类型安全 | 1 处 `as any`（E2E 调试 hook，可接受）；1 处 `@ts-ignore`（Wails v2→v3 兼容，有注释） |
| `core/main.ts` | 功能正确性 | 事件绑定无泄漏（顶层 addEventListener 10 个，应用生命周期） |
| `core/state.ts` | 类型安全 | 0 处 `as any` ✅ 已修复；`__tests__/env-state.test.ts` 存在 |
| `core/fileservice.ts` | 功能正确性 | `resolveFileUrl` 覆盖 zip 内路径；`__tests__/fileservice.test.ts` 存在 |
| `core/ui-helpers.ts` | 功能正确性 | DOM 构建工具无副作用；`__tests__/ui-helpers.test.ts` 存在 |
| `core/reactivity.ts` | 功能正确性 | signal / effect 泄漏防护；`__tests__/config.test.ts` 有间接覆盖 |
| `core/icons.ts` + `iconify-registry.ts` | 功能正确性 | 本地图标注册表无重复注册 |

---

### 审核进度

| 模块 | 风险等级 | 类型安全 | 资源管理 | 测试覆盖 | 功能正确性 | 状态 |
|------|---------|---------|---------|---------|---------|------|
| 1. Binding 契约层 | 🔴极高 | ⬜ | ⬜ | ⬜ | ⬜ | 待审核 |
| 2. 换装+音频 | 🔴极高 | ✅ | ⬜ | ⬜ | ⬜ | 待审核 |
| ~~3. XPBD 物理~~ | ~~🟠高~~ | — | — | — | — | 已移除 |
| 4. 渲染管线 | 🟠高 | ✅ 已审 | ✅ 已审 | ✅ | ⬜ | 待审核 |
| 5. 环境系统 | 🟠高 | ✅ 已审 | ✅ 已审 | ✅ | ✅ 已修 | 部分 |
| 6. 场景编排 | 🟡中高 | ⬜ | ⬜ | ⬜ | ⬜ | 待审核 |
| 7. 动作桥接层 | 🟡中高 | ✅ 已修 | ✅ 已修 | ✅ | ✅ 已修 | 部分 |
| 8. 相机系统 | 🟡中高 | ⬜ | ✅ 已修 | ✅ | ✅ 已修 | 部分 |
| 9. 模型管理层 | 🟡中高 | ✅ 已审 | ⬜ | ✅ | ⬜ | 待审核 |
| 10. 菜单系统 | 🟢中 | ✅ | ⬜ | ✅ | ✅ | 待审核 |
| 11. 动作算法 | 🟢中 | ✅ | N/A | ✅ | ⬜ | 待审核 |
| 12. 核心基础设施 | 🟢中 | ✅ | ⬜ | ✅ | ✅ | 待审核 |

**图例：** ✅ 已通过 · ✅ 已修（历史修复） · ✅ 已审（历史审查） · ⬜ 待审核

---

## 五、历史维护记录（仅供追溯）

> 以下为历史修复/审查记录，已按审核进度表标注。

### 5.1 已修复

| 问题 | 状态 |
|------|------|
| `store/` 模块 6 个 tsc 编译错误 | ✅ 已修复（import 路径、RootState 字段、类型导出） |
| `proc-motion-bridge.ts` 9 个 `as any` | ✅ 已修复（引入 `MmdRuntimeBoneExtended` / `MeshMetadata` 接口） |
| `env-water.ts` 4 个 `as any` | ✅ 已修复（引入 `PostProcessInternal` 接口） |
| `wasm-layers-blender.ts` 1 个 `as any` | ✅ 已修复（复用 `MmdRuntimeBoneExtended`） |
| `env-bridge.ts` 1 个 `as any` | ✅ 已修复（移除冗余断言） |

### 5.2 已审查（无需改动）

| 文件 | 行数 | 结论 |
|------|------|------|
| `menus/settings.ts` → 11 个子模块 | 107+分散 | 拆分完成，barrel 路径不变 |
| `motion-algos/procedural-motion.ts` → 5 个子模块 | 60+分散 | 拆分完成 |
| `scene/render/lighting.ts` | 1244 | 0 `as any`，资源释放完整，测试充分 |
| `menus/env-feature-levels.ts` | 1079 | 8 个独立 builder，职责清晰 |
| `scene/env/env-water.ts` | 1128 | 水面渲染固有复杂度，结构清晰 |
| `menus/library-core.ts` | 954 | 0 `as any`，44 个测试 |
| `scene/manager/model-manager.ts` | 989 | 50+ 方法但测试充分（116 个） |
| `core/main.ts` | 1084 | 遗留 `as any` 有业务理由 |

### 5.3 运行时隐患修复（2026-07-08）

| 模块 | 问题 | 修复 |
|------|------|------|
| `outfit.ts` | `loadOutfits`/`applyOutfitVariant` 未检查 `modelRegistry.get()` | 添加 undefined 守卫 |
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

### 5.4 结构性风险（已解决）

| 问题 | 状态 |
|------|------|
| **状态双源**：`store/index.ts` | ✅ 已删除，`core/state.ts` 为唯一状态源 |
| **深链 import** | ✅ 已添加 `@/` 和 `@bindings/` 别名，60 处 `../../` 已替换 |
| **事件监听器泄漏** | ✅ 已修复。分析 31 个 `addEventListener` 文件：动态累积监听器（1 个 `settings-about.ts`）已有防重复注册标志 |

### 5.5 历史拆分记录

| 文件 | 原行数 | 拆分结果 |
|------|--------|----------|
| `procedural-motion.ts` | 1496 | → `procedural-motion.ts`(60) + 4 个子模块 |
| `settings.ts` | 2189 | → `settings.ts`(107) + 11 个子模块 |

