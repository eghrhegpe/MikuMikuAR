# ADR-074: 动态 Cubemap RT 球面反射

> **状态**: ✅ 已实施（2026-07-09，Step 1-4 完成；Step 5 测试待补）
> **关联**: ADR-062（水面反射 RT 系统·P3 路线）、ADR-024（ReflectionProbe 环境反射）、ADR-026（环境系统增强）
> **前置**: ADR-062 P1（planar RT）已落地，P2（波浪 UV 偏移 + 泡沫衰减）待实施

---

## 一、背景

### 1.1 现状

ADR-062 P1 已落地 planar RT 反射系统（`env-water.ts`），水面可反射场景几何体（PMX 模型等）。但存在两类反射盲区：

| 反射场景 | 当前方案 | 问题 |
|----------|---------|------|
| 金属球/柱/曲面 | `ReflectionProbe` 静态 cubemap（`refreshRate=0`） | 仅反射环境（天空/地面），**不含模型本体**；模型移动/灯光变化后反射不更新 |
| 水面 planar RT | 2D RT + mirror camera | 仅适用于**平面**，曲面物体采样 2D 纹理会变形拉伸 |

### 1.2 目标

引入**动态 cubemap RT**，为金属/曲面物体提供实时环境反射（含模型本体），同时保持与现有 planar RT 和静态 ReflectionProbe 的共存。

### 1.3 与现有系统的关系

```
ReflectionProbe（renderer.ts）     → 静态 cubemap，仅环境（天空/地面），refreshRate=0
Planar RT（env-water.ts）          → 2D RT，水面平面反射，refreshRate=按需
Cubemap RT（P3 新增，本 ADR）      → 动态 cubemap，金属/曲面物体反射，refreshRate=可调
```

三者独立生命周期，不共享状态。水面仍用 planar RT（平面场景 planar 更准确），cubemap RT 服务于非平面材质。

---

## 二、技术方案

### 2.1 核心思路：Babylon ReflectionProbe 动态化

复用 Babylon.js `ReflectionProbe` 类（已封装 cubemap 6-face 渲染），通过调整 `refreshRate` 实现动态刷新：

```typescript
// 现有静态模式（renderer.ts）
_probe = new ReflectionProbe('envProbe', 256, scene);
_probe.refreshRate = 0;  // 仅渲染一次

// P3 动态模式
_probe.refreshRate = 1;  // 每帧刷新（高画质）
_probe.refreshRate = 2;  // 每 2 帧刷新（中画质）
_probe.refreshRate = 4;  // 每 4 帧刷新（低画质）
```

**选择路径 B（ReflectionProbe 动态化）而非路径 A（手写 6-face RT）的理由**：

1. `ReflectionProbe` 已在 renderer.ts 中验证可用，动态化是参数调整
2. Babylon 内部处理 6-face 渲染 + cubemap 合成 + seam 修复，手写需重做这些
3. 手写 6-face 的收益仅在极端优化场景（如"仅更新水平 4 面"），初期不值得

### 2.2 与现有 ReflectionProbe 的区分

现有 `_reflectionProbe`（renderer.ts）是**环境探针**，服务于所有模型的材质反射。P3 新增的是**场景探针**，额外包含模型本体。

| 维度 | 环境探针（现有） | 场景探针（P3 新增） |
|------|----------------|-------------------|
| renderList | sky / env / ground / water | + 模型 meshes |
| refreshRate | 0（静态） | 1-4（动态） |
| 绑定目标 | 所有 StandardMaterial | 含 sphere map / PBR metallic 的材质 |
| 显存 | 256³ × 4B = 1MB | 256³ × 4B = 1MB（共用或独立） |

**决策：扩展现有 `_reflectionProbe`，不新建第二个 probe**。

理由：
- 同一场景不需要两套 cubemap（环境探针和场景探针内容高度重叠）
- 将 renderList 从"仅环境"扩展为"环境 + 模型"，按需切换 refreshRate
- 减少显存占用（复用同一 cubemap RT）

### 2.3 动态刷新策略

```typescript
// renderer.ts 扩展
interface CubemapRefreshPolicy {
    mode: 'static' | 'dynamic';
    refreshRate: number;    // 1=每帧, 2=每2帧, 4=每4帧
    resolution: number;     // 单面分辨率: 64/128/256
}

let _cubemapPolicy: CubemapRefreshPolicy = {
    mode: 'static',
    refreshRate: 0,
    resolution: 256,
};
```

**触发规则**：
- 静态模式（`mode=static`）：`refreshRate=0`，仅初始化时渲染一次（当前行为）
- 动态模式（`mode=dynamic`）：`refreshRate=N`，每 N 帧刷新 cubemap
- 交互时升频：用户旋转/移动相机或模型时临时 `refreshRate=1`，静止后降回 `refreshRate=4`

### 2.4 renderList 扩展

现有 renderList 过滤规则：

```typescript
// 当前：仅环境
_probe.renderList = scene.meshes.filter(m =>
    m.name.includes('sky') || m.name.includes('env') ||
    m.name.includes('ground') || m.name.includes('water')
);
```

P3 扩展为包含模型：

```typescript
// P3：环境 + 模型
_probe.renderList = scene.meshes.filter(m =>
    m.isVisible && !m.name.startsWith('envWater')  // 排除水面自身
);
```

**注意**：模型 meshes 加入 renderList 后，每次 cubemap 刷新需额外渲染所有模型，GPU 负载随模型数量线性增长。需配合性能分级控制。

---

## 三、性能分级

### 3.1 Cubemap 专属分级

| 模式 | 单面分辨率 | 刷新率 | 显存（6面） | GPU 负载 | 适用场景 |
|------|-----------|--------|------------|---------|---------|
| 高 | 256×256 | 每帧 | 6MB | 6× 场景渲染 | 桌面端近景 + 多金属物体 |
| 中 | 128×128 | 每 2 帧 | 1.5MB | 3× 场景渲染 | 桌面端远景 / 中端设备 |
| 低 | 64×64 | 每 4 帧 | 0.375MB | 1.5× 场景渲染 | 移动端 / Android |
| 关 | — | — | 0 | 0 | 性能模式 / 无金属物体 |

### 3.2 与 Planar RT 分级的协调

水面 planar RT 和 cubemap RT 独立分级，互不干扰：

| 设备 | Planar RT（水面） | Cubemap RT（金属） | 总额外显存 |
|------|------------------|-------------------|-----------|
| 高端桌面 | 512×512 每帧 | 256×256 每帧 | 5MB |
| 中端桌面 | 256×256 每 2 帧 | 128×128 每 2 帧 | 1.5MB |
| 移动端 | 128×128 每 4 帧 | 64×64 每 4 帧 | 0.5MB |

---

## 四、材质绑定策略

### 4.1 自动检测

模型加载时检测材质属性，决定是否绑定 cubemap RT：

```typescript
function _needsCubemapReflection(mat: Material): boolean {
    if (!(mat instanceof StandardMaterial)) return false;
    // 含 sphere map 的材质已有球面反射，cubemap 可增强
    if ((mat as MmdStandardMaterial).sphereTexture) return true;
    // PBR 材质的 metallic 通道需要环境反射
    if ('metallic' in mat && (mat as any).metallic > 0.3) return true;
    // 用户显式设置了 reflectionTexture 的材质
    if (mat.reflectionTexture) return true;
    return false;
}
```

### 4.2 与现有绑定逻辑的整合

复用 `bindReflectionProbeToModel`（renderer.ts:819），扩展过滤规则：

```typescript
export function bindReflectionProbeToModel(meshes: Mesh[]): void {
    if (!_reflectionProbe) return;
    const rt = _reflectionProbe.cubeTexture;
    for (const mesh of meshes) {
        const m = mesh.material;
        if (m && _needsCubemapReflection(m)) {
            (m as any).reflectionTexture = rt;
        }
    }
}
```

### 4.3 与 Planar RT 的不冲突

| 材质类型 | 反射源 | 说明 |
|----------|--------|------|
| 水面 ShaderMaterial | planar RT（2D sampler） | env-water.ts 独立管理 |
| 模型 StandardMaterial（含 sphere/PBR） | cubemap RT（CubeTexture） | renderer.ts 管理 |
| 模型 StandardMaterial（无反射需求） | 无 | 不绑定 |

两者采样不同纹理类型（2D vs Cube），shader 路径独立，无冲突。

---

## 五、实施计划

### Step 1：POC 验证（0.5 天）

- 将现有 `_reflectionProbe.refreshRate` 从 0 改为 1（动态模式）
- 绑定到测试场景中的金属球材质
- 验证项：
  - 模型移动时 cubemap 是否实时更新
  - 帧率影响（baseline vs 动态 cubemap）
  - cubemap seam 是否可见
  - 显存占用变化

### Step 2：CubemapRefreshPolicy 模块（1-2 天）

- 在 `renderer.ts` 中新增 `CubemapRefreshPolicy` 接口和管理逻辑
- 实现 `setCubemapMode(mode, refreshRate, resolution)` API
- 扩展 renderList 过滤规则（环境 + 模型）
- 确保 dispose 路径完整（关闭动态模式时恢复 `refreshRate=0`）

### Step 3：材质自动绑定（1 天）

- 实现 `_needsCubemapReflection` 检测函数
- 扩展 `bindReflectionProbeToModel` 逻辑
- 模型加载/卸载时自动更新 cubemap renderList
- 确保与 planar RT 无冲突

### Step 4：性能分级 + UI（0.5 天）

- 在 `scene-render-levels.ts` 或 `settings-performance.ts` 增加 cubemap 分级选项
- 与现有 `reflectionProbeEnabled` 整合（复用开关，新增子选项）
- 移动端默认低档或关闭
- 交互时自动升频逻辑（可选，Phase 2）

### Step 5：测试 + 收尾（0.5 天）

- 补充单元测试（refreshRate 切换、dispose、分辨率变更、renderList 更新）
- 更新 ADR-062 状态，标记 P3 已实施
- 全平台验证（桌面 + Android）

---

## 六、风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 动态 cubemap 帧率暴跌 | 高 | 默认 `refreshRate=2`（每 2 帧），仅交互时升为 1；复杂场景（10+ 模型）强制 `refreshRate=4` |
| 6 面 RT 显存溢出（Android） | 中 | 移动端默认 64×64 或关闭；总显存预算硬限 2MB |
| ReflectionProbe 内部不支持动态 | 中 | POC 先验证；若不行，退回路径 A 手写 6-face RT |
| 模型加入 renderList 后 cubemap 刷新变慢 | 中 | renderList 按距离裁剪（仅渲染摄像机 50 单位内的模型） |
| cubemap seam（面交界处接缝） | 低 | Babylon ReflectionProbe 内部已处理；POC 目测验证 |
| 与 planar RT 双 RT 系统协调 | 低 | 两者独立生命周期，不共享状态 |

---

## 七、决策对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. 手写 6-face RT** | 创建 6 张 RT + 6 个方向相机 + 手动合成 CubeTexture | 完全可控，可按面单独优化 | 实现量大（~200 行），需处理 seam/翻转 |
| **B. ReflectionProbe 动态化（本 ADR）** | 复用 Babylon ReflectionProbe，改 refreshRate | 实现量小（~50 行），Babylon 内部处理 6-face | 控制粒度低，refreshRate=1 性能代价高 |
| **C. 暂不实施** | 保持静态 cubemap，金属物体反射不更新 | 零成本 | 金属/曲面物体反射静态，视觉缺陷 |

**选 B**。理由：P3 的核心诉求是"金属物体反射随场景更新"，ReflectionProbe 动态化以最小实现量满足需求。手写 6-face 留作后续优化路径（当需要面级控制时从 B 渐进到 A）。

---

## 八、与现有 ADR 的关系

- **ADR-062 P1**（planar RT）：已落地，P3 不改动。水面仍用 planar RT。
- **ADR-062 P3**（本 ADR）：细化 cubemap RT 方案，填补 ADR-062 遗留的"球面反射"缺口。
- **ADR-024**（ReflectionProbe）：现有静态探针扩展为动态，renderList 从"仅环境"扩展为"环境 + 模型"。
- **ADR-055**（AR 相机模式）：AR 模式下 cubemap RT 可增强虚拟物体与真实环境的融合感（反射真实环境），但非 P3 范围。

---

## 九、验证方式

1. **POC**：empty scene + 金属球 + 动态模型，旋转相机确认 cubemap 实时更新且无 seam
2. **帧率**：对比 baseline / 中档 / 低档的 FPS 差异，确认移动端可接受
3. **显存**：监控 `gl.getParameter(gl.RENDERBUFFER_WIDTH)` 或 Babylon `engine._gl.getExtension('WEBGL_lose_context')` 确认 RT 显存不超预算
4. **回归**：`npm run check && npm run test && npm run build` 全绿
