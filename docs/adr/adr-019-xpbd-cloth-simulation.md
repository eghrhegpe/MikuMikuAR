# ADR-019: XPBD 布料模拟引擎选型与架构

> **日期**: 2026-06-28
> **状态**: 已完成 — xpbd-solver/collider/cloth/renderer + 20 tests 全通过

---

## 背景

需要为 MikuMikuAR 添加布料/裙摆物理模拟。评估了三类方案：

1. **WASM Bullet 软体**：复用现有 `MmdBulletPhysics`，但 Bullet 软体 API 在 babylon-mmd 中未完整暴露，且与 PMX 骨骼权重绑定过紧，无法为独立裙摆网格添加物理
2. **ammo.js**：社区成熟但维护停滞，额外 ~1MB WASM binary，与现有 Bullet 双物理引擎并存导致内存翻倍
3. **自研 XPBD (TypeScript)**：纯 TS 实现，无 WASM 依赖，轻量可定制，但需自行实现碰撞检测

## 决策

**选择方案 3：自研 XPBD（Extended Position Based Dynamics）引擎。**

### 核心设计

| 模块 | 职责 | 文件 |
|------|------|------|
| `XpbdSolver` | Verlet 积分 + 子步约束求解（距离/弯曲/体积）+ 地面碰撞 | `physics/xpbd-solver.ts` |
| `XpbdCloth` | 程序化裙摆网格生成 + 骨骼锚定 + 每帧 Mesh 更新 | `physics/xpbd-cloth.ts` |
| `SdfCollider` | SDF 胶囊碰撞体（13 身体胶囊，骨骼跟随） | `physics/xpbd-collider.ts` |
| `XpbdRenderer` | 调试可视化（粒子小球/约束线条/胶囊线框） | `physics/xpbd-renderer.ts` |
| `ClothManager` | 布料生命周期管理（创建/销毁/重建/碰撞缩放） | `physics/cloth-manager.ts` |

### 技术要点

- **子步约束求解**：每帧 3 子步，逐约束投影，确保数值稳定性
- **SDF 胶囊碰撞**：14 个骨骼映射胶囊（头/颈/胸/腰/臀/四肢），`updateCapsuleSizes` 随模型骨骼实时跟随
- **摩擦实现**：修改 `prevP`（前一帧位置）而非 `p.v`（速度），避免与 Verlet 积分冲突
- **锚定粒子**：锚点 `prevP` 不覆盖，仅在位置更新时同步，防止约束撕裂
- **碰撞胶囊矩阵每帧更新**：`updateMatrices` 跟随骨骼动画变化

### 拒绝的方案

| 方案 | 拒绝原因 |
|------|---------|
| WASM Bullet 软体 | API 暴露不完整，与 PMX 骨骼耦合过紧 |
| ammo.js | 额外 1MB WASM，双物理引擎内存压力 |
| 纯 Verlet 无 XPBD | 约束刚度不可控，裙摆过软或过硬 |

## 后果

- ✅ 纯 TS 无 WASM 依赖，bundle 无增量
- ✅ 约束刚度可控，视觉效果可调
- ⚠️ 与 WASM Bullet 物理独立运行，两者无交互（布料不与头发物理碰撞）
- ⚠️ SDF 碰撞体数量固定（13 胶囊），不支持自动适配非标准骨骼模型
- ✅ 调试渲染器可在开发时可视化粒子/约束/胶囊

### 后续修正

**2026-07-06 — 碰撞胶囊半径公式修正**
- `updateCapsuleSizes` 半径原为 `dist * 0.2`，导致实测半径仅 DEFAULT_BODY_CAPSULES 参考值的 1/4，粒子穿透率高
- 修正为 `dist * 0.8`，与 DEFAULT 腰半径 0.13 一致；半高保持 `dist * 0.5` 不变
- 参考：腰高（下半身→腰 ≈ 0.15）× 0.8 = 0.12，与实际腰围/2π 吻合

**2026-07-06 — `autoFitClothDimensions` 重写（v2）**
- 原算法使用锚骨骼到父骨骼的链段长度 × 0.8 做 innerRadius（物理意义错误，链段≠体截面半径）
- v2 改为**横向骨骼采样法**：在锚骨骼 Y 高度附近采集所有骨骼的径向距离，取中位数 × 0.55 作为体半径
- 回退路径：链段 × 0.7；最终回退：参考腰半径 × 身高归一化系数
- `length` 从 `verticalSpan × 0.5` 改为 `max(verticalSpan × 0.6, 参考裙长 × scaleFactor)`
- 新增 `modelHeight` 参数（来自 bounding box），用于身高归一化（REF_HEIGHT = 1.7m）
- BFS 骨骼搜索深度从 6 层提升至 8 层
- 触发条件修复：出厂默认值（innerRadius=0.12）也能触发 autoFit（原仅 innerRadius>=0.9 触发）

## 状态

✅ 已实现并验证（2026-06-28），测试套件 `xpbd-solver.test.ts` + `xpbd-cloth.test.ts`（52 tests 全部通过）。