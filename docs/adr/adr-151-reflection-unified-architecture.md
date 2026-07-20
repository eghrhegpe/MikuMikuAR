# ADR-151: 反射系统统一架构（Reflection Unification）

- **状态**: 🔄 规划
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

export type ReflectionMode = 'probe' | 'ssr' | 'planar' | 'hybrid' | 'none';

export function applyReflection(state: EnvState): void {
    const mode = resolveReflectionMode(state);
    switch (mode) {
        case 'none':
            disableAllReflection();
            break;
        case 'probe':
            enableProbeReflection(state);
            break;
        case 'ssr':
            enableSSRReflection(state);
            break;
        case 'planar':
            enablePlanarReflection(state);
            break;
        case 'hybrid':
            enableHybridReflection(state);
            break;
    }
}
```

`resolveReflectionMode` 根据 `state.reflectionQuality` + `state.ssrEnabled` + `state.reflectionProbeEnabled` 等字段推导出最终模式。

### 决策二：模式定义与行为

| 模式 | 激活子系统 | 适用场景 | 相对性能 |
|------|-----------|---------|---------|
| `none` | 全关 | 最低画质 / AR 模式 / 低端设备 | 0 |
| `probe` | 仅 ReflectionProbe | 静态展示，模型不需要反射动态效果 | 低 |
| `ssr` | 仅 SSR（关闭 Probe） | 需要动态反射细节，地面/水面另由 PlanarReflection 负责 | 中 |
| `planar` | 仅 PlanarReflection（地面/水面互斥） | 需要地面/水面反射，模型自身不需要额外反射 | 低-中 |
| `hybrid` | SSR + Probe（分层混合） | 最高画质，Probe 提供环境底色，SSR 提供动态细节 | 高 |

**`hybrid` 模式的分层规则**：

1. ReflectionProbe 绑定 `reflectionTexture`，强度设为 `state.reflectionIntensity * 0.5`（减半避免与 SSR 叠加过亮）
2. SSR 独立渲染，强度设为 `state.ssrStrength`
3. SSR 的 Bloom 互斥仍然保留（现有逻辑）
4. `planarReflectBlend` 与混合模式无关，水面/地面单独控制

### 决策三：`reflectionTexture` 所有权声明

引入 `_reflectionTextureOwner` 模块级变量，记录当前 `reflectionTexture` 被哪个子系统占用：

```typescript
type ReflectionTextureOwner = 'probe' | 'material' | 'ground' | 'none';

let _textureOwner: ReflectionTextureOwner = 'none';
let _savedReflectionTextures: Map<number, Texture | null> = new Map();
```

- `probe` 模式：Probe 写入前先保存材质当前 `reflectionTexture`，退出时恢复
- `material` 模式（hybrid）：Probe 写入但强度减半，允许材质的固有 `reflectionTexture` 在 SSR 中透出
- 所有权变更时自动做 save/restore

### 决策四：质量层级联动

引入反射质量等级枚举，统一联动三个子系统：

```
reflectionQuality: 'off' | 'low' | 'medium' | 'high' | 'ultra'
```

| 等级 | 推导出的模式 | SSR 参数 | Probe | PlanarReflection |
|------|------------|---------|-------|-----------------|
| `off` | `none` | — | 关 | 关 |
| `low` | `probe` | — | 256px, strength=0.3 | 关 |
| `medium` | `probe` | — | 256px, strength=0.5 | low (每 4 帧) |
| `high` | `hybrid` | step=16, strength=0.7 | 256px, strength=0.3 | medium (每 2 帧) |
| `ultra` | `hybrid` | step=32, strength=1.0 | 256px, strength=0.5 | high (每帧) |

此映射作为 `applyReflection` 的第一道推导，用户再通过独立滑块微调 SSR/Probe 的具体强度。

### 决策五：资源迁移

#### 5.1 ReflectionProbe 逻辑从 `renderer.ts` 迁出

`renderer.ts:485-545` 的 ReflectionProbe 创建/绑定/销毁逻辑移入 `env-reflection.ts`。

迁移后 `_applyRenderState` 的 `reflectionProbeEnabled` / `reflectionIntensity` 处理简化为：

```typescript
// renderer.ts — 改造后
// 不再内联处理 ReflectionProbe，仅由 env-reflection.ts 的 applyReflection 统一管理
if (s.reflectionProbeEnabled !== undefined || s.ssrEnabled !== undefined) {
    applyReflection(envState);  // 触发统一入口
}
```

#### 5.2 SSR 保持管线独立，控制权移交

SSR 的 `SSRRenderingPipeline` 对象仍然在 `renderer.ts` 中维护（因为它本质是渲染管线资源），但创建/销毁/参数更新由 `env-reflection.ts` 通过调节 `ssrEnabled` / `ssrStrength` 等状态触发。

#### 5.3 PlanarReflection 保持独立，集成观测

`planar-reflection.ts` 的 `PlanarReflection` 类不动，`env-ground.ts` 和 `env-water.ts` 在其各自的 `update()` 中照常调用。但在 `applyReflection` 的 `planar` / `none` 模式下，外部强制将 `state.reflectionQuality` 置为 `off`，使得 PlanarReflection 内部 `shouldEnable` 判断为 false 后自行释放。

---

## 实施计划

### Phase 1：新建 `env-reflection.ts` + 模式推导（1-2 天）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 1.1 | 新建 `env-reflection.ts`，实现 `resolveReflectionMode` 和 `applyReflection` 骨架 | 函数定义 + 类型定义 |
| 1.2 | 实现 `none` / `probe` / `ssr` 三个模式的内部分支 | 现有 ReflectionProbe 逻辑迁入 + 分支测试 |
| 1.3 | 在 `env-impl.ts` 的变更观测中添加 `reflectionQuality` / `ssrEnabled` / `reflectionProbeEnabled` 的 key 列表 | 反射变更自动触发 `applyReflection` |

### Phase 2：`reflectionTexture` 所有权管理（1 天）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 2.1 | 实现 `_reflectionTextureOwner` save/restore 机制 | 所有权管理函数 |
| 2.2 | 验证 Probe 关闭后模型材质 `reflectionTexture` 恢复为 null | 单测 |

### Phase 3：质量层级联动（1 天）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 3.1 | 实现 `qualityToMode` 映射表 | `reflectionQuality` → `ReflectionMode` 推导 |
| 3.2 | 实现 `qualityToSSRParams` / `qualityToProbeParams` | 各等级参数预设 |
| 3.3 | 注册 `reflectionQuality` 到 uiState schema（如果尚未注册） | 状态字段 |

### Phase 4：`hybrid` 模式 + 清理工作（1 天）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 4.1 | 实现 hybrid 模式：SSR + Probe 分层混合 | 混合模式分支 |
| 4.2 | 清理 `renderer.ts` 中迁出的 ReflectionProbe 代码 | 简化后的 `_applyRenderState` |
| 4.3 | 集成测试：所有模式切换 + 过渡动画兼容 | 通过测试 |

---

## 未解决的问题

1. **`reflectionQuality` vs 现有字段的兼容**：当前 `env-state-schema.ts` 中地面已使用 `reflectionQuality`（`'off'|'low'|'medium'|'high'`），但 SSR 和 Probe 各自用独立的 `ssrEnabled` / `reflectionProbeEnabled`。Phase 1 选择 **保留独立开关**，`reflectionQuality` 作为**推荐高位预设**，独立开关作为**手动微调**。未来可考虑 UI 面板上隐藏独立开关，仅暴露 unified `reflectionQuality` 滑块。

2. **`ultra` 等级是否需要 512px Probe**：当前 ReflectionProbe 固定 256px，`ultra` 等级可考虑提升至 512px，需评估显存开销。暂定为可选优化，不纳入 Phase 1-4。

3. **过渡动画兼容**：当前 `transitionRenderState`（`renderer.ts:849-1002`）仅处理数值字段的线性插值。如果 `applyReflection` 导致模式切换（如 `probe` → `ssr`），需要处理资源重建的过渡。Phase 3 开始处理。

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| ReflectionProbe 迁出 `renderer.ts` 后 SSR 与 Probe 间同步时序被打乱 | P2 | 统一入口 `applyReflection` 保证两者状态在同一函数调用中完成同步 |
| `planar` 模式下强制 `reflectionQuality=off` 覆盖了用户的水面/地面反射设置 | P2 | 仅当 `mode === 'planar'` 时覆盖地面质量；其他模式地面质量由用户设置独立控制 |
| 现有 UI 面板直接操作 `ssrEnabled` / `reflectionProbeEnabled`，Phase 1 新增模式推导后可能冲突 | P3 | `applyReflection` 的 `resolveReflectionMode` 优先读取模式推导，但保留独立开关作为 override：独立开关显式设置时覆盖推导结果 |
