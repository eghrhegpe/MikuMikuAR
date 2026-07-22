# ADR-152: 舞台灯光光锥（Light Cone）

- **状态**: ✅ 已实施（v2 — 真实光锥网格）
- **日期**: 2026-07-20
- **相关**: ADR-151（反射统一架构，参考生命周期模式）

> **命名说明（Rev 2 修订）**：本 ADR 早期以「体积光散射（Volumetric Light Scattering）」命名，但该表述不准确——当前实现为**发光锥体可视化**（additive 双面锥 + Fresnel 边缘辉光），并非物理意义的参与介质散射（无遮挡、无光线步进）。v1 采用的 Babylon 内置 `VolumetricLightScatteringPostProcess` 同为屏幕空间假散射。故更名为「**光锥 / Light Cone**」，与 UI（`scene.lightCone`）及代码（`cone*` 字段）统一。如需真正的体积散射（光柱被人物/道具切断），见末节「深度/ShadowMap 遮挡增强」。

---

## 背景与问题

用户反馈：“开了反射就看不见聚光灯了。”

当前 [lighting.ts](../../frontend/src/scene/render/lighting.ts) 中的舞台聚光灯/点光源/方向光都是 Babylon.js 的**数学光照**——只对受光物体的着色产生影响，本身在屏幕上不可见。需求：在聚光灯上附加**可见光柱**效果（丁达尔效应），且与反射系统共存不冲突。

## 方案演进

### v1（已废弃）：VolumetricLightScatteringPostProcess

初版采用 Babylon.js 内置的屏幕空间径向模糊后处理。废弃原因：
- **不是真正的光锥**：全屏放射状散射，不感知 SpotLight 锥角，视觉上无法表达灯光方向与范围
- **相机绑定**：每个 PostProcess 必须挂接相机，相机切换时需 dispose + 重建（`reattachStageVolumetrics`）
- **数量限制**：单个 PostProcess 约 2-3% FPS，最多 2 盏

### v2（当前）：真实光锥 Mesh + ShaderMaterial

用锥体网格 + 自定义 Shader 替代后处理，实现真正的锥形光柱。

| 维度 | v1 (PostProcess) | v2 (光锥 Mesh) |
|------|------------------|------------------|
| 视觉形状 | 全屏放射状散射 | 真实锥形光柱，跟随 SpotLight 锥角 |
| 相机依赖 | 需挂接相机，切换时重建 | 无（普通 Mesh，相机无关） |
| 数量限制 | MAX=2（性能） | 无限制（单锥 ~200 顶点，开销忽略） |
| 性能 | 2-3% FPS/盏 | <0.1% FPS/盏 |
| 实现复杂度 | ⭐⭐ | ⭐⭐ |

## 决策

### 决策一：StageLightState 扩展 4 字段

在 [lighting.ts](../../frontend/src/scene/render/lighting.ts) `StageLightState` 接口扩展：

```typescript
export interface StageLightState {
    // ... 现有字段
    // 真实光锥（锥形光柱可视化）
    coneEnabled: boolean;
    coneIntensity: number;   // 0-2, default 0.5
    coneLength: number;      // 1-50, default 30
    coneSoftness: number;    // 0-1, default 0.5
}
```

**默认值：** `_defaultStageLightState` 中 `coneEnabled: false`（默认关闭，按需开启）。

**旧存档迁移：** `volumetricEnabled → coneEnabled`、`volumetricExposure*0.5 → coneIntensity`、`1-volumetricDensity → coneSoftness`。迁移在 `loadStageLights`（加载时）和 `_readStageLightState`（读取时）双路径执行。

### 决策二：光锥模块独立

新建 [light-cone.ts](../../frontend/src/scene/render/light-cone.ts)，职责单一：

| API | 职责 |
|-----|------|
| `createLightCone(scene, light, color, intensity, coneLength, softness)` | 创建锥体 Mesh + ShaderMaterial |
| `updateLightConeTransform(entry, light, coneLength)` | 同步位置/朝向 |
| `updateLightConeUniforms(entry, color, intensity, softness, coneLength)` | 更新 shader 参数 |
| `rebuildLightConeGeometry(entry, scene, light, coneLength)` | 锥长/锥角变化时重建几何 |
| `setLightConeEnabled(entry, enabled)` | 可见性开关 |
| `disposeLightCone(entry)` | 释放 Mesh + Material |

### 决策三：Shader 设计

```glsl
// Fragment Shader 核心逻辑
float t = clamp(dist / u_coneLength, 0.0, 1.0);  // 归一化距离
float distFade = pow(1.0 - t, 1.5);               // 距离衰减
float fresnel = pow(1.0 - NdotV, 1.0 + u_softness * 2.0);  // 边缘辉光
float alpha = u_intensity * distFade * (0.12 + 0.88 * fresnel);
gl_FragColor = vec4(u_color * alpha, alpha);       // Additive blending
```

材质设置：`ALPHA_ADD` + 双面渲染 + 不写深度。

### 决策四：生命周期复用阴影模式

参考 `_ensureStageShadow` / `_disposeStageShadow` 的配对模式（光锥 Map 实为 `lightingState.stageCones`，定义于 `lighting-state.ts`）：

```typescript
function _ensureStageCone(id: string): void {
    // 1. 关闭或非 SpotLight → _disposeStageCone
    // 2. 已存在 → rebuildLightConeGeometry + updateLightConeTransform + updateLightConeUniforms
    // 3. 不存在 → createLightCone 并写入 lightingState.stageCones
}

function _disposeStageCone(id: string): void {
    // disposeLightCone + lightingState.stageCones.delete
}
```

**生命周期触发点：**
- `setStageLightState`：每次调用经 `_ensureStageCone(id)` 按需创建/更新/释放（含 cone* 字段变化）
- `addStageLight` / `loadStageLights` / `removeStageLight`：与阴影同步管理
- `disposeLighting`：统一释放
- **无需相机切换重建**（光锥是普通 Mesh，不依赖相机挂接）

### 决策五：每帧相机位置更新

光锥 Shader 的 Fresnel 计算需要相机位置。通过 `onBeforeRenderObservable` 每帧更新所有光锥的 `u_cameraPos` uniform：

```typescript
_coneUpdateHandle = observe(_scene.onBeforeRenderObservable, () => {
    const cam = _scene?.activeCamera;
    if (!cam) return;
    for (const [, cone] of lightingState.stageCones) {
        cone.material.setVector3('u_cameraPos', cam.position);
    }
});
```

### 决策六：UI 接入

在 [scene-stage-lights.ts](../../frontend/src/menus/scene-stage-lights.ts) 卡片 3.5：光锥（仅聚光灯显示）：

```typescript
{
    id: 'light:cone',
    kind: 'custom',
    visibleWhen: () => !!state && state.type === 'spot',
    renderCustom: (c) => {
        // headerToggle: coneEnabled
        // 滑块: coneIntensity(0-2), coneLength(1-50), coneSoftness(0-1)
    },
}
```

**i18n key 清单（5 语言）：**
- `scene.cone` — 光锥 / Light Cone / ライトコーン / 라이트 콘 / 光锥
- `scene.coneIntensity` — 光锥亮度 / Cone Intensity / コーンの明るさ / 콘 밝기 / 光锥亮度
- `scene.coneLength` — 光锥长度 / Cone Length / コーンの長さ / 콘 길이 / 光锥长度
- `scene.coneSoftness` — 边缘柔和度 / Edge Softness / 边缘の柔らかさ / 가장자리 부드러움 / 边缘柔和度

### 决策七：序列化兼容

`loadStageLights` 加载时即执行 `volumetric* → cone*` 迁移，确保旧存档的 `volumetricEnabled: true` 能正确创建光锥。`_readStageLightState` 读取时同样补迁移（双路径防御）。

## 实施清单

### 代码改动

| 文件 | 改动 |
|------|------|
| [light-cone.ts](../../frontend/src/scene/render/light-cone.ts) | **新建**：锥体网格生成 + ShaderMaterial + 变换/更新/释放 API |
| [lighting.ts](../../frontend/src/scene/render/lighting.ts) | 扩展 `StageLightState` 4 字段；`setStageLightState` 增加光锥字段处理；`disposeLighting` 清理 `stageCones`；每帧 observer 更新 `u_cameraPos`（光锥 Map 实际存于 `lighting-state.ts` 的 `lightingState.stageCones`） |
| [renderer.ts](../../frontend/src/scene/render/renderer.ts) | 移除 `reattachStageVolumetrics` 导入和调用（光锥无需相机重绑定） |
| [scene-stage-lights.ts](../../frontend/src/menus/scene-stage-lights.ts) | 卡片 3.5 光锥面板（仅 spot 显示） |
| [i18n/locales/*.ts](../../frontend/src/core/i18n/locales/) | 5 语言新增 4 个 key |

### 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 旧存档反序列化缺字段 | 🟢 低 | `loadStageLights` + `_readStageLightState` 双路径迁移 |
| 与 Bloom 叠加过亮 | 🟡 中 | `coneIntensity` 默认 0.5，用户可调；后续可追加自动降低逻辑 |
| Additive blending 与透明物体排序 | 🟢 低 | `renderingGroupId = 1` + 不写深度 |

## 未实现部分（后续 ADR 处理）

- **方向光太阳神光**：本 ADR 只覆盖舞台灯。方向光（dirLight）的太阳神光若需要，可复用相同光锥方案（圆柱形光束）
- **噪声纹理模拟尘埃粒子**：当前 Shader 是均匀光柱，可追加 3D 噪声纹理模拟空气中的尘埃散射
- **深度/ShadowMap 遮挡增强**：当前光锥为均匀发光锥体，不感知场景几何，光柱会穿透人物/道具。可采样场景深度或 ShadowMap 在 shader 中衰减 `alpha`，实现真正的体积散射（光柱被不透明物切断）。此为「体积光散射」命名所指向的物理效果，当前未实现。

## 修订记录

- **Rev 2（2026-07-22）**：更名「体积光散射」→「光锥 / Light Cone」，消除与 UI（`scene.lightCone`）及代码（`cone*` 字段）的命名错位；修正 `coneLength` 默认值描述 20→30 与 `_defaultStageLightState` 对齐；订正生命周期描述（`_stageCones`/`_CONE_UPDATE_KEYS` 实为 `lightingState.stageCones` 与无条件 `_ensureStageCone` 触发）。明确当前实现为发光锥体可视化，非物理参与介质散射。
