# 第⑤轮审核 — VMD 加载 + 图层

## vmd-loader.ts (318行)

**总体结论：⚠️ 有条件通过**

**文件：** `frontend/src/scene/motion/vmd-loader.ts`
**ADR 参考：** ADR-051(图层/骨骼过滤)
**测试：** `vmd.test.ts` (250行，覆盖 vmd-writer 帧大小/签名/结构，非本模块直接测试)

---

### 类型安全 — 🟠 P2

| # | 位置 | 问题 | 严重度 |
|---|------|------|--------|
| 1 | L97 | `result as unknown as { dispose: () => void }` 双重 cast | 🟠 P2 |

双重 cast `as unknown as` 绕过类型系统。有注释说明原因（VMD loader 返回泛化资源对象），但未论证运行时类型安全。

### 测试覆盖 — 🔴 P1

`isValidVmd()`（校验 VMD 文件头/结构完整性）— **零测试**。VMD 文件结构复杂，校验逻辑易出错。
`_tryLoadCompanionAudio`（Promise.any 竞速加载配套音频）— **零测试**。Promise.any 的竞态条件未验证。

### 设计质量 — ✅

| 模式 | 说明 |
|------|------|
| 增量解析 | VMD 二进制按需解析，不全部加载到内存 |
| 延迟加载 | `_tryLoadCompanionAudio` 使用 `Promise.any` 从多个候选路径竞速加载 |

---

## vmd-layers.ts (611行)

**总体结论：⚠️ 有条件通过**

**文件：** `frontend/src/scene/motion/vmd-layers.ts`
**ADR 参考：** ADR-051(图层/骨骼过滤: 方案B — VMD 二进制级过滤)
**测试：** ❌ 0 测试

---

### 类型安全 — 🟠 P2

| # | 位置 | 问题 | 严重度 |
|---|------|------|--------|
| 1 | L97 | `result as unknown as { dispose: () => void }` 双重 cast | 🟠 P2 |
| 2 | L588 | `composite as unknown as IMmdBindableModelAnimation` 双重 cast | 🟠 P2 |

两处双重 cast 均绕过类型系统，缺运行时验证断言。

### 模块大小 — 🟠 P2

**611 行远超 250LOC 天花板。** 建议拆分：
- `vmd-layer-config.ts`（图层配置类型 + 默认值）
- `vmd-layer-composite.ts`（合成动画管理）
- `vmd-layer-filter.ts`（骨骼过滤逻辑）

### 测试覆盖 — 🔴 P1

**整个模块零测试。** 核心逻辑包括：

| 未测试函数 | 风险说明 |
|------------|----------|
| `_filterVmdBones()` | 二进制级骨骼过滤操作，直接操作 VMD 二进制缓冲区，索引偏移计算错误可能导致 VMD 数据损坏 |
| `_rebuildCompositeAnimation()` | 合成动画重建，涉及多图层融合，错一步则所有帧错位 |
| layering/blending 主逻辑 | 多图层叠加、权重混合的核心路径 |

### 功能正确性 — 🟡 P3

| # | 问题 | 位置 | 风险 |
|---|------|------|------|
| 1 | weight 归一化：`weights / sumWeights` | L~450 | 当所有权重为 0 时 `sumWeights = 0`，`0 / 0 = NaN`，导致骨骼变换异常 |

### ADR 审计

**ADR-051:** 方案 B（VMD 二进制级过滤）已实现。`_filterVmdBones` 在二进制层面过滤骨骼帧（每帧 111B），尾部数据完整保留。单图层零拷贝优化未实施（ADR-051 中记录为可选项，不影响核心功能）。✅

---

## wasm-layers-blender.ts (265行)

**总体结论：⚠️ 有条件通过**

**文件：** `frontend/src/scene/motion/wasm-layers-blender.ts`
**ADR 参考：** ADR-056(WASM 运行时 Motion Layers: C+B 混合方案)
**测试：** `wasm-layers-blender.test.ts` (77行，覆盖 `DEFAULT_LAYER_BONE_FILTER` 内容/权重归一化/boneFilter 匹配纯函数)；核心逻辑 `_applyLayersBlending` ❌ 零功能测试

---

### 类型安全 — 🟡 P3

| # | 位置 | 问题 | 严重度 |
|---|------|------|--------|
| 1 | L~50 | `_mmdRuntime!` 非空断言 | 🟡 P3 |
| 2 | L203 | `as` 断言 | 🟡 P3 |

### 测试覆盖 — 🟠 P2

`_applyLayersBlending` — **零功能测试**。该函数是 WASM 图层混合的核心热路径（774 骨 PMX 实测 0.0044ms~2.16ms），但无任何测试验证其输出正确性。

已有性能测试 `wasm-layers-blender.perf.test.ts`（269行），独立复刻热路径验证性能基准，但**功能正确性未验证**。

### 循环依赖 — 🟡 P3

`wasm-layers-blender.ts` 静态 `import` 自 `scene.ts`：
```
wasm-layers-blender.ts → import scene.ts → (可能) → import vmd-layers.ts → dynamic import → wasm-layers-blender.ts
```

vmd-layers.ts 使用 `dynamic import()` 导入 blender，但 blender **静态** import scene。如果 scene.ts 直接或间接 import layers，则形成循环依赖链。

### ADR 审计

**ADR-056:** C+B 混合方案已实现。JS 帧流合并 — 每帧 JS 侧求值 overlay 骨骼变换 → frontBuffer 混合（位置 Lerp + 旋转 Slerp + 权重归一化）。B1 降级兜底。性能实测数据一致。✅

### 编码一致性 — 🟢 P4

- babylon-mmd: `TextDecoder('shift-jis')` 解码骨骼名
- vmd-layers.ts: `encoding-japanese` 库解码

标准日文字符映射一致，但罕见扩展字符可能有差异。建议统一使用同一解码策略。

---

## wasm-layers-config.ts (12行)

**总体结论：✅ 通过**

纯配置常量文件，类型安全，无运行时逻辑。

---

## vmd-evaluator.ts (289行)

**总体结论：✅ 通过**

**文件：** `frontend/src/motion-algos/vmd-evaluator.ts`
**测试：** `vmd-evaluator.test.ts` (431行) + `vmd-evaluator.regression.spec.ts` (610行)

### 测试覆盖 — 标杆级

| 测试文件 | 行数 | 覆盖内容 |
|----------|------|----------|
| `vmd-evaluator.test.ts` | 431 | 空数据兜底、Slerp、边界条件、evalAllBones、movable、dispose、Bezier、混合 |
| `vmd-evaluator.regression.spec.ts` | 610 | 基线、双图层、三图层、交错、非重叠、极端权重→blendRotations/blendPositions←镜像 MmdCompositeAnimation |

测试覆盖 `blendRotations/blendPositions` 的镜像实现与 `MmdCompositeAnimation` 的一致性。回归测试通过基线对比确保输出不变。

---

## 风险清单

| 文件 | 观察 | 建议 |
|------|------|------|
| 🔴 P1 | vmd-layers.ts | 611行零测试 | 最小添加：_filterVmdBones 二进制过滤 + _rebuildCompositeAnimation 合成 |
| 🔴 P1 | vmd-loader.ts | isValidVmd 零测试 | 添加：有效/无效 VMD 文件头校验测试 |
| 🟠 P2 | vmd-loader.ts:97 | 双重 cast 无注释 | 追加安全性注释或加运行时 assert |
| 🟠 P2 | vmd-layers.ts | 611行超限 | 拆 3 子模块：config/composite/filter |
| 🟠 P2 | vmd-layers.ts:588 | 双重 cast | 加运行时验证或类型守卫 |
| 🟠 P2 | wasm-layers-blender.ts | _applyLayersBlending 零功能测试 | 添加输出正确性验证（与 vmd-evaluator 基线对比） |
| 🟡 P3 | vmd-layers.ts:~450 | 权重归一化除以零 | 加 `if (sumWeights === 0) return` guard |
| 🟡 P3 | wasm-layers-blender.ts | 循环依赖 scene.ts | 将 scene.ts 导入改为延迟求值或接口注入 |
| 🟢 P4 | wasm-layers-blender.ts | 骨骼名编码统一 | babylon-mmd 与 encoding-japanese 对齐 |
