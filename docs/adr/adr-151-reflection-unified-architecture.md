# ADR-151: 反射系统统一架构（Reflection Unification）

- **状态**: ✅ 已实施
- **日期**: 2026-07-20
- **相关**: ADR-024（SSR/ReflectionProbe）、ADR-062（水面平面反射）、ADR-092（统一平面反射引擎）、ADR-013（天空贴图系统，参考模式）

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

export type ReflectionMode = 'auto' | 'none' | 'probe' | 'ssr' | 'planar' | 'hybrid';
export type ResolvedReflectionMode = 'none' | 'probe' | 'ssr' | 'planar' | 'hybrid';

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

`resolveReflectionMode` 根据 `state.reflectionMode`（手动指定）或 `state.reflectionQuality`（auto 推导）确定最终模式。

### 决策二：`reflectionMode` 独立字段（审查后调整）

**原设计**：复用 `reflectionQuality` 同时控制模式和参数。
**审查问题**：`reflectionQuality` 在地面/水面中专指 PlanarReflection 的分辨率/帧率等级，语义冲突。
**最终决策**：新增独立的 `reflectionMode` 字段：

```typescript
// env-state-schema.ts
reflectionMode: {
    type: 'enum',
    values: ['auto', 'none', 'probe', 'ssr', 'planar', 'hybrid'],
    default: 'auto',
}
```

- `auto`：根据 `reflectionQuality` 自动推导模式
- 其他值：手动覆盖，优先级高于推导
- `reflectionQuality` 保持原有语义（仅控制 Planar 分辨率 + auto 模式推导依据）

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

### 决策四：`reflectionTexture` 所有权声明

引入 `_textureOwner` 模块级变量 + `_savedReflectionTextures` Map：

```typescript
type ReflectionTextureOwner = 'probe' | 'planar' | 'material' | 'none';
let _textureOwner: ReflectionTextureOwner = 'none';
const _savedReflectionTextures = new Map<number, BaseTexture | null>();
const _probeBoundMaterials = new Set<number>();
```

**安全机制（审查后调整）：**
- 绑定前逐个保存（非批量一次性），新模型加载时通过 `onModelMeshesReady` 自动补绑
- restore 时校验材质是否仍存活（`isDisposed` 守卫）
- Probe 排除 `env*` 前缀网格，避免与 PlanarReflection 的地面/水面槽位冲突

### 决策五：质量层级联动

`reflectionQuality` 在 `auto` 模式下推导默认模式及参数：

| 等级 | 推导模式 | SSR 参数 | Probe | PlanarReflection |
|------|---------|---------|-------|------------------|
| `off` | `none` | — | 关 | 关 |
| `low` | `probe` | — | 256px, strength=0.3 | 关 |
| `medium` | `probe` | — | 256px, strength=0.5 | low (每 4 帧) |
| `high` | `hybrid` | step=16, strength=0.7 | 256px, strength=0.3 | medium (每 2 帧) |
| `ultra` | `hybrid` | step=32, strength=1.0 | 512px, strength=0.5 | high (每帧) |

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

### Phase 2：质量层级联动（已完成）

`QUALITY_PRESETS` 映射表内置于 `env-reflection.ts`，`auto` 模式下自动推导。

### Phase 3：`hybrid` 模式（已完成）

Probe 强度减半 + SSR 独立渲染，通过 `_enableHybrid` 分支实现。

### Phase 4：清理 + 文档更新（已完成）

- `renderer.ts` 中 Probe 相关代码已全部清除
- `bindReflectionProbeToModel` / `refreshReflectionProbe` 已删除
- 测试文件已补充 `reflectionMode` 字段

---

## 已解决的问题

1. **`reflectionQuality` vs 现有字段的兼容**：新增独立的 `reflectionMode` 字段（`auto/none/probe/ssr/planar/hybrid`），`reflectionQuality` 保持原有语义（Planar 分辨率 + auto 推导依据）。两者解耦，互不干扰。

2. **`ultra` 等级 Probe 分辨率**：`QUALITY_PRESETS` 中 `ultra` 已配置 512px Probe（显存 ≈6MB + MIP chain ≈8MB，可接受）。

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
