# ADR-084: Mesh-to-Cloth 虚拟裙骨生成 —— WASM Bullet 运行时刚体注入

> **状态**: 实施中（Phase 1-4 POC 已完成：`skirt-analyzer.ts` + `virtual-skirt.ts` + `motion-cloth-levels.ts`(UI 入口) + 31 单测全绿 + 五语言 i18n；Phase 5 性能/Android 适配待开始）
> **关联**: ADR-054(P2 路线图)、ADR-081(XPBD 移除)、ADR-019(XPBD 布料，已废弃)、ADR-029(物理 UI 重构)、ADR-043(竞品差距分析)

---

## 一、背景

### 1.1 问题来源

ADR-054 路线图 P2 第 4 项列出了「Mesh-to-Cloth 自动布料」——对没有自带裙骨的 PMX 模型，从 mesh 几何自动识别裙摆区域并生成物理约束，使裙摆产生动态飘动。

原计划基于 TS XPBD 求解器实现。ADR-081（2026-07-10）全栈移除 TS XPBD 后，该功能失去物理后端，路线图标注「转 WASM Bullet」但未评估可行性。

### 1.2 竞品参照

DanceXR（ADR-043 差距分析 D 类）已实现 Mesh-to-Cloth。本 ADR 的目标是补齐这一差距。

### 1.3 不做什么

- ❌ 不实现顶点级有限元布料（那是 Blender/DCC 软件的领域）
- ❌ 不修改 babylon-mmd WASM 源码（fork）
- ❌ 不替换 MMD 自带裙骨物理（仅在模型缺少裙骨时补充）
- ✅ 只做**骨骼级刚体 + 弹簧约束**——利用 WASM Bullet 现有 public API 注入运行时刚体

---

## 二、API 可行性核实（2026-07-11）

对 babylon-mmd `v9.14.0` WASM Bullet 绑定层做了完整 API 审计。结论：**无需 fork，全部 public API 可用**。

### 2.1 物理世界入口

| API | 文件 | 用途 |
|-----|------|------|
| `MmdWasmPhysicsRuntimeImpl.addRigidBody(rb, worldId)` | `Physics/mmdWasmPhysicsRuntimeImpl.d.ts:96` | 运行时添加刚体到物理世界 |
| `MmdWasmPhysicsRuntimeImpl.addConstraint(c, worldId, disableCollisions)` | 同上 `:245` | 运行时添加约束 |
| `MmdWasmPhysicsRuntimeImpl.removeRigidBody(rb, worldId)` | 同上 `:107` | 移除刚体 |
| `MmdWasmPhysicsRuntimeImpl.removeConstraint(c, worldId)` | 同上 `:254` | 移除约束 |

### 2.2 刚体构造

| API | 文件 | 用途 |
|-----|------|------|
| `RigidBodyConstructionInfo` | `Bind/rigidBodyConstructionInfo.d.ts` | 刚体属性容器（shape/mass/motionType/damping/friction/restitution/collisionGroup/Mask） |
| `RigidBody(runtime, info)` | `Bind/rigidBody.d.ts:35` | 从 ConstructionInfo 创建刚体实例 |
| `MotionType.Dynamic = 0` | `Bind/motionType.d.ts` | 动态刚体（受力影响） |
| `MotionType.Kinematic = 2` | 同上 | 运动学刚体（可手动移动，不受力） |

### 2.3 碰撞形状

| 形状类 | 构造参数 | 裙骨用途 |
|--------|---------|---------|
| `PhysicsSphereShape(runtime, radius)` | 半径 | 裙骨节点碰撞体（轻量） |
| `PhysicsCapsuleShape(runtime, radius, height)` | 半径+高度 | 裙骨节点碰撞体（更贴合胶囊形） |
| `PhysicsBoxShape(runtime, size)` | 半尺寸 | 腰部锚定体 |

### 2.4 弹簧约束（关键）

```typescript
// Generic6DofSpringConstraint — 6 自由度弹簧约束
class Generic6DofSpringConstraint extends Generic6DofConstraintBase {
    constructor(
        runtime: IPhysicsRuntime,
        bodyA: RigidBody, bodyB: RigidBody,
        frameA: Matrix, frameB: Matrix,
        useLinearReferenceFrameA: boolean
    );
    enableSpring(index: number, onOff: boolean): void;    // 0-5 轴弹簧开关
    setStiffness(index: number, stiffness: number): void; // 弹簧刚度
    setDamping(index: number, damping: number): void;     // 弹簧阻尼
}
```

`index` 语义：0-2 = 线性 X/Y/Z，3-5 = 角 X/Y/Z。裙骨链需要限制为铰链式（角 X/Y 自由、其余锁定）或全自由弹簧。

### 2.5 刚体变换读写

| API | 用途 |
|-----|------|
| `rb.setTransformMatrix(matrix)` | 设置运动学刚体位置（Kinematic 模式） |
| `rb.setDynamicTransformMatrix(matrix)` | 设置动态刚体位置 |
| `rb.getTransformMatrixToArray(arr, offset)` | 读取刚体世界变换矩阵 |

### 2.6 Mesh 拓扑访问

`MmdModel.mesh` 是标准 Babylon.js `Mesh`，可直接读取：

```typescript
const positions = mesh.getVerticesData(VertexBuffer.PositionKind);    // Float32Array
const indices   = mesh.getIndices();                                    // Uint32Array
const weights   = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind); // 骨骼权重
const boneIdx   = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind); // 骨骼索引
```

### 2.7 已有基础设施

`physics/physics-bridge.ts`（ADR-081 §五保留）提供：
- `findRuntimeBone(model, name)` — 骨骼查找
- `getBoneWorldPosition(model, name)` — 世界坐标读取
- `autoFitAttachment(anchor, opts)` — 几何参数推算（含 `radial` topology 模式）
- `PerFrameUpdateRegistry` — 每帧回调调度（自动管理 observer 生命周期）

---

## 三、架构设计

### 3.1 三阶段管线

```
PMX Mesh 顶点数据
    │
    ▼
┌──────────────────────────┐
│ Phase 1: 裙摆拓扑分析      │  纯几何，无物理依赖，可单测
│  · 边缘检测（开放边）       │  · 找 boundary edges（仅被 1 个三角形引用的边）
│  · 裙边环识别              │  · 按 Y 坐标最低的 boundary edge 连通分量 → 裙边
│  · 分链（径向）            │  · 沿法线向内分层 → 每层一个虚拟骨节
│  · 顶点→骨节映射           │  · 最近邻分配 + 距离衰减权重
└───────────┬──────────────┘
            ▼
┌──────────────────────────┐
│ Phase 2: WASM Bullet 注入  │  运行时刚体 + 弹簧约束创建
│  · 每个骨节 → Sphere RB    │  · MotionType.Dynamic, 小 mass
│  · 父子链 → Spring Const.  │  · Generic6DofSpringConstraint
│  · 链头锚定腰骨            │  · Kinematic RB setTransformMatrix(腰骨)
│  · 腰体 → Box RB (Kinematic) │  · addRigidBodyToGlobal
└───────────┬──────────────┘
            ▼
┌──────────────────────────┐
│ Phase 3: 每帧顶点回写      │  PerFrameUpdateRegistry 调度
│  · 读刚体世界矩阵          │  · rb.getTransformMatrixToArray()
│  · 计算偏移量              │  · currentPos - restPos → delta
│  · 写入 vertex buffer      │  · mesh.updateVerticesData()
└──────────────────────────┘
```

### 3.2 Phase 1 拓扑分析算法

```
输入: positions[], indices[], boneWeights[], boneIndices[]
输出: SkirtChains[]  (每条链 = 骨节链, 每个骨节 = {restPos, vertexIndices[]})

1. 构建 edge→triangle 映射
   · 对每个三角形的三条边: edge[(min,max)] → triangleCount++
   · boundary edges = count == 1 的边

2. 辅助过滤（模型已有裙骨时跳过）
   · 骨骼名匹配: /skirt|裾|スカート/i → 若已有裙骨则跳过自动生成
   · 仅对无裙骨模型执行

3. 裙边环提取
   · 取 Y 坐标 < 全身 30% 的 boundary edges
   · 连通分量分析 → 每个连通分量 = 一条裙边环段

4. 径向分链
   · 从裙边环每个顶点沿法线向内偏移 N 层（N = segmentsV, 默认 8-16）
   · 每层取平均位置作为骨节 restPos
   · 同一径向方向的 N 层 = 一条链

5. 顶点→骨节映射
   · 对每个顶点, 找最近的 2 个骨节
   · 按距离反比分配权重（类似线性 blend skinning）
```

### 3.3 Phase 2 物理注入

```typescript
// 伪代码 — 创建一条裙骨链
function createSkirtChain(
    runtime: MmdWasmPhysicsRuntimeImpl,
    worldId: number,
    chain: SkirtChain,
    anchorBoneWorldPos: Vector3
): { rigidBodies: RigidBody[]; constraints: Constraint[] } {
    const rbs: RigidBody[] = [];
    const constraints: Constraint[] = [];

    // 链头: Kinematic 锚定体 (跟随腰骨)
    const anchorInfo = new RigidBodyConstructionInfo(wasmInstance);
    anchorInfo.shape = new PhysicsBoxShape(runtime, new Vector3(0.1, 0.05, 0.1));
    anchorInfo.motionType = MotionType.Kinematic;
    anchorInfo.mass = 0;
    const anchorRb = new RigidBody(runtime, anchorInfo);
    runtime.addRigidBody(anchorRb, worldId);

    // 链身: Dynamic 球体 + 弹簧约束
    for (let i = 0; i < chain.segments.length; i++) {
        const seg = chain.segments[i];
        const info = new RigidBodyConstructionInfo(wasmInstance);
        info.shape = new PhysicsSphereShape(runtime, seg.radius);
        info.motionType = MotionType.Dynamic;
        info.mass = 0.05;           // 轻质量
        info.linearDamping = 0.1;    // 阻尼防止抖动
        info.angularDamping = 0.3;
        info.friction = 0.5;
        info.restitution = 0.0;      // 不弹
        info.setInitialTransform(
            Matrix.Translation(seg.restPosition[0], seg.restPosition[1], seg.restPosition[2]),
        ); // 初始变换由 restPosition 构造（已核实 babylon-mmd RigidBodyConstructionInfo.setInitialTransform 真实存在）
        info.disableDeactivation = true;

        const rb = new RigidBody(runtime, info);
        runtime.addRigidBody(rb, worldId);
        rbs.push(rb);

        // 弹簧约束: 连接到父刚体
        const parent = i === 0 ? anchorRb : rbs[i - 1];
        const spring = new Generic6DofSpringConstraint(
            runtime, parent, rb,
            Matrix.Identity(), Matrix.Identity(),
            false
        );
        spring.enableSpring(0, true); spring.setStiffness(0, 50);  // X 线性
        spring.enableSpring(1, true); spring.setStiffness(1, 50);  // Y 线性
        spring.enableSpring(2, true); spring.setStiffness(2, 50);  // Z 线性
        spring.enableSpring(3, true); spring.setStiffness(3, 30);  // X 角
        spring.enableSpring(4, true); spring.setStiffness(4, 30);  // Y 角
        spring.enableSpring(5, false); // Z 角锁定（防扭转）
        spring.setDamping(0, 0.3);
        spring.setDamping(1, 0.3);
        spring.setDamping(2, 0.3);
        runtime.addConstraint(spring, worldId, true);
        constraints.push(spring);
    }

    return { rigidBodies: rbs, constraints };
}
```

### 3.4 Phase 3 顶点回写（策略 A1: 直接写 vertex buffer）

```typescript
// PerFrameUpdateRegistry 回调（实际为 VirtualSkirtController._writeBackVertices 方法）
// 注意：buf / tmp 为类成员缓存，每帧复用，不重新分配（避免 GC 压力）
function writeBackVertices(
    mesh: Mesh,
    restPositions: Float32Array,
    chains: SkirtChain[],
    rigidBodies: RigidBody[]
): void {
    const buf = workBuf;     // 类成员缓存，长度 = restPositions.length
    buf.set(restPositions);  // 基准 = 静态 rest pose

    const tmp = tmpArray;    // 类成员缓存 Float32Array(16)
    let rbIdx = 0;
    for (const chain of chains) {
        for (const seg of chain.segments) {
            const rb = rigidBodies[rbIdx++];
            rb.getTransformMatrixToArray(tmp, 0);
            // 从刚体矩阵提取位移 delta = currentPos - restPos
            const dx = tmp[12] - seg.restPosition[0];
            const dy = tmp[13] - seg.restPosition[1];
            const dz = tmp[14] - seg.restPosition[2];
            // 按权重偏移该骨节关联的顶点（vertexIndices / weights 平行数组）
            for (let i = 0; i < seg.vertexIndices.length; i++) {
                const v = seg.vertexIndices[i];
                const w = seg.weights[i];
                buf[v * 3]     += dx * w;
                buf[v * 3 + 1] += dy * w;
                buf[v * 3 + 2] += dz * w;
            }
        }
    }

    mesh.updateVerticesData(VertexBuffer.PositionKind, buf, false, false);
}
```

### 3.5 顶点回写策略对比

| 策略 | 做法 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|---------|
| **A1. 直接写 buffer** | 每帧把刚体位置→顶点偏移写入 PositionKind | 简单直接，无需改 skeleton | 仅位移不含旋转形变 | POC 验证 |
| **A2. 虚拟骨骼注入** | 添加 Skeleton bone + 重分配权重 | 形变自然，Babylon 蒙皮管线自动处理 | 侵入 skeleton 结构，需对齐 beforePhysics/afterPhysics | 正式版 |

**决策**：POC 先走 A1，验证裙摆飘动效果。若形变质量不足（裙摆"飘但不像布"），升级到 A2。

---

## 四、实施计划

### 4.1 分阶段交付

| 阶段 | 内容 | 产出 | 验收标准 |
|------|------|------|---------|
| **Phase 1-POC** | 裙摆拓扑分析算法 | `scene/physics/skirt-analyzer.ts` + 单元测试 | 给定测试 mesh, 正确识别裙边环 + 分链 |
| **Phase 2-POC** | WASM Bullet 注入 | `scene/physics/virtual-skirt.ts` | 无裙骨模型加载后裙骨链创建成功, 无报错 |
| **Phase 3-POC** | 顶点回写 + 联调 | `PerFrameUpdateRegistry` 回调 | 裙摆在风力/移动下可见飘动 |
| **Phase 4-UI** | 菜单入口 + 参数面板 | `menus/motion-skirt-levels.ts` | 开关 + 链数/刚度/阻尼滑块 |
| **Phase 5-优化** | 性能 + Android 适配 | 顶点数上限 / 降频 / LOD | 桌面 60fps, Android 30fps |

### 4.2 文件规划

```
frontend/src/
  scene/physics/
    skirt-analyzer.ts      # Phase 1: 拓扑分析（纯几何，无依赖）
    virtual-skirt.ts       # Phase 2-3: WASM Bullet 注入 + 回写
  __tests__/
    skirt-analyzer.test.ts  # Phase 1 单测
  menus/
    motion-skirt-levels.ts  # Phase 4 UI
```

**设计约束**：`virtual-skirt.ts` 不被 `scene.ts` 启动期 eager 导入（ADR-081 教训）。仅通过用户显式开启时按需 `await import()`。

### 4.3 参数体系

```typescript
interface VirtualSkirtConfig {
    enabled: boolean;          // 开关
    chains: number;            // 链数（默认 12, 范围 4-32）
    segmentsPerChain: number;  // 每链骨节数（默认 8, 范围 4-16）
    stiffness: number;         // 弹簧刚度（默认 50, 范围 10-200）
    damping: number;           // 弹簧阻尼（默认 0.3, 范围 0-1）
    mass: number;              // 单骨节质量（默认 0.05, 范围 0.01-0.5）
    radius: number;            // 碰撞球半径（默认 auto, 按 mesh 尺寸推算）
    maxVertices: number;       // 顶点数上限（性能保护, 默认 2000）
}
```

---

## 五、风险评估

| 风险 | 严重度 | 说明 | 缓解 |
|------|--------|------|------|
| **MMD 物理管线冲突** | 🟡 中 | MMD runtime `beforePhysics/afterPhysics` 管控骨骼更新; 我们的 vertex buffer 写入需在 `afterPhysics` 之后执行 | `PerFrameUpdateRegistry` 在 `onBeforeRenderObservable` 中注册, MMD 物理在 `onBeforeAnimations`/`onAfterPhysics` 阶段, 时序应正确; POC 需验证 |
| **双重位移** | 🟡 中 | 模型可能已有部分裙骨, 自动生成的刚体与已有物理叠加 | Phase 1 先检测骨骼名 `/skirt\|裾\|スカート/i`, 已有裙骨则跳过 |
| **拓扑分析不准** | 🟡 中 | 并非所有 PMX 模型的裙摆都有清晰 boundary edge | 多策略 fallback: 边缘检测 → 骨骼名匹配 → 按 Y < 30% 强制截取 |
| **性能** | 🟡 中 | 每帧 vertex buffer 更新; 大模型可能 >2000 顶点 | `maxVertices` 上限 + LOD 降级 + Android 降频 |
| **worldId 冲突** | 🟢 低 | WASM Bullet 用 worldId 隔离物理世界; 注入刚体需用正确 worldId | 从 MmdWasmRuntime 获取 model 对应的 worldId |
| **dispose 链路** | 🟡 中 | 刚体/约束/ConstructionInfo 需按序 dispose, 且需从物理世界 remove 后才能 dispose | 封装 `disposeVirtualSkirt()`: removeConstraint → removeRigidBody → rb.dispose → shape.dispose → info.dispose |

---

## 六、与受影响 ADR 的关系

| ADR | 关系 | 处置 |
|-----|------|------|
| ADR-054 | P2 路线图第 4 项 | 路线图条目更新引用本 ADR |
| ADR-081 | XPBD 移除后 `physics-bridge.ts` 保留 | 直接复用 `physics-bridge.ts` 的 `PerFrameUpdateRegistry` + `autoFitAttachment` + `findRuntimeBone` |
| ADR-019 | XPBD 布料选型（已废弃） | 本 ADR 完全替代, 不复活 XPBD |
| ADR-029 | 物理 UI 重构 | 新增 `motion-skirt-levels.ts` 遵循 ADR-029 的物理分治模式 |
| ADR-043 | 竞品差距 D 类 | 补齐 DanceXR 的 Mesh-to-Cloth 差距 |

---

## 七、验证计划

```bash
# Phase 1 单测
cd frontend && npx vitest run src/__tests__/skirt-analyzer.test.ts

# 类型检查
cd frontend && npm run check

# 全量单测不回归
cd frontend && npm run test

# 运行时验证
# 1. 加载无裙骨模型 → 开启虚拟裙骨 → 裙摆可见飘动
# 2. 加载有裙骨模型 → 开启虚拟裙骨 → 自动跳过(不叠加)
# 3. 切换模型 → 旧刚体正确 dispose, 无泄漏
```

---

## 八、代码审核记录（2026-07-11）

审核结论：**有条件通过**。三条意见处置如下：

| 级别 | 位置 | 意见 | 处置 | 状态 |
|------|------|------|------|------|
| 🟡 P2 | ADR §3.3 | `setInitialTransform` 是否真实存在未核实 | 已核实：`rigidBodyConstructionInfo.d.ts:48` 声明 + `.js:181` 真实实现（写入 WASM 初始变换）。原实现正确，**无需改** | 误报消除 |
| 🟡 P3 | virtual-skirt.ts:272 | 每帧 `new Float32Array(16)` 产生 GC 压力 | 改为类成员缓存：`_tmpArray`（16）+ `_workBuf`（顶点工作缓冲，按 `rest.length` 惰性分配后每帧 `.set()` 复用）；`dispose()` 中置 `null` | ✅ 已修 |
| 🟢 P4 | ADR §3.4 | 伪代码用 `segments[i].restX`，代码用 `seg.restPosition[0]` | ADR §3.4 伪代码对齐实现：`restPosition[0/1/2]` + 嵌套链循环 + 平行数组权重 + 缓存缓冲复用；§3.3 `seg.restMatrix` 占位字段同步改为 `Matrix.Translation(restPosition)` | ✅ 已修 |

**验证**：`npm run check`（改动文件零类型错误）+ `vitest` 31/31 通过。
