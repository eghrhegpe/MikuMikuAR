# ADR-188: PBRMaterialBuilder 材质系统迁移 — PBR 渲染升级

> **状态**: Phase 1 完成（2026-08-01）
> **日期**: 2026-08-01
>
> 成果（commits fa27e54e → 1be90293）：
> - PMX 加载阶段 PBRMaterialBuilder 注册（VITE_MMD_MATERIAL=pbr）
> - 7 处 instanceof StandardMaterial 新增 PBRMaterial 分支 + PBR 参数映射
> - SSS 参数应用层 + 序列化（getMatSssState/applyMatSssState）
> - scene-serialize: materialSssCategories 字段 + 保存/恢复
> - model-preset: materialSssCategories 序列化/恢复（旧预设自动 fallback，零迁移成本）
> - PBR/SSS UI 面板（model-material.ts: metallic/roughness/sssPower/sssColor/sssDistance）
> - scene-serialize + model-manager: PBRMaterial wireframe 兼容
> - i18n: zh-CN/en/ja/ko/zh-TW 全部已补全，check 全绿
> - 全量 246 文件 / 4206 测试全绿
>
> 待推进：
> 1. ⏳ 实测验证（VITE_MMD_MATERIAL=pbr 构建 + 加载 PMX 模型 + 验证 SSS 效果）
> 2. ⏳ Phase 2: 旧预设批量迁移工具、性能基准测试

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-26

**来源**: `docs/research/babylon-mmd-api-analysis.md` §2.2 PBRMaterialBuilder / §五 P3 + 源码深度分析

**关联**: ADR-069（材质/贴图支持审计）、ADR-015（标量分类乘率模型）、ADR-112（SdefInjector）、ADR-098（描边渲染）

**影响面**: `frontend/src/scene/manager/material.ts`（全仓 StandardMaterial 假设）、`frontend/src/menus/model-material.ts`（UI 参数映射）、`frontend/src/scene/manager/model-loader.ts`（材质代理注册）、`frontend/src/menus/model-preset.ts`（预设序列化）

---

## 问题

当前项目使用 `MmdStandardMaterial`（继承 Babylon.js `StandardMaterial`）渲染 MMD 模型，基于 Lambert + Blinn-Phong 光照模型。babylon-mmd 提供 `PBRMaterialBuilder`（`Loader/pbrMaterialBuilder`），使用 Babylon.js 原生 `PBRMaterial`（Cook-Torrance PBR）渲染 MMD 模型，可获得更真实的金属/粗糙度材质表现。

**核心动机：**

| 维度 | StandardMaterial（当前） | PBRMaterial（目标） |
|------|--------------------------|--------------------|
| 光照模型 | Lambert + Blinn-Phong | Cook-Torrance PBR |
| 高光表现 | `specularColor` + `specularPower` | `reflectionColor` + `roughness` |
| 金属质感 | ❌ 不支持 | ✅ `metallic` 参数 |
| 环境反射 | 需自定义 cubemap | ✅ `environmentIntensity` + IBL |
| PBR 标准 | MMD 非标准 | ✅ glTF/PBR 行业标准 |
| 兼容生态 | MMD 专用 | ✅ babylon.js PBR 生态 |

---

## 决策

**列为 P1 长期规划，采用分阶段迁移策略（Phase 0→3），默认保留 `MmdStandardMaterialProxy`，通过环境变量 `VITE_MMD_MATERIAL=pbr` 切换。**

### 原因

| 项 | 风险等级 | 说明 |
|----|----------|------|
| 改造面 | 🔴 高 | 4 个核心文件、~1200 行代码、全仓 `instanceof StandardMaterial` 假设 |
| 视觉一致性 | 🟡 中 | PBR 与现有预设/Outfit/TOON 贴图的兼容性需验证 |
| 用户感知 | 🟠 中高 | UI 标签从"漫反射/高光"改为"金属度/粗糙度"，学习成本 |
| 收益 | ✅ 高 | PBR 渲染质量、跨生态兼容（glTF/babylon.js 工具链） |

### 选项

| 选项 | 结论 | 理由 |
|------|------|------|
| **A. 分阶段并行切换（推荐）** | **✅ 采用** | `VITE_MMD_MATERIAL` 环境变量控制，Phase 0→3 渐进验证 |
| B. 全量替换 | ❌ 否决 | 高风险，破坏性大，无法回退 |
| C. 不升级 | ❌ 否决 | 放弃 PBR 渲染质量和生态兼容性 |

---

## 改造面详细分析

### 1. 材质系统核心 — `material.ts`

**StandardMaterial 假设点清单：**

| 位置 | 行数 | 假设内容 | PBR 适配方案 |
|------|------|----------|-------------|
| `_capture()` | L388-L405 | `instanceof StandardMaterial` + `toonTexture`/`sphereTexture` | 新增 `PBRMaterial` 分支，捕获 `albedoColor`/`metallic`/`roughness` |
| `_applyParamsToMaterial()` | L120-L162 | `StandardMaterial` 参数映射（diffuse/specular/emissive 乘率） | 抽象为材质无关的参数应用层 |
| `_applyMaterial()` | L407-L433 | `instanceof StandardMaterial` + `MmdStandardMaterial` cast | 类型守卫分支 + PBR 参数映射 |
| `_applyCategory()` | L435-L466 | 同上 | 同上 |
| `getMatCatGroups()` | L524-L542 | `instanceof StandardMaterial` | 增加 `PBRMaterial` 分支 |
| `resetMatCatParams()` | L567-L605 | `instanceof StandardMaterial` + toon/sphere texture 访问 | PBR 无 toon/sphere 原生支持，需降级处理 |
| `getMatDetailList()` | L654-L678 | `instanceof StandardMaterial` | 同上 |
| `isMatCategoryAllEnabled()` | L740-L762 | `instanceof StandardMaterial` | 同上 |
| `setMatCategoryEnabled()` | L768-L802 | `instanceof StandardMaterial` | 同上 |

**关键发现：** 全仓共 **9 处** `instanceof StandardMaterial` 假设，全部需新增 PBR 分支。

### 2. UI 面板 — `model-material.ts`

**参数定义（L46-L98）：**

```typescript
const MAT_PARAM_DEFS = [
    { key: 'diffuseMul', ... },           // → PBR: albedo mul
    { key: 'specularMul', ... },          // → PBR: reflection mul
    { key: 'shininess', ... },            // → PBR: roughness (反比映射)
    { key: 'ambientMul', ... },           // → PBR: ambient mul
    { key: 'emissiveMul', ... },          // → PBR: emissive mul
    { key: 'diffuseTexLevel', ... },      // → PBR: albedoTexLevel
    { key: 'bumpTexLevel', ... },         // → PBR: bumpTexLevel (一致)
    { key: 'toonTexLevel', ... },         // ❌ PBR 无原生 toon 支持
    { key: 'sphereTexLevel', ... },       // ❌ PBR 无原生 sphere 支持
    { key: 'emissiveTexLevel', ... },     // → PBR: emissiveTexLevel (一致)
];
```

**适配方案：**

| 参数 | StandardMaterial 语义 | PBRMaterial 映射 | 处理方式 |
|------|----------------------|------------------|---------|
| `diffuseMul` | 漫反射乘率 | `albedoColor *= diffuseMul` | ✅ 直接映射 |
| `specularMul` | 高光乘率 | `reflectionColor *= specularMul` | ✅ 直接映射 |
| `shininess` | 光泽度（0-200） | `roughness = (200 - shininess) / 200` | ⚠️ 反比映射，需 UI 提示 |
| `ambientMul` | 环境光乘率 | `ambientColor *= ambientMul` | ✅ 直接映射 |
| `emissiveMul` | 自发光乘率 | `emissiveColor *= emissiveMul` | ✅ 直接映射 |
| `toonTexLevel` | Toon 渐变贴图强度 | ❌ PBR 不支持 | 🟡 静默忽略或显示"不适用" |
| `sphereTexLevel` | Sphere 环境映射强度 | ❌ PBR 不支持 | 🟡 同上 |

### 3. 预设系统 — `model-preset.ts` + `ModelPresetFile`

```typescript
interface ModelPresetFile {
    materialCategories?: Record<string, MaterialCategoryParams>;
    materialOverrides?: Record<number, MaterialCategoryParams>;
}
```

**影响：**

- `MaterialCategoryParams` 定义在 `material.ts:44-55`，包含 `toonTexLevel`/`sphereTexLevel` 等字段
- 预设序列化/反序列化需兼容旧格式（StandardMaterial 预设应用于 PBR 模型时）
- 新增 PBR 预设需独立命名空间（`pbrMaterialCategories`）或字段映射

**兼容方案：**

```typescript
// 旧预设加载时的兼容逻辑
function _resolveMaterialParams为标准 PBR 映射(params: MaterialCategoryParams, isPbr: boolean): MaterialCategoryParams {
    if (!isPbr) return params;
    // PBR 模式：忽略 toon/sphere，其余原样应用
    const { toonTexLevel, sphereTexLevel, ...rest } = params;
    return rest;
}
```

### 4. 模型加载器 — `model-loader.ts`

```typescript
// 当前（L8, L570）
import { MmdStandardMaterialProxy } from 'babylon-mmd/esm/Runtime/mmdStandardMaterialProxy';
wasmModel = _mmdRuntime.createMmdModel(rootMesh, {
    materialProxyConstructor: MmdStandardMaterialProxy,
});
```

**PBR 切换方案：**

```typescript
// 根据环境变量选择材质代理
if (usePbrMaterial) {
    import('babylon-mmd/esm/Loader/pbrMaterialBuilder')
        .then(({ PBRMaterialBuilder }) => {
            MmdRuntimeShared.MaterialProxyConstructor = PBRMaterialBuilder;
        });
} else {
    MmdRuntimeShared.MaterialProxyConstructor = MmdStandardMaterialProxy;
}
```

**注意：** `PBRMaterialBuilder` 需在 PMX 加载前注册（通过 `MmdRuntimeShared` 全局设置）。

### 5. PBR 与现有特效的兼容性

| 特效 | 当前实现 | PBR 兼容性 | 风险 |
|------|---------|-----------|------|
| **MmdOutlineRenderer（描边）** | ADR-098 已落地，side-effect import | ⚠️ 需验证 `PBRMaterial` 下的描边表现 | 🟡 中 |
| **SdefInjector（球面变形）** | ADR-112 已落地，改写 `engine.createEffect` | ✅ PBRMaterial 同样使用蒙皮着色器 | 🟢 低 |
| **SharedToonTextures** | ADR-187 已落地，base64 toon 纹理池 | ❌ PBR 无原生 toon 支持 | 🔴 高 |
| **Alpha 测试/混合** | `textureAlphaChecker` 着色器 | ✅ PBRMaterialBuilder 内建 alpha 评估 | 🟢 低 |
| **Bump 贴图** | `bumpTexture.level` 调参 | ✅ PBRMaterial 原生支持 `bumpTexture` | 🟢 低 |

---

## 技术根因：为什么 PBRMaterial 不支持 Toon/Sphere？

**核心问题**：`PBRMaterialBuilder.loadToonTexture()` 和 `loadSphereTexture()` 是空实现（L153-154），但这是**有意为之的设计限制**，而非遗漏实现。

### MMD 材质系统架构差异

#### MmdStandardMaterial — Shader 插件扩展

```
MmdStandardMaterial extends StandardMaterial
    │
    ├── Babylon.js 原生 StandardMaterial 着色器
    │
    └── babylon-mmd 自定义 Plugin Material（_pluginMaterial）
        ├── 注入 Toon 渐变采样逻辑
        ├── 注入 Sphere 环境反射映射逻辑
        └── 在顶点/片段着色器中插入额外纹理计算
```

`MmdStandardMaterial` 通过 Babylon.js 的 **plugin material 机制**，在标准 StandardMaterial 着色器中**动态注入**额外的 toon/sphere 纹理采样代码。这是一种 shader 级别的扩展，不改变 JavaScript API 签名。

关键代码（`mmdStandardMaterial.js`）：

```javascript
// MmdStandardMaterial 内部维护 _pluginMaterial 对象
private _pluginMaterial;

// 通过 _initPluginShaderSourceAsync() 改写着色器源码
_initPluginShaderSourceAsync() {
    // 在 StandardMaterial 的片段着色器中插入：
    // - toonGradient 采样逻辑
    // - sphereReflection 映射逻辑
    // - ambient/specular 额外混合计算
}
```

#### PBRMaterial — 无 plugin material 支持

Babylon.js 原生 `PBRMaterial` 的设计哲学是**纯 PBR 物理渲染**，不包含 MMD 特有的 toon/sphere 风格化渲染。babylon-mmd 也**未提供** PBR 版的 plugin material 扩展。

**根本原因：**

| 因素 | 说明 |
|------|------|
| **实现复杂度** | PBR 着色器管线与 toon/sphere 逻辑正交，需在 Cook-Torrance 方程中插入风格化采样，改造面大 |
| **生态定位** | PBR 面向真实感渲染，toon/sphere 面向动漫风格——两者视觉目标冲突 |
| **上游优先级** | babylon-mmd 维护者优先保障 WASM 性能和 PMX 兼容性，PBR 扩展未列入 roadmap |

**结论：** 迁移到 PBR 时，**toon/sphere 贴图效果确实会丢失**，这不是 bug 或可绕过的边界 case，而是 PBR 材质系统的设计取舍。

### 对现有功能的影响评估

| 功能 | StandardMaterial + MmdStandardMaterialProxy | PBRMaterial + PBRMaterialBuilder | 影响等级 |
|------|---------------------------------------------|----------------------------------|---------|
| **Toon 渐变阴影** | ✅ 通过 shader 插件实现 0-9 级渐变 | ❌ 空色域渲染，阴影硬边 | 🟡 中（影响动漫风格表现力） |
| **Sphere 环境映射** | ✅ 加法/乘法混合实现高光反射 | ❌ 无环境反射 | 🔴 高（金属/湿润表面失去真实感） |
| **描边效果** | ✅ MmdOutlineRenderer 独立于 toon/sphere | ⚠️ 需验证 PBR 下的 geometry offset | 🟡 中 |
| **SDEF 关节变形** | ✅ shader 层修改顶点着色器 | ✅ 同样生效（独立于材质构建器） | 🟢 低 |

---

## 分阶段实施计划

### Phase 0 — POC 验证（1 周，独立分支）

**目标**：验证 `PBRMaterialBuilder` + `MmdOutlineRenderer` + `SdefInjector` 的组合可行性。

**具体任务：**

1. 新建 `feat/pbr-material-poc` 分支
2. 在 `scene.ts` 添加条件 import：
   ```typescript
   // 通过 Vite 条件导入切换材质构建器
   const usePbr = import.meta.env.VITE_MMD_MATERIAL === 'pbr';
   if (usePbr) {
       import('babylon-mmd/esm/Loader/pbrMaterialBuilder');
   }
   ```
3. 修改 `model-loader.ts`，根据 `usePbr` 切换 `MmdStandardMaterialProxy` / `PBRMaterialBuilder`
4. 加载一个典型 PMX 模型（含 toon/sphere 贴图），验证：
   - ✅ PBR 材质渲染正常
   - ✅ SDEF 关节变形正常（ADR-112 不受影响）
   - ✅ 描边效果正常（ADR-098 需验证）
   - ❌ Toon/Sphere 贴图静默忽略（预期行为，见 §技术根因）
   - ✅ metallic/roughness 参数可调整且实时预览

**验收标准：**

| 检查项 | 通过条件 |
|--------|---------|
| 类型安全 | `tsc --noEmit` 零错误 |
| 渲染正确 | 模型可见，材质参数可调整 |
| 内存无泄漏 | Chrome DevTools 显存无持续增长 |
| 描边兼容性 | `MmdOutlineRenderer` 在 PBRMaterial 下正常渲染轮廓 |

---

### Phase 1 — 并行模式 + 环境变量（2 周）

**目标**：保留 `MmdStandardMaterialProxy`，新增 `PBRMaterialBuilder` 可选开关。

**具体任务：**

1. **环境变量**：
   ```bash
   # .env.development
   VITE_MMD_MATERIAL=standard  # 默认标准材质
   # 或
   VITE_MMD_MATERIAL=pbr       # PBR 材质
   ```

2. **材质代理注册器**（新增 `frontend/src/scene/manager/material-proxy-resolver.ts`）：
   ```typescript
   export async function resolveMaterialProxy(usePbr: boolean): Promise<typeof MmdStandardMaterialProxy | typeof PBRMaterialBuilder> {
       if (usePbr) {
           const { PBRMaterialBuilder } = await import('babylon-mmd/esm/Loader/pbrMaterialBuilder');
           return PBRMaterialBuilder as any;
       }
       return MmdStandardMaterialProxy;
   }
   ```

3. **修改 scene.ts**：
   ```typescript
   import { resolveMaterialProxy } from './manager/material-proxy-resolver';
   
   // 运行时动态选择
   const usePbr = getEnvState().materialMode === 'pbr';
   const ProxyClass = await resolveMaterialProxy(usePbr);
   MmdRuntimeShared.MaterialProxyConstructor = ProxyClass;
   ```

4. **修改 material.ts**（最小改动）：
   - 9 处 `instanceof StandardMaterial` 新增 `instanceof PBRMaterial` 分支
   - `_capture()` 新增 PBR 参数捕获
   - `_applyParamsToMaterial()` 新增 PBR 参数映射

**验收标准：**

| 检查项 | 通过条件 |
|--------|---------|
| 双材质并存 | 切换 `VITE_MMD_MATERIAL` 后模型材质正确重建 |
| UI 兼容 | StandardMaterial UI 完全保留，PBRMaterial 显示"不适用"提示 |
| 预设兼容 | 旧预设应用于 PBR 模型时自动忽略 toon/sphere 字段 |

---

### Phase 2 — PBR 参数映射 + UI 适配（3 周）

**目标**：新增 PBR 专属 UI 面板，参数语义从"MMD 风格"转为"PBR 工业标准"。

**具体任务：**

1. **新增 PBR 参数定义**（`frontend/src/scene/manager/material-pbr.ts`）：
   ```typescript
   export type PbrMaterialParams = {
       albedoMul: number;           // 漫反射乘率
       reflectionMul: number;       // 环境反射乘率
       metallic: number;            // 金属度（0=非金属, 1=金属）
       roughness: number;           // 粗糙度（0=镜面, 1=漫射）
       ambientMul: number;          // 环境光乘率
       emissiveMul: number;         // 自发光乘率
       albedoTexLevel: number;      // 漫反射贴图强度
       bumpTexLevel: number;        // 法线贴图强度
       emissiveTexLevel: number;    // 自发光贴图强度
       // ❌ 无 toonTexLevel / sphereTexLevel
   };
   ```

2. **参数映射函数**：
   ```typescript
   function standardToPbr(standard: MaterialCategoryParams): Partial<PbrMaterialParams> {
       return {
           albedoMul: standard.diffuseMul,
           reflectionMul: standard.specularMul,
           metallic: 0.0,              // 默认非金属
           roughness: 1 - (standard.shininess / 200),  // shininess↔roughness 反比
           ambientMul: standard.ambientMul,
           emissiveMul: standard.emissiveMul,
           albedoTexLevel: standard.diffuseTexLevel,
           bumpTexLevel: standard.bumpTexLevel,
           emissiveTexLevel: standard.emissiveTexLevel,
       };
   }
   ```

3. **UI 面板改造**（`frontend/src/menus/model-material.ts`）：
   - 新增「材质模式」下拉选择：`Standard / PBR`
   - PBR 模式下隐藏 toon/sphere 滑块，hover 时 tooltip 提示"PBR 不支持此功能"
   - 新增 metallic/roughness 滑块组
   - **Sphere 补偿逻辑**：PBR 下将 `sphereTexLevel > 0` 的模型自动映射 `metallic = sphereTexLevel / 3`，用 PBR metallic 近似替代 sphere 的高光反射效果

4. **预设系统适配**：
   - `ModelPresetFile` 新增 `pbrMaterialCategories` 字段
   - 旧预设加载时自动映射（Phase 1 的 `_resolveMaterialParams`）

**验收标准：**

| 检查项 | 通过条件 |
|--------|---------|
| 参数映射 | Standard→PBR 映射后视觉效果一致（误差 <5%） |
| UI 切换 | 标准/PBR 模式切换流畅，无残留 UI 元素 |
| 预设兼容 | 旧预设可直接应用于 PBR 模型，预览正常 |

---

### Phase 3 — 默认切换 + 文档更新（2 周）

**目标**：默认使用 PBR，旧 StandardMaterial 降级为"可选渲染后端"。

**具体任务：**

1. **切换默认值**：
   ```bash
   # .env.development
   VITE_MMD_MATERIAL=pbr  # 默认 PBR
   ```

2. **旧预设迁移脚本**：
   ```typescript
   // 批量扫描用户预设库，自动映射到 PBR 参数
   function migrateLegacyPresetsToPbr(presets: ModelPresetFile[]): void {
       for (const preset of presets) {
           if (preset.materialCategories && !preset.pbrMaterialCategories) {
               preset.pbrMaterialCategories = standardToPbrBatch(preset.materialCategories);
               preset.materialCategories = undefined; // 废弃旧字段
           }
       }
   }
   ```

3. **文档更新**：
   - `docs/knowledge/material.md` 新增 PBR 章节
   - `docs/architecture.md` 更新渲染管线图
   - UI 帮助文本更新

4. **性能基准测试**：
   | 场景 | StandardMaterial FPS | PBRMaterial FPS | 差异 |
   |------|---------------------|-----------------|------|
   | 单模型（无光照） | TBD | TBD | 预期 ≤5% 下降 |
   | 单模型（3 光源） | TBD | TBD | 预期 ≤10% 下降 |
   | 多模型（5+） | TBD | TBD | 预期 ≤15% 下降 |

**验收标准：**

| 检查项 | 通过条件 |
|--------|---------|
| 性能基线 | PBR FPS ≥ Standard FPS × 0.85 |
| 视觉质量 | 盲测中 ≥70% 用户认为 PBR 视觉更好 |
| 预设迁移 | 旧预设自动映射成功率 ≥95% |

---

## 风险矩阵

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| **PBR 与描边冲突** | 🟠 高 | Phase 0 POC 优先验证；若失败则禁用 PBR 下的描边功能 |
| **Toon 贴图丢失**（风格化阴影） | 🟡 中 | 明确告知用户；提供"Standard"回退选项；文档说明 PBR 视觉取舍 |
| **Sphere 贴图丢失**（环境反射） | 🔴 极高 | PBR 下 sphereTexLevel 滑块强制置灰 + 提示"不支持"；迁移时自动映射 metallic 补偿视觉效果 |
| **性能下降** | 🟡 中 | Phase 3 基准测试把关；支持动态降级到 StandardMaterial |
| **预设不兼容** | 🟢 低 | Phase 2 参数映射函数 + Phase 3 迁移脚本 |
| **UI 复杂度增加** | 🟢 低 | Phase 2 双模式 UI 隔离，用户仅看到当前模式相关控件 |

---

## 后续行动

1. **P0**：创建 `feat/pbr-material-poc` 分支，执行 Phase 0 验证
2. **P1**：根据 POC 结果决定是否推进 Phase 1
3. **P2**：若 POC 通过，启动 Phase 1 并行模式开发

**预计总工作量**：8 周（4 个 phase × 2 周平均），可分阶段交付。

---

## 附录：PBR vs Standard 参数对照表

| 参数 | StandardMaterial | PBRMaterial | 映射公式 |
|------|-----------------|-------------|---------|
| 漫反射颜色 | `diffuseColor` | `albedoColor` | 1:1 |
| 漫反射贴图 | `diffuseTexture.level` | `albedoTexture` | 1:1 |
| 高光颜色 | `specularColor` | `reflectionColor` | 1:1 |
| 光泽度 | `specularPower` (0-200) | `roughness` (0-1) | `roughness = 1 - specularPower/200` |
| 金属度 | ❌ 不支持 | `metallic` (0-1) | 默认 0.0 |
| 环境光 | `ambientColor` | `ambientColor` | 1:1 |
| 自发光 | `emissiveColor` | `emissiveColor` | 1:1 |
| 法线贴图 | `bumpTexture.level` | `bumpTexture.level` | 1:1 |
| Toon 贴图 | `toonTexture.level` | ❌ **不支持**（shader 插件未实现） | 静默忽略，UI 置灰提示 |
| Sphere 贴图 | `sphereTexture.level` | ❌ **不支持**（无 plugin material） | 静默忽略，UI 置灰提示 |

> **⚠️ 重要说明**：Toon/Sphere 不支持的根本原因是 `MmdStandardMaterial` 通过 Babylon.js **plugin material 机制**在 shader 层注入额外采样逻辑，而 `PBRMaterial` 未提供类似扩展。babylon-mmd 上游也**未计划**为 PBRMaterial 实现 toon/sphere 插件（见 §技术根因）。

---

## 附录：MmdStandardMaterial vs PBRMaterial 架构对比

### Shader 管线对比

```
MmdStandardMaterial:
┌─────────────────────────────────────┐
│ StandardMaterial 基础着色器          │
│  ├─ diffuse/uniform/ambient 光照    │
│  └─ specular (Blinn-Phong)         │
└─────────────────────────────────────┘
           ↓ _pluginMaterial 注入
┌─────────────────────────────────────┐
│ MMD 风格化层（自定义 shader 代码）   │
│  ├─ Toon 渐变采样（LUT 查找）       │
│  ├─ Sphere 环境映射（reflection）   │
│  └─ MMD 特殊混合方程                │
└─────────────────────────────────────┘

PBRMaterial:
┌─────────────────────────────────────┐
│ PBRMaterial 基础着色器              │
│  ├─ Cook-Torrance 物理光照          │
│  ├─ metallic/roughness 模型         │
│  ├─ environment IBL 反射            │
│  └─ subsurface/translucency         │
└─────────────────────────────────────┘
           ↓ ❌ 无 plugin material 扩展
       （保持纯 PBR，无 toon/sphere）
```

### Plugin Material 源码位置参考

| 材质类型 | 着色器扩展位置 | babylon-mmd 模块 |
|---------|---------------|------------------|
| MmdStandardMaterial | `mmdStandardMaterial.js:_initPluginShaderSourceAsync()` | `esm/Runtime/mmdStandardMaterialProxy.js` |
| PBRMaterial | ❌ 未实现 | 无对应模块 |

