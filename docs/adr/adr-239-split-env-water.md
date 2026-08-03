# ADR-239: env-water.ts 拆模块 —— 材质/反射/FX 三向拆分与生命周期宿主收拢（ADR-237 P3 落地）

> **状态**: ✅ 已实施（2026-08-03 完成；四文件拆分落地，env-water.ts 1569→237 行）
> **日期**: 2026-08-03
>
> **编号**: 239
>
> **关联**: [ADR-237](adr-237-split-overlong-modules.md)（P3 来源，超限模块拆分路线图）、[ADR-062](adr-062-环境系统架构.md)（env 子系统架构）、[ADR-115](adr-115-环境系统重构.md)（env 重构，含材质资源生命周期）、[ADR-138](adr-138-环境系统三期.md)（env 三期，水面/涟漪能力边界）、[ADR-151](adr-151-反射质量.md)（reflectionMode 全局覆盖——`waterReflection.getQuality` 依赖）
>
> **来源**: ADR-237 P3 立项要求；2026-08-03 摸查 `frontend/src/scene/env/env-water.ts` 确认 1569 行、约 30 个顶层符号、五类职责混杂，且 `_envSys` 单例共享面实测可支撑拆边界。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-08-03

---

## 1. 背景：1569 行超限与职责混杂

`env-water.ts` 为项目最大单文件（1569 行，超过 250LOC 天花板 6 倍），2026-08-03 摸查确认顶层符号约 30 个，职责混杂五类：

| 职责 | 代表符号 | 行区间（实测） |
|------|----------|---------------|
| 材质/着色器 | `WATER_UNIFORMS`/`_createWaterMaterial`/`_rebuildWaterMaterial`/`_waterUpdateCallback`/`_syncWaterUniforms`/Gerstner 常量/detail normal 纹理/preset uniform 系 | 100-110, 484-566, 570-749, 814-1002, 1418-1569 |
| 反射 | `waterReflection`（PlanarReflection 单例）/`_setupMirrorRT`/`_waterMirrorPlane` | 18, 124-193, 750-756 |
| FX | ripple 系/ground ripple 系/LOD/underwater transition/`computeWaveDirs`/`isUnderwaterActive` | 44-60, 61-99, 194-483, 780-813, 1139-1409 |
| 生命周期/编排 | `createWater`/`disposeWater`/`_updateWaterMesh`/`updateWaterAnimSpeed`/`refreshWaterRenderList`/`getWaterPhase` | 757-779, 1003-1138, 1409-1417 |
| 模块级可变状态 | `_waterLODs`/`_activeWaterLOD`/`_waterPhase`/`_waterWaveSpeed`/`_waterUpdateObserver`/`_underwater*`/`_detailNormalTexture` | 散布 |

拆分先例已建立：perception（10 文件）、autodance（540→148）、proc-motion-bridge P1（736→135 + 2 文件，ADR-237），均走「宿主收拢 + 职责分文件」模式。

## 2. 决策：四文件边界 + `_envSys` 单例总线

### 2.1 目标结构

| 文件 | 职责 | 预计行数 |
|------|------|---------|
| `env-water.ts` | **生命周期宿主 + 编排器**：`createWater`/`disposeWater`/`_updateWaterMesh`/`updateWaterAnimSpeed`/`refreshWaterRenderList`/`getWaterPhase` + 模块级可变状态 + 对外薄转发 | ~350 |
| `env-water-material.ts` | 材质/着色器：`WATER_UNIFORMS`/`_createWaterMaterial`/`_rebuildWaterMaterial`/`_waterUpdateCallback`/`_syncWaterUniforms`/Gerstner 常量/`computeDetailNormalSpeeds`/detail normal 纹理/preset uniform 系 | ~600 |
| `env-water-reflect.ts` | 反射：`waterReflection` 单例 + `registerReflectionSurface` 注册 + `_setupMirrorRT` + `_waterMirrorPlane` | ~120 |
| `env-water-fx.ts` | 涟漪/地面涟漪/LOD/水下：ripple 系全部 + `selectWaterLOD`/`_applyWaterLOD` + underwater transition/reset + `computeWaveDirs`/`isUnderwaterActive` | ~500 |

### 2.2 通信机制：`_envSys` 单例即总线

**关键实测**：`waterReflection`（PlanarReflection）的 `getMaterial`/`mount`/`setBlend` 回调已通过 `_envSys.water.material` 间接访问材质——**reflect 与 material 的耦合是「经共享单例」而非「模块互 import」**。因此：

1. 三模块**互不 import**，只依赖 `_envSys` 单例 + 宿主转发的状态；`_envSys` 保持现状不动。
2. 反射归属 reflect 模块，其回调继续读 `_envSys.water.material`（材质由 material 模块创建后挂到 `_envSys.water.material`）。
3. 模块级可变状态（`_waterLODs`/`_waterPhase`/`_underwater*` 等）**留在宿主**，fx/material 通过宿主转发的 getter 或参数读取。
4. 事件订阅（`_waterUpdateObserver`）与 dispose 时序仍由宿主 `disposeWater` 统一编排（现有释放顺序为实测调优产物，不得打乱）。

### 2.3 实施工具与纪律

- 用 `npm run codemod move-function`（AST 感知）移函数，**禁止 Python re.sub 手改跨文件引用**（AGENTS.md）
- 新符号归属模糊处（`computeWaveDirs`/`_WATER_KEYS` 的外部引用面）先跑 `scripts/check-consumers.mjs`（d240afe4 新增的反向查询脚本）定引用，再定归属
- 每步拆分后 `npm run check:funcmap` + 相关单测；拆完 `npm run check:circular --strict` 确认不新增环

## 3. 风险与对策

| 级别 | 风险 | 对策 |
|------|------|------|
| 🔴 P1 | `_envSys.water` 全局共享，模块间隐式耦合 | 保持单例总线现状，模块只读不改共享状态；拆完 `check:circular --strict` 锁环数不增 |
| 🔴 P1 | `waterReflection` 单例与材质硬耦合（`mount`/`setBlend` 改材质 uniform） | 经 `_envSys.water.material` 中转，不 import material 模块；`disposeWater` 委托 `waterReflection.dispose()` 不变 |
| 🟡 P2 | `getScene()` null guard 回归（历史 P1 已修：`createWater` 有 scene not ready 分支；`dispose` 用注册时捕获的 `_waterScene` 避免 scene 已 dispose 时取 null） | 拆分逐函数核对两处 guard 保留；补一条回归断言（若有 env-water 单测） |
| 🟡 P2 | preset 系（`applyWaterPresetToCurrent`/`buildWaterPresetEnvState`）跨 material+state 边界 | 归 material 模块；state 写入走 EnvState 契约，不碰 `_envSys` 外部状态 |
| 🟢 P3 | 视觉回归（水面默认值逐像素变化） | 拆前截图基线；拆后逐像素对比（水面默认参数 + 开启涟漪/反射/水下三档） |
| 🟢 P3 | 行为回归（涟漪/ground ripple/LOD/underwater transition 时序） | env 子系统全量测试锁基线（env-bridge 6 int + env-state/env-lighting/environment-integration 等 8+ 文件 70+ it） |

## 4. 实施步骤（对齐 ADR-237 §3 纪律）

1. **锁基线**：commit 当前工作区（ADR-238 并行特性先各自提交）；跑 env 全量测试记录 it 数与耗时
2. **先移 fx**（低耦合）：ripple/ground ripple 系 → `env-water-fx.ts`，宿主补转发
3. **再移 material**（核心）：材质系 → `env-water-material.ts`
4. **最后移 reflect**（耦合最深）：`waterReflection`/`_setupMirrorRT` → `env-water-reflect.ts`
5. 每步：`check:funcmap` + 相关单测 + `tsc --noEmit`；全部完成后 `check:circular --strict` + 视觉回归
6. 知识卡同步（`docs/knowledge/` 中 env 相关卡 source_files/symbols）+ `npm run check:docs`

## 5. 验证

- `check:funcmap`（函数签名无漂移）+ `tsc --noEmit` 零错误
- env 子系统全量测试全绿（8+ 文件 70+ it）
- `check:circular --strict` 环数不增（现基线：白名单环 12 + 新增环 17，见 ADR-238 实测）
- 视觉回归：水面默认值逐像素一致（含涟漪/反射/水下三档）

## 6. 不在范围

- **运行时行为变更**：纯结构性重构，禁止改变任何可观测行为（含涟漪参数、LOD 阈值、水下过渡速度）
- **反射实现替换**：维持 PlanarReflection（ADR-151 质量覆盖逻辑不动）
- **材质能力扩展**：不新增/调整着色器 define 或 uniform
- **一次性拆完**：按 §4 分 4 步小步提交，每步独立 review
