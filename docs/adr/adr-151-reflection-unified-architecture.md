# ADR-151: 反射系统统一架构（SSR/Probe 统一入口 + Planar 协调）

- **状态**: ✅ 已实施
- **日期**: 2026-07-20
- **文档修订**: 2026-07-22（修正 `auto`/`ultra` 漂移、决策四 `_textureOwner` 描述、补充遗留问题；与 `env-reflection.ts` / `env-state-schema.ts` 现状对齐）
- **相关**: ADR-024（SSR/ReflectionProbe）、ADR-062（水面平面反射）、ADR-092（统一平面反射引擎）、ADR-013（天空贴图系统，参考模式）

> **范围说明**：本 ADR 的"统一"指 **SSR 与 ReflectionProbe 的统一入口 `applyReflection` + 单一 `reflectionMode` 控制**；PlanarReflection（地面/水面）保持 `env-ground`/`env-water` 自管理，仅通过 `getPlanarQualityOverride` 做质量协调，其生命周期不在 `applyReflection` 内。

---

## 背景与问题

当前项目包含 **3 层独立反射机制**，分别由三个不同的子系统管理：

| 反射层 | 位置 | 技术方案 | 管理入口 |
|--------|------|---------|---------|
| **SSR**（屏幕空间反射） | `renderer.ts:435-483` | `SSRRenderingPipeline`（独立 pipeline） | `_applyRenderState` 内联 |
| **ReflectionProbe**（静态环境探针） | `renderer.ts:485-545` | 256px cubemap，绑定 `StandardMaterial.reflectionTexture` | `_applyRenderState` 内联 |
| **PlanarReflection**（平面反射） | `planar-reflection.ts` | MirrorTexture（地面）+ RenderTargetTexture（水面）+ 互斥协调器 | `env-ground.ts` / `env-water.ts` 内 `update()` 调用 |

三个问题：

### 1. 视觉双重反射不对齐

SSR 与 ReflectionProbe 同时启用时，模型获得 **两层反射叠加**：cubemap 提供静态环境色（通过 `reflectionTexture`），SSR 在屏幕空间追加动态 ray-marched 反射。两层可能不对齐——cubemap 不随模型旋转更新（`refreshRate=0`），SSR 追的是帧 buffer 中的实时像素，高光区域叠加后视觉模糊。

### 2. 无质量分级协调

各自独立的质量/强度控制，没有统一"反射质量等级"联动：

```
SSR:                step 1-32, thickness 0-2, strength 0-1
ReflectionProbe:    reflectionIntensity 0-1 (固定 256px)
PlanarReflection:   reflectionQuality high/medium/low/off (各模式各自的分辨率映射)
```

三者不共享层级概念。`ADR-024` 定义的 L1/L2/L3 降级策略仅手动提及 SSR 和 ReflectionProbe，未覆盖 PlanarReflection，且无代码级强制执行。

### 3. `reflectionTexture` 所有权无声明

ReflectionProbe 遍历所有模型网格直接写入 `reflectionTexture`（`renderer.ts:519-543`），这是一种**隐式所有权声明**。任何其他子系统若想使用 `reflectionTexture` 通道（如 PBR 粗糙度驱动的反射模糊、材质级的环境贴图覆盖），都会与 ReflectionProbe 冲突。当前无冲突检测或优先级协商。

---

## 参考模式：天空系统

天空子系统（`env-sky.ts`）的设计模式可作为重构蓝本：

| 特征 | 天空的做法 | 反射的借鉴点 |
|------|-----------|------------|
| **统一入口** | `applySky(state)`，内部分支处理 color/procedural/texture | `applyReflection(state)` 内部分支处理 probe/ssr/planar/hybrid |
| **全量清理** | 每个分支入口都先 `disposeSky()` 确保旧资源纯净 | 模式切换时全盘清理旧 RT + pipeline + 材质绑定 |
| **去重** | `_lastProceduralSkyKey` 避免同参数重复构建 | 反射参数变更时按 key 判断是否需要重建 |
| **职责分层** | IBL（环境照明）与可见天空球（视觉效果）独立管理 | SSR（动态屏幕细节）与 Probe（静态环境底色）分层，明确混合规则 |
| **模式独占** | 三种模式互斥，一次只能激活一种 | 反射模式同样互斥（或混合模式有明确分层权重） |

---

## 决策

### 决策一：统一入口 `applyReflection`

新建 `src/scene/env/env-reflection.ts`，提供单一入口函数 `applyReflection(state: EnvState)`。

```typescript
// env-reflection.ts — 反射子系统统一入口
// 参考 sky 子系统（env-sky.ts）的 applySky 模式

export type ReflectionMode = 'none' | 'planar' | 'ssr' | 'probe' | 'hybrid';
export type ResolvedReflectionMode = 'none' | 'planar' | 'ssr' | 'probe' | 'hybrid';

export function applyReflection(state: EnvState): void {
    const mode = resolveReflectionMode(state);
    switch (mode) {
        case 'none': disableAllReflection(); break;
        case 'probe': enableProbeReflection(state); break;
        case 'ssr': enableSSRReflection(state); break;
        case 'planar': /* PlanarReflection 由 env-ground/env-water 自管理 */ break;
        case 'hybrid': enableHybridReflection(state); break;
    }
}
```

`resolveReflectionMode` 直接返回 `state.reflectionMode`（手动指定，默认 `planar`）；`reflectionQuality` 不参与模式推导，仅在已选模式内微调 SSR/Probe 参数与 PlanarReflection 分辨率。

### 决策二：`reflectionMode` 独立字段（审查后调整）

**原设计**：复用 `reflectionQuality` 同时控制模式和参数。
**审查问题**：`reflectionQuality` 在地面/水面中专指 PlanarReflection 的分辨率/帧率等级，语义冲突。
**最终决策**：新增独立的 `reflectionMode` 字段：

```typescript
// env-state-schema.ts
reflectionMode: {
    type: 'enum',
    values: ['none', 'planar', 'ssr', 'probe', 'hybrid'],
    default: 'planar',
}
```

- 五个值均为**手动指定**模式（无 `auto` 推导档；`auto` 已从 schema 移除）
- `reflectionQuality` 保持原有语义：在已选模式内微调 SSR/Probe 参数（step/strength/thickness、Probe 分辨率/强度），并控制 PlanarReflection 分辨率/帧率

### 决策三：模式定义与行为

| 模式 | 激活子系统 | 适用场景 | 相对性能 |
|------|-----------|---------|--------|
| `none` | 全关 | 最低画质 / AR 模式 / 低端设备 | 0 |
| `probe` | 仅 ReflectionProbe | 静态展示，模型不需要反射动态效果 | 低 |
| `ssr` | 仅 SSR（关闭 Probe） | 需要动态反射细节 | 中 |
| `planar` | 仅 PlanarReflection（地面/水面互斥） | 需要地面/水面反射 | 低-中 |
| `hybrid` | SSR + Probe（分层混合） | 最高画质 | 高 |

**互斥粒度为材质槽位级（审查后调整）：**
- SSR + Planar 可共存（SSR 是后处理，Planar 是材质 RT，渲染路径独立）
- Probe + Planar 可共存（Probe 仅写模型材质，排除 `env*` 前缀的环境网格）
- 真正的互斥点：同一材质的 `reflectionTexture` 槽位

**`hybrid` 模式的分层规则**：
1. ReflectionProbe 绑定模型材质 `reflectionTexture`，强度 = `preset.probe.strength × 0.5`
2. SSR 独立渲染，强度 = `preset.ssr.strength`
3. SSR + Bloom 互斥仍然保留（现有逻辑）
4. `planarReflectBlend` 与混合模式无关，水面/地面单独控制

### 决策四：`reflectionTexture` 保存/恢复机制

> **修订说明（2026-07-22）**：原方案拟引入 `_textureOwner` 模块级变量做所有权声明与优先级协商，实际实现改为更简单的 **save/restore** 方案：因 Probe 绑定始终排除 `env*` 前缀网格（地面/水面/天空），与 PlanarReflection 写入的 `reflectionTexture` 槽位**不存在同网格冲突路径**，故无需全局所有权仲裁。

引入 `_savedReflectionTextures` Map + `_probeBoundMaterials` Map：

```typescript
// 材质 uniqueId → 原始 reflectionTexture（绑定前逐个保存，避免 cubeTexture 被误存为"原始值"）
const _savedReflectionTextures = new Map<number, BaseTexture | null>();
// 材质 uniqueId → 材质引用（dispose 时直接遍历恢复，规避模型卸载后 scene.meshes 漏恢复）
const _probeBoundMaterials = new Map<number, MaterialWithReflection>();
```

**安全机制：**
- 绑定前逐个保存（非批量一次性），新模型加载时通过 `onModelMeshesReady` 自动补绑
- restore 时校验材质是否仍存活（`isDisposed` 守卫，已 dispose 的材质跳过并清理映射）
- Probe 排除 `env*` 前缀网格，避免与 PlanarReflection 的地面/水面槽位冲突
- **遗留问题（P4）**：`_restoreOriginalTexture` 还原 `reflectionTexture` 但未还原 `reflectionColor`，Probe 退出后材质残留绑定期强度色。MMD 材质一般无自有 `reflectionTexture`，实际良性，待补还原。

### 决策五：质量参数映射（模式内固定，非模式推导）

> **修订说明（2026-07-22）**：`reflectionQuality` **不推导模式**（无 `auto` 档），仅在已手动选定的模式内决定 SSR/Probe 的具体参数与 PlanarReflection 分辨率。`resolveReflectionMode` 忽略 `reflectionQuality` 做模式选择。

`QUALITY_PRESETS` 映射（内置于 `env-reflection.ts`，无 `ultra` 等级）：

| 等级 | SSR 参数 | Probe 参数 | PlanarReflection |
|------|---------|-----------|------------------|
| `off` | 关 | 关 | 关 |
| `low` | 关 | 256px, strength=0.3 | 依 `reflectionQuality` 自身档位 |
| `medium` | 关 | 256px, strength=0.5 | 同上 |
| `high` | step=16, strength=0.7, thickness=0.5 | 256px, strength=0.3 | 同上 |

> SSR/Probe 参数仅在 `reflectionMode` 为 `ssr`/`hybrid`（`ssr`）或 `probe`/`hybrid`（`probe`）时生效；`planar`/`none` 模式忽略本表 SSR/Probe 列。PlanarReflection 分辨率仍由 `reflectionQuality` 原语义驱动，并经 `getPlanarQualityOverride` 协调（`none`→强制 off，`planar`→至少 low）。

### 决策六：资源迁移

#### 6.1 ReflectionProbe 从 `renderer.ts` 迁出

Probe 的创建/绑定/刷新/销毁全部移入 `env-reflection.ts`。
`renderer.ts` 中删除 `_reflectionProbe`、`_probeRefreshObserver`、`bindReflectionProbeToModel`、`refreshReflectionProbe`。

#### 6.2 SSR 保持管线独立，控制权移交

SSR 的 `SSRRenderingPipeline` 对象仍在 `renderer.ts` 维护，但新增 `setSSRFromReflection()` 导出函数供 `env-reflection.ts` 调用（不触发 auto-save）。

#### 6.3 PlanarReflection 保持独立

`planar-reflection.ts` 不动，`env-ground.ts` 和 `env-water.ts` 照常调用。
`planar` 模式下不强制修改 `reflectionQuality`，PlanarReflection 内部自行判断 `shouldEnable`。

---

## 实施记录

### Phase 1：新建 `env-reflection.ts` + 模式推导 + Probe 迁移（已完成）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 1.1 | 新建 `env-reflection.ts`，实现 `resolveReflectionMode` + `applyReflection` 骨架 | 函数定义 + 类型定义 |
| 1.2 | 实现 `none` / `probe` / `ssr` / `hybrid` 四个模式分支 | Probe 迁入 + SSR 委托 + 所有权 save/restore |
| 1.3 | 在 `env-state-schema.ts` 添加 `reflectionMode` 字段 | 状态字段 + 默认值 |
| 1.4 | 从 `renderer.ts` 删除 Probe 代码，新增 `setSSRFromReflection` 导出 | 简化后的 renderer |
| 1.5 | `scene.ts` 改用 `onModelMeshesReady` + `disposeReflection` | 模型加载绑定 + 场景销毁释放 |

### Phase 2：质量参数映射（已完成）

`QUALITY_PRESETS` 映射表内置于 `env-reflection.ts`，在已选模式内提供 SSR/Probe 参数微调（无 `auto` 模式推导；`reflectionQuality` 仅作参数与 Planar 分辨率来源）。

### Phase 3：`hybrid` 模式（已完成）

Probe 强度减半 + SSR 独立渲染，通过 `_enableHybrid` 分支实现。

### Phase 4：清理 + 文档更新（已完成）

- `renderer.ts` 中 Probe 相关代码已全部清除
- `bindReflectionProbeToModel` / `refreshReflectionProbe` 已删除
- 测试文件已补充 `reflectionMode` 字段

---

## 已解决的问题

1. **`reflectionQuality` vs 现有字段的兼容**：新增独立的 `reflectionMode` 字段（`none/planar/ssr/probe/hybrid`），`reflectionQuality` 保持原有语义（Planar 分辨率 + 已选模式内参数微调依据）。两者解耦，互不干扰。

2. **`reflectionQuality` vs 现有字段的兼容**（修订）：`ultra` 等级已从 schema 与 `QUALITY_PRESETS` 移除（最高档为 `high`，Probe 256px）。遗留 `ultra` 值会在 `getQualityPreset` 中回退 `off` 并静默关闭反射，UI 不应再产生该值。

3. **过渡动画兼容**：模式切换时通过 `_disableCurrentMode` 全量清理旧资源再重建，避免残留状态。数值过渡（如 SSR strength 渐变）由 `transitionRenderState` 处理，模式切换本身不做插值。

4. **新模型加载时的 Probe 绑定**：`scene.ts` 的 `setOnMeshesReady` 回调改为调用 `onModelMeshesReady`，自动为新模型执行 save + bind。

5. **材质槽位级互斥**：Probe 绑定时排除 `env*` 前缀网格（地面/水面/天空），避免与 PlanarReflection 的 `reflectionTexture` 槽位冲突。

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| ReflectionProbe 迁出 `renderer.ts` 后 SSR 与 Probe 间同步时序被打乱 | P2 | 统一入口 `applyReflection` 保证两者状态在同一函数调用中完成同步 |
| 性能降级系统仍通过 `setRenderState({ reflectionProbeEnabled })` 发送指令 | ✅ 已解决 | **收口完成（2026-07-20）**：降级系统改写为写入 `env.reflectionQuality`（经 `resolveQualityProfile` → `applyReflection` 统一驱动），`renderer.ts` 的 no-op 空分支已移除，并新增「降级不高于用户原始反射质量」上限守卫 |
| 现有 UI 面板直接操作 `ssrEnabled` / `reflectionProbeEnabled` | ✅ 已解决 | **收口完成（2026-07-20）**：旧 SSR 开关/4 滑杆与探针开关已从渲染菜单、设置面板、渲染预设中移除，`RenderState` 反射字段删除，反射控制单源化到 `reflectionMode` / `reflectionQuality` |
| 模式切换时资源重建可能导致 1-2 帧卡顿 | P4 | 水面材质始终包含 `PLANAR_REFLECTION` define，通过 blend=0 控制可见性，避免 shader 重编译 |
| `reflectionMode` 若残留 `auto` 值（旧存档/旧 UI）会静默 no-op 致零反射 | P3 | `resolveReflectionMode` 已无 `auto` 分支；schema 已移除该枚举。建议兜底 `?? 'planar'` 处显式拒绝 `auto`：`if (mode === 'auto') return 'planar'` |
| Probe 退出时 `reflectionColor` 未随 `reflectionTexture` 还原 | P4 | `_restoreOriginalTexture` 仅恢复纹理；MMD 材质一般无自有 `reflectionTexture`，实际良性。待补 `reflectionColor` 还原以消除状态不一致（见决策四遗留问题） |
