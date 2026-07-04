# Phase 9a: 布料模拟 + 软体物理 — 详细计划

> **日期**: 2026-06-28
> **状态**: 规划中
> **优先级**: P4
> **依赖**: 现有 WASM Bullet 物理系统（`scene-model.ts`）

---

## 〇、架构梳理：当前 vs 目标

### 当前物理系统

```
MmdWasmRuntime (WASM Bullet)
  ├── PMX 内建刚体 (rigidBodies) + 关节 (joints)
  ├── 逐类别控制: skirt / chest / hair / accessory
  ├── 重力控制: mmdRuntime.physics.setGravity()
  └── 状态快照: rigidBodyStates → 恢复用
```

**局限性**：
- 只有 PMX 文件内建的刚体链，无法新增物理模拟
- 刚体链本质是「关节+碰撞体」的链式约束，不是真正的布料/软体变形
- 无法对模型 mesh 做变形——刚体只驱动骨骼

### 目标系统

```
┌─ WASM Bullet（保留，不变）─────────────┐
│ PMX 内建刚体 + 重力 + 类别控制           │
└────────────────────────────────────────┘

┌─ XPBD 粒子物理（新增）─────────────────┐
│ ┌─ 布料模拟 ─────────────────────────┐ │
│ │ 程序化生成布料 mesh → XPBD 粒子网格  │ │
│ │ → 锚定到骨骼 → 碰撞 SDF 胶囊        │ │
│ └───────────────────────────────────┘ │
│ ┌─ 软体物理 ─────────────────────────┐ │
│ │ 选择骨骼组 → 生成体积粒子层         │ │
│ │ → 体积/边缘/旋转约束 → 变形 mesh     │ │
│ └───────────────────────────────────┘ │
└────────────────────────────────────────┘
```

> **关键决策**: XPBD 是纯 TypeScript 实现，不依赖 WASM Bullet。两个物理系统独立运行、互不干扰。

---

## 一、XPBD 核心引擎（基础设施）

### 1.1 什么是 XPBD

Extended Position Based Dynamics — 一种稳定的基于位置的粒子仿真算法：
- 每个粒子有位置、速度、质量
- 约束（距离/体积/弯曲）以迭代方式求解
- 天然无条件稳定，不会爆炸
- GPU Web Worker 友好（可后续迁移）

### 1.2 核心数据结构

```typescript
// frontend/src/physics/xpbd-solver.ts

interface XpbdParticle {
  p: Float32Array;     // 当前位置 [x, y, z]
  prevP: Float32Array; // 上一帧位置（Verlet 积分）
  v: Float32Array;     // 速度
  mass: number;        // 质量倒数 (1/mass)，0 = 固定
  radius: number;      // 碰撞半径
}

interface XpbdConstraint {
  type: "distance" | "volume" | "bend" | "collision";
  indices: number[];   // 涉及的粒子索引
  compliance: number;  // 柔度 (0 = 硬, 大 = 软)
  restValue: number;   // 静止值（距离/体积）
  solve(dt: number): void;
}

class XpbdSolver {
  particles: XpbdParticle[];
  constraints: XpbdConstraint[];
  gravity: Float32Array;    // [0, -9.8, 0]
  substeps: number;         // 子步数，默认 4
  damping: number;          // 速度阻尼，默认 0.98
  
  step(dt: number): void;   // 主步进
  addParticle(pos, mass, radius): number;
  addDistanceConstraint(i, j, compliance, restLength?): void;
  addVolumeConstraint(indices, compliance): void;
  addBendConstraint(i, j, k, compliance): void;
  addGroundCollision(groundY): void;
}
```

### 1.3 求解器步进流程

```
step(dt):
  for each particle:
    1. Verlet 积分: v = (p - prevP) / dt * damping
    2. 应用重力: v += gravity * dt
    3. 更新位置: prevP = p; p += v * dt
  
  for substep in 1..substeps:
    for each constraint:
      constraint.solve(dt / substeps)
  
  for each particle:
    v = (p - prevP) / dt  // 更新最终速度
```

### 1.4 文件结构（新增）

```
frontend/src/physics/
├── xpbd-solver.ts        # XPBD 核心引擎
├── xpbd-cloth.ts         # 布料模拟（程序化生成 + 模拟）
├── xpbd-softbody.ts      # 软体物理（骨骼→粒子→变形）
├── xpbd-collider.ts      # SDF 胶囊碰撞器
└── xpbd-renderer.ts      # 粒子/mesh 可视化调试
```

---

## 二、布料模拟（Cloth Simulation）

### 2.1 功能概述

从模型骨骼出发，**程序化生成**一件布料服装（裙子/上衣/斗篷），然后用 XPBD 粒子模拟其物理运动，实时更新 Babylon.js 网格。

### 2.2 实现步骤

#### Step 1: 程序化网格生成 (`xpbd-cloth.ts`)

**输入**: 锚定骨骼名 + 拓扑参数
**输出**: `{ particles: XpbdParticle[], constraints: XpbdConstraint[], mesh: Mesh }`

```
参数:
- anchorBone: string       # 锚定骨骼（如 "腰"）
- topology: "skirt" | "tube" | "cape" | "rope"
- innerRadius: number      # 腰部开口
- length: number           # 裙长
- slope: number            # 裙摆角度 (0=直筒, 90=平摊)
- segmentsH: number        # 水平分段 (默认 24)
- segmentsV: number        # 垂直分段 (默认 12)
- particleRadius: number   # 碰撞半径
- compliance: number       # 柔度
```

**生成算法**:
```
1. 以 anchorBone 位置为中心，沿 Y 轴向下生成环形网格
2. 每层 N 个粒子 (segmentsH)，共 M 层 (segmentsV)
3. 最上层粒子 mass=0 (固定到骨骼)
4. 距离约束: 相邻粒子间 (水平 + 垂直)
5. 弯曲约束: 间隔粒子间 (防止过度折叠)
```

#### Step 2: 每帧更新

```
update(dt, boneWorldMatrix):
  1. 更新锚定粒子位置 = boneWorldMatrix * localAnchorPos
  2. solver.step(dt)
  3. 更新 Babylon.js mesh 顶点位置 = particle positions
  4. 重新计算法线
```

#### Step 3: SDF 身体碰撞 (`xpbd-collider.ts`)

```
身体部位胶囊列表:
- head: 头
- neck: 颈
- chest: 胸
- waist: 腰
- hip: 臀
- upperArm L/R: 上臂
- lowerArm L/R: 前臂
- upperLeg L/R: 大腿
- lowerLeg L/R: 小腿

每个胶囊: { boneName, radius, offset }
每帧从骨骼世界矩阵更新胶囊位置
碰撞求解: 粒子→胶囊 SDF 排斥
```

#### Step 4: UI 集成

在场景菜单或模型详情中新增「布料」子菜单：
```
场景菜单 → 模型 → 布料
├── 启用布料: toggle
├── 布料层 1 / 布料层 2: folder
│   ├── 拓扑: select (裙子/直筒/斗篷/绳索)
│   ├── 内半径: slider 0.1~1.0
│   ├── 长度: slider 0.5~5.0
│   ├── 斜率: slider 0~90
│   ├── 分辨率H: slider 12~48
│   ├── 分辨率V: slider 6~24
│   ├── 柔度: slider 0~1
│   ├── 阻尼: slider 0~1
│   └── 材质色: color picker
├── 碰撞体可视化: toggle
└── 重力倍率: slider 0.5~2.0
```

---

## 三、软体物理（Soft Body Physics）

### 3.1 功能概述

选择骨骼组（如臀部、腹部、胸部），在其周围生成体积粒子层，用 XPBD 约束模拟摇晃和形变，驱动关联 mesh 变形。

### 3.2 实现步骤

#### Step 1: 骨骼到粒子映射 (`xpbd-softbody.ts`)

**输入**: 根骨骼名 + XPBD 参数
**输出**: `{ particles: XpbdParticle[], constraints: XpbdConstraint[], boneMapping }`

```
参数:
- rootBone: string           # 根骨骼
- depth: number              # 粒子层深度 (0.05~0.5)
- layers: number             # 层数 (1~3)
- subdivisions: number       # 子分 (1~4)
- volumeCompliance: number   # 体积约束柔度
- edgeCompliance: number     # 边缘约束柔度
- rotationCompliance: number # 旋转约束柔度
- suspend: boolean           # 悬挂关节
- suspendSpring: number      # 悬挂弹簧力
```

**生成算法**:
```
1. 遍历 rootBone 的子骨骼，每个骨骼成为粒子原点
2. 从骨骼位置沿法线方向扩展 layers 层
3. 每层 subdivisions × subdivisions 个粒子
4. 添加约束:
   - 体积约束: 保持粒子组体积不变
   - 边缘约束: 保持相邻粒子间距
   - 旋转约束: 保持骨骼间角度
   - (可选) 悬挂约束: 弹簧阻尼锚定到父骨骼
```

#### Step 2: 每帧更新

```
update(dt, boneMatrices):
  1. 读取骨骼世界矩阵
  2. solver.step(dt)
  3. 计算粒子位移 → 反推骨骼/顶点的修正矩阵
  4. (可选) 直接修改关联 mesh 的顶点缓冲区
```

#### Step 3: 可视化调试

```
- 显示粒子: 小球体 mesh
- 显示约束: 彩色线段
- 显示骨骼: 原始骨骼叠加
```

#### Step 4: UI 集成

```
场景菜单 → 物理 → 软体
├── 启用软体: toggle
├── 主群组: folder
│   ├── 根骨骼: bone selector
│   ├── 深度: slider 0.05~0.5
│   ├── 层数: slider 1~3
│   ├── 子分: slider 1~4
│   ├── 体积柔度: slider 0~1
│   ├── 边缘柔度: slider 0~1
│   ├── 旋转柔度: slider 0~1
│   └── 悬挂: toggle + 弹簧力 slider
├── 群组 2~8 (同上)
├── 粒子可视化: toggle
└── 约束可视化: toggle
```

---

## 四、实施顺序与预估

| 步骤 | 内容 | 预估 | 新文件 |
|------|------|------|--------|
| **M1** | XPBD 核心引擎 (`xpbd-solver.ts`) | ✅ 完成 | 1 |
| **M2** | 测试: XPBD 粒子链自由落体 | ✅ 完成 | — |
| **M3** | 程序化布料网格生成 (`xpbd-cloth.ts`) | ✅ 完成 | 1 |
| **M4** | 布料→Babylon.js mesh 渲染 | ✅ 完成（并入 M3） | — |
| **M5** | SDF 胶囊碰撞器 (`xpbd-collider.ts`) | ✅ 完成 | 1 |
| **M6** | UI: 布料子菜单 (`menus/` 扩展) | 小 | — |
| **M7** | 软体骨骼粒子映射 (`xpbd-softbody.ts`) | 中 | 1 |
| **M8** | 软体→mesh 变形回传 | 中 | — |
| **M9** | UI: 软体子菜单 | 小 | — |
| **M10** | 整体联调 + 场景序列化 | 小 | — |

**总预估**: 5 个新文件，~800 行核心代码 + ~300 行 UI

---

## 五、风险与降级策略

| 风险 | 概率 | 降级方案 |
|------|------|----------|
| XPBD 精度不足导致布料抖动 | 中 | 增加子步数 → 4→8；增加约束阻尼 |
| SDF 胶囊碰撞性能不够 | 低 | 先用简单球体碰撞，后续升级 |
| 软体 mesh 变形与骨骼动画冲突 | 中 | 软体只影响关联 mesh 顶点，不干涉骨骼 |
| 布料 mesh 三角剖分复杂 | 中 | 先用预设拓扑（裙/管/斗篷），放弃自由拓扑 |
| 多模型多布料性能压力 | 低 | 限制每场景最多 2 层布料 + 1 个软体组 |

---

## 六、后续扩展（Phase 9b，不在本次范围）

- Mesh→布料转换: 选取现有模型 mesh，直接转为布料粒子
- 布料材质: 纹理映射 + 音频可视化
- 软体动画录制: 录制软体运动为 VMD 关键帧
- Web Worker 并行: 将 XPBD 求解器移到 Worker 线程
