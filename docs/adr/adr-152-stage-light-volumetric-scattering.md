# ADR-152: 舞台灯光体积光散射（Volumetric Light Scattering）

- **状态**: ✅ 已实施
- **日期**: 2026-07-20
- **相关**: ADR-151（反射统一架构，参考生命周期模式）、ADR-114（接触阴影 PostProcess，参考相机挂接模式）

---

## 背景与问题

用户反馈："开了反射就看不见聚光灯了。"

当前 [lighting.ts](../../frontend/src/scene/render/lighting.ts) 中的舞台聚光灯/点光源/方向光都是 Babylon.js 的**数学光照**——只对受光物体的着色产生影响，本身在屏幕上不可见。配合 [env-reflection.ts](../../frontend/src/scene/env/env-reflection.ts) 的 SSR/Probe/Planar 反射后，场景中已无"光柱可见性"的视觉表达，导致用户无法直观感知灯光位置与方向。

需求：在聚光灯/方向光上附加**可见光柱**效果（丁达尔效应），且与反射系统共存不冲突。

## 调研结论

### 方案对比

| 方案 | 接近辉光 | 性能 | 实现复杂度 | 与反射共存 |
|------|---------|------|-----------|------------|
| **VolumetricLightScatteringPostProcess** | ★★★★★ | 中（单次屏幕后处理） | ⭐⭐ | ✅ 互不影响（后处理 vs 材质纹理） |
| GlowLayer（已有） | ★★★★ | 低 | ⭐ | ✅ 但只让 emissive 物体发光，无光柱 |
| 光锥 Mesh + 发光材质 | ★★ | 低 | ⭐ | ⚠ 几何体可能被反射捕获产生伪像 |
| 自定义 ray-marched 体积光 | ★ | 极高 | ⭐⭐⭐⭐ | ✅ 但过度工程 |

### 选定方案：VolumetricLightScatteringPostProcess

**理由：**
1. Babylon.js 内置后处理，与 DefaultRenderingPipeline 同层，不侵入材质系统
2. 与反射系统正交（反射写 `reflectionTexture`，体积光操作屏幕像素），无槽位冲突
3. 实现成本远低于反射系统（单 PostProcess vs 多模式架构）
4. 参考 ADR-114 接触阴影的相机挂接模式，生命周期已验证

### API 关键约束（已查 Babylon.js 官方 TypeDoc）

| 属性 | 类型 | 说明 |
|------|------|------|
| `mesh` | `Mesh` | 内部使用的光源位置 mesh（构造第 4 参数） |
| `attachedNode` | `{ position: Vector3 }` | 光源位置跟随节点（推荐用 indicator） |
| `useCustomMeshPosition` + `customMeshPosition` | `boolean` + `Vector3` | 手动指定光源位置（备选） |
| `exposure` | `number` | 整体强度 |
| `decay` | `0~1` | 每采样的衰减 |
| `density` | `number` | 采样密度 |
| `weight` | `number` | 每采样权重 |
| `invert` | `boolean` | 反向散射（聚光灯从光源向外） |
| `useDiffuseColor` | `boolean` | 用 mesh 的 diffuse color 做光色 |
| `excludedMeshes` / `includedMeshes` | `AbstractMesh[]` | 网格过滤 |

**一个 PostProcess 绑定一个光源位置**，多舞台灯需要各自一个实例。

## 决策

### 决策一：StageLightState 扩展 4 字段

在 [lighting.ts](../../frontend/src/scene/render/lighting.ts) `StageLightState` 接口扩展：

```typescript
export interface StageLightState {
    // ... 现有字段
    // 体积光（VolumetricLightScatteringPostProcess）
    volumetricEnabled: boolean;
    volumetricExposure: number;   // 0-1, default 0.3
    volumetricDecay: number;      // 0-1, default 0.9
    volumetricDensity: number;    // 0-1, default 0.5
}
```

**默认值：** `_defaultStageLightState` 中 `volumetricEnabled: false`（默认关闭，按需开启）。

### 决策二：生命周期复用阴影模式

参考 `_ensureStageShadow` / `_disposeStageShadow` 的配对模式，新增：

```typescript
const _stageVolumetrics = new Map<string, VolumetricLightScatteringPostProcess>();

function _ensureStageVolumetric(id: string): void {
    // 1. dispose 旧的（参数变化或关闭时）
    // 2. state.volumetricEnabled 且 state.enabled 时创建
    // 3. attachedNode = entry.indicator（复用位置指示球）
    // 4. camera = renderer 暴露的 _pipelineCamera
}

function _disposeStageVolumetric(id: string): void {
    // camera.detachPostProcess + dispose + map.delete
}
```

**生命周期触发点：**
- `setStageLightState`：检查 `volumetricEnabled / volumetricExposure / volumetricDecay / volumetricDensity` 字段变化 → `_ensureStageVolumetric`
- `addStageLight` / `loadStageLights` / `removeStageLight`：与阴影同步管理
- `disposeLighting`：统一释放
- 相机切换：通过 `renderer.reattachPipeline()` 新增广播钩子（见决策四）

### 决策三：光源位置同步

体积光的光源位置**必须跟随灯光移动**。方案：

| 方式 | 说明 | 选择 |
|------|------|------|
| `attachedNode = entry.indicator` | indicator.position 已在 `_updateIndicator` 中与 `light.position` 同步 | ✅ **推荐** |
| `useCustomMeshPosition = true` | 每帧手动 `setCustomMeshPosition(light.position)` | 备选（indicator 不存在时） |

**注意：** indicator 在 `state.enabled = false` 时被 `setEnabled(false)`，但 position 仍正确。体积光开启时强制保留 indicator。

### 决策四：相机切换同步

`renderer.reattachPipeline()` 已处理 SSR/SSAO 重建。体积光同样需要：

```typescript
// renderer.ts 内新增
export function reattachVolumetricLights(cam: Camera): void {
    // 由 lighting.ts 注册回调，或 lighting.ts 导出 getActiveStageLightIds()
}
```

**简化方案：** 在 `reattachPipeline` 末尾调用 `lighting.reattachStageVolumetrics()`，由 lighting 模块自行 dispose + 重建所有活跃的体积光 PostProcess。

### 决策五：性能限制

**最多 N 盏灯同时启用体积光**（建议 N=2）：
- 单个 VolumetricLightScatteringPostProcess 在 100 samples 下约 2-3% FPS
- 多灯叠加开销线性增长
- 超过限制时：UI 显示警告 + 拒绝开启第 N+1 盏

实现：`_ensureStageVolumetric` 入口检查 `_stageVolumetrics.size >= MAX_VOLUMETRIC_LIGHTS`。

### 决策六：UI 接入

在 [scene-stage-lights.ts](../../frontend/src/menus/scene-stage-lights.ts) 卡片 3（基础参数）下方新增**卡片 3.5：体积光**：

```typescript
// 卡片 3.5：体积光（条件：有选中灯光）
{
    id: 'light:volumetric',
    kind: 'custom',
    visibleWhen: () => !!state,
    renderCustom: (c) => {
        cardContainer(c, (inner) => {
            addCollapsible(inner, {
                title: t('scene.volumetric'),  // 新增 i18n key
                icon: 'lucide:sun-medium',
                defaultOpen: false,
                headerToggle: {
                    value: state.volumetricEnabled,
                    onChange: (v) => setStageLightState({ volumetricEnabled: v }, state.id),
                    bind: () => /* ... */,
                },
                renderContent: (ci) => {
                    addSliderRow(ci, t('scene.exposure'), state.volumetricExposure, 0, 1, 0.05, ...);
                    addSliderRow(ci, t('scene.decay'), state.volumetricDecay, 0, 1, 0.05, ...);
                    addSliderRow(ci, t('scene.density'), state.volumetricDensity, 0, 1, 0.05, ...);
                },
            });
        });
    },
}
```

**i18n key 清单（5 语言）：**
- `scene.volumetric` — 体积光 / Volumetric Light / ボリュームライト / 볼륨 라이트 / 体积光
- `scene.exposure` — 曝光 / Exposure / 明るさ / 노출 / 曝光
- `scene.decay` — 衰减 / Decay / 減衰 / 감쇠 / 衰减
- `scene.density` — 密度 / Density / 密度 / 밀도 / 密度

### 决策七：序列化兼容

`loadStageLights` 已通过 `...s` 浅拷贝整个 state，新字段自动跟随。**旧存档兼容**：
- 反序列化旧 JSON 时 `volumetricEnabled` 为 `undefined`
- `_readStageLightState` 入口补默认值：`volumetricEnabled: state.volumetricEnabled ?? false`

## 与反射系统的关系

| 维度 | 反射系统（ADR-151） | 体积光（本 ADR） |
|------|-------------------|-----------------|
| 操作对象 | 材质的 `reflectionTexture` 槽位 | 屏幕后处理 PostProcess |
| 模式数量 | 5 种（none/probe/ssr/planar/hybrid） | 1 种（单 PostProcess） |
| 参数空间 | 多子系统各自参数 | 4 个参数（enabled/exposure/decay/density） |
| 生命周期入口 | `applyReflection(state)` | `setStageLightState(s, id)` 内联 |
| 相机挂接 | 通过 `_pipelineCamera` | 通过 `_pipelineCamera`（一致） |

**互不冲突**：反射改变物体着色（材质层），体积光改变屏幕像素（后处理层）。两者可同时启用。

## 实施清单

### 代码改动

| 文件 | 改动 |
|------|------|
| [lighting.ts](../../frontend/src/scene/render/lighting.ts) | 扩展 `StageLightState` 4 字段；新增 `_stageVolumetrics` Map + `_ensureStageVolumetric` / `_disposeStageVolumetric`；`setStageLightState` 增加体积光字段检查；`disposeLighting` 清理；新增 `reattachStageVolumetrics` 导出 |
| [renderer.ts](../../frontend/src/scene/render/renderer.ts) | `reattachPipeline` 末尾调用 `reattachStageVolumetrics` |
| [scene.ts](../../frontend/src/scene/scene.ts) | barrel re-export `reattachStageVolumetrics` |
| [scene-stage-lights.ts](../../frontend/src/menus/scene-stage-lights.ts) | 卡片 3.5 新增体积光面板 |
| [i18n/locales/*.ts](../../frontend/src/core/i18n/locales/) | 5 语言新增 4 个 key |

### 测试

| 测试 | 类型 | 目标 |
|------|------|------|
| `stage-light-volumetric.test.ts` | 单元 | `_ensureStageVolumetric` 在不同参数下的创建/销毁路径 |
| `stage-light-volumetric.contract.test.ts` | 契约 | `StageLightState` 4 字段存在性 + 默认值 |
| 现有 `lighting.test.ts` | 回归 | 确保未引入破坏 |

### 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 多灯叠加性能下降 | 🟡 中 | MAX_VOLUMETRIC_LIGHTS=2 限制 |
| 相机切换后 PostProcess 丢失 | 🟠 高 | `reattachStageVolumetrics` 在 `reattachPipeline` 末尾调用 |
| indicator 被外部清理导致 attachedNode 失效 | 🟢 低 | `_updateIndicator` 已有 material 重建逻辑，体积光复用相同防御 |
| 旧存档反序列化缺字段 | 🟢 低 | `_readStageLightState` 用 `??` 补默认值 |
| 与 Bloom 叠加过亮 | 🟡 中 | 参考 GlowLayer 的 `bloomW > 0.5` 自动降低逻辑，可后续追加 |

## 未实现部分（后续 ADR 处理）

- **光柱几何形状约束**：当前 PostProcess 是全屏放射状散射，无法限制在 SpotLight 锥角内。若需精确锥形光柱，需自定义 ShaderMaterial（后续 ADR）
- **方向光太阳神光**：本 ADR 只覆盖舞台灯。方向光（dirLight）的太阳神光若需要，可复用相同 PostProcess 挂到 `_sunDisc`（已有）
