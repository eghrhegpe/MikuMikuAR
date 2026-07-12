# ADR-083: 地面功能扩展 —— 反射/倾斜/纹理滚动/高程着色/跟随网格/图案扩展/法线贴图

> **状态**: 已交付 — Phase A + Phase B 全部实施完成；terrain 倾斜于 2026-07-12 追加支持（坐标变换方案）

## 1. 背景

地面系统已迭代多轮（ADR-026 纹理地面 → ADR-052 模式增强 + heightmap → 当前边缘淡出落地）。但地面仍是「静态方块」形态，缺少动效、反射和几何自由度。

用户提案 9 项扩展，本 ADR 记录采纳/暂缓决策与架构方案。

## 2. 决策一览

| # | 提案 | 决策 | 理由 |
|---|------|------|------|
| 1 | **边缘淡出** | ✅ **已落地** | `groundEdgeFade` 参数 + 径向渐变 opacityTexture + UI 滑块 + bridge key，ADR-083 发布时已存在于代码中 |
| 2 | **镜面反射** | ✅ **Phase B** | `MirrorTexture` planar reflection，复用 ADR-062 的水面反射模式 |
| 3 | **坡度/倾斜** | ✅ **Phase A**（2026-07-12 追加 terrain 支持） | `ground.rotation.x/z` = pitch/roll；terrain 模式额外做坐标变换补偿高度查询（见 §9） |
| 4 | **纹理滚动** | ✅ **Phase A** | 复用 `ensureEnvUpdateObserver` 的每帧循环，`uOffset/vOffset` 累加 |
| 5 | **高度图按高程着色** | ✅ **Phase B** | 需重写 `applyTerrainMaterial` 为 gradient ramp 或 per-vertex color |
| 6 | **无限跟随网格** | ✅ **Phase B** | Grid 模式每帧重定位到相机下方，需处理 shadow/collision Y 保持 |
| 7 | **程序化图案扩展** | ✅ **Phase A** | 在 `applyCheckerGround` 的 canvas 分支加 pattern 枚举（圆点/条纹/径向渐变） |
| 8 | **法线贴图** | ✅ **Phase B** | texture 模式加 `bumpTexture`，需 `groundNormalTexture` / `groundNormalStrength` 字段 |
| 9 | **碰撞体摩擦/弹性** | 🚫 **封存** | ADR-029 §7 已记录：WASM Bullet 无 friction/restitution 运行时 API。等上游 babylon-mmd 暴露或自行 hack WASM 内存 |

## 3. EnvState 新增字段

```typescript
// Phase A
groundPitch: number;         // X 轴旋转（度），默认 0，范围 -45..45
groundRoll: number;          // Z 轴旋转（度），默认 0，范围 -45..45
groundScrollSpeedX: number;  // 纹理 X 方向滚动速度，默认 0，范围 -2..2
groundScrollSpeedZ: number;  // 纹理 Z 方向滚动速度，默认 0，范围 -2..2
groundPattern: 'checker' | 'dots' | 'stripes' | 'radial'; // 程序化图案类型，默认 'checker'

// Phase B
groundReflectionBlend: number;     // 镜面反射混合度，0=无，1=全反射，默认 0
groundReflectionQuality: 'high' | 'medium' | 'low' | 'off'; // 反射质量
groundNormalTexture: string;       // 法线贴图路径
groundNormalStrength: number;      // 法线强度，默认 1
groundElevationColoring: boolean;  // 高度图按高程着色开关，默认 false
groundFollowCamera: boolean;       // 网格模式跟随相机，默认 false
```

## 4. 架构变更

### 4.1 Phase A（低工作量）

| 文件 | 变更 | 说明 |
|------|------|------|
| `core/types.ts` | EnvState +5 字段 | groundPitch, groundRoll, groundScrollSpeedX, groundScrollSpeedZ, groundPattern |
| `scene/env/env-impl.ts` | `applyGround()` | 创建后设 `ground.rotation.x/z` = pitch/roll；原地更新分支追加 rotation 写入 |
| `scene/env/env-impl.ts` | `ensureEnvUpdateObserver()` | 每帧累加 texture `uOffset/vOffset` 按 scroll speed；与纹理旋转叠加（旋转为基准偏移，滚动在其上累加） |
| `scene/env/env-impl.ts` | `applyCheckerGround()` | 新增 pattern 分支（dots/stripes/radial）；重命名为 `applyProceduralGround` |
| `scene/env/env-impl.ts` | typeKey | `groundPattern` 加入 typeKey（触发重建）；`groundPitch/groundRoll/groundScrollSpeedX/Z` 不加入 typeKey（走增量更新） |
| `scene/env/env-bridge.ts` | groundKeys | +5 个 Phase A 字段 |
| `menus/env-feature-levels.ts` | `buildGroundLevel()` | 加 4 个 slider + 1 个 modeSlider；heightmap 模式下禁用 pitch/roll 滑块（后于 2026-07-12 修订：移除禁用，所有模式均支持倾斜） |
| `docs/adr/adr-047-config-persistence-coverage.md` | 同步 | 追加新字段到表格 |

### 4.2 Phase B（中等工作量）

| 文件 | 变更 | 说明 |
|------|------|------|
| `core/types.ts` | EnvState +5 字段 | groundReflectionBlend, groundReflectionQuality, groundNormalTexture, groundNormalStrength, groundElevationColoring, groundFollowCamera |
| `scene/env/env-impl.ts` | `applyGround()` | texture 分支加 `bumpTexture`；grid 分支加 follow-camera 每帧重定位 |
| `scene/env/env-impl.ts` | `buildGroundReflection()` | 新函数：创建 MirrorTexture，挂到 ground material |
| `scene/env/env-terrain.ts` | `applyTerrainMaterial()` | 重写：per-vertex color 或 gradient ramp texture |
| `scene/env/env-bridge.ts` | groundKeys | +6 个 Phase B 字段 |
| `menus/env-feature-levels.ts` | `buildGroundLevel()` | 反射折叠面板 + 法线贴图行 + 高程着色 toggle + 跟随 toggle |

## 5. 技术细节

### 5.1 镜面反射（Phase B）

与 ADR-062 水面反射类似，但目标不同：

- 水面 planar RT 的 `renderList` 含 sky/env/ground + **模型**（不含水面自身）
- 地面 planar RT 的 `renderList` 含 sky/env + **模型**（不含地面自身）
- 质量选项控制 RT 分辨率：high=1024², medium=512², low=256², off=无

**互斥机制**：地面反射与水面反射不可同时启用（GPU 开销 + render target 竞争）。采用**代码层互斥守卫 + UI 提示**方案：
- `applyGround()` 中若 `groundReflectionQuality !== 'off'`，则调用 `disableWaterReflection()` 关闭水面反射
- `applyWater()` 中若水面反射开启，则设置 `groundReflectionBlend = 0` 并通知 UI
- UI 层在开启一方时显示「已自动关闭另一方」的提示（toast 或行内标注）
- 各自 RT 资源独立创建/销毁，互斥仅在状态层做仲裁，不共享 RT 实例

### 5.2 坡度与 heightmap 的交互

> **修订注记（2026-07-11）**：原方案声称 `getHeightAtCoordinates` 在旋转后自动返回世界坐标，此结论错误。Babylon `GroundMesh.getHeightAtCoordinates(x, z)` 基于**本地** heightmap 数据查询，不考虑 mesh 的 world matrix 变换。若 ground 有 rotation，世界坐标 (x,z) 处的地形高度与本地高度不一致，会导致模型贴地错位。

修正方案：**heightmap 模式下禁用 pitch/roll**，原因：
1. `getGroundHeightAt()` 需做坐标逆变换（世界 → 本地 → 查询 → 世界），引入额外矩阵运算与精度损失
2. 物理碰撞体（GroundMesh 自带）的碰撞查询同样基于本地坐标，旋转后物理碰撞与视觉错位
3. heightmap 本身已有起伏，再加整体倾斜语义模糊（用户更可能想调「地形朝向」而非整体倾斜）

实施细节：
- solid/grid/checker/texture 模式：支持 pitch/roll，`ground.rotation.x/z` 直接设置
- heightmap 模式：pitch/roll 固定为 0，UI 滑块禁用并提示「高度图模式下不支持倾斜」
- `getGroundHeightAt()` 保持现有实现，heightmap 模式下 ground 无旋转，坐标天然对齐

> **修订注记（2026-07-11 补）**：平面模式的贴地 gap 已修复。
> 根因：`GroundMesh.getHeightAtCoordinates`（groundMesh.pure.js:83）在世界变换时只对 `(0, y, 0)` 取 y 分量，
> 丢弃局部 x/z 偏移，倾斜后只返回 `position.y`，导致脚悬空/穿模（与 5.2 中 heightmap 的坐标错位同源，
> 但平面模式是**真实功能缺失**，非 heightmap 的规避项）。
> 修复：`getGroundHeightAt()` 在平面模式改为按世界平面方程 `N·(X-P0)=0` 解析求高（见 `env-impl.ts`），
> 无倾斜时退化为 `groundLevel`，与改动前一致，零回归；heightmap 仍走原生采样（恒水平，安全）。
>
> **配套修复（2026-07-11 补）**：仅修 `getGroundHeightAt` 不够——模型根节点 `rootMesh.position.y`
> 只在 spawn 与 heightmap onReady 时设置（`model-loader.ts`），运行时改 groundLevel/pitch/roll 不会重贴地，
> 故角色脚底不随地面变化（水平放置时「贴地」仅在 spawn 一刻成立，动态改高度即失效）。
> 修复：新增 `setOnGroundChanged` 回调，`applyGround` 原地分支对 `groundLevel/pitch/roll` 做变更检测
> （沿用 `_prevX` 模式，每帧调用但仅变化时触发），变化时 `model-loader` 重贴地所有已加载模型。
> 此触发器是 tilt 修复与「groundLevel 滑块实时生效」共同缺失的一环。

### 5.3 跟随网格（Phase B）

```typescript
// 每帧执行
if (state.groundMode === 'grid' && state.groundFollowCamera) {
    const cam = scene.activeCamera;
    if (cam) {
        ground.position.x = cam.position.x;
        ground.position.z = cam.position.z;
        ground.position.y = state.groundLevel; // Y 保持固定
    }
}
```

注意：
- 仅 grid 模式支持跟随（solid/checker/texture/heightmap 有视觉边界，跟随会暴露边缘）
- shadow 投射和物理碰撞的 Y 高度不变
- groundSize 在跟随模式下可缩小到 40（无需覆盖全场景），降低 GPU 负载

### 5.4 程序化图案扩展（Phase A）

在 `applyProceduralGround`（原 `applyCheckerGround` 重命名）的 canvas 绘制分支扩展：

```typescript
switch (state.groundPattern) {
    case 'checker': // 现有逻辑
    case 'dots':
        // 绘制圆点阵：ctx.arc(x + tileSize/2, y + tileSize/2, tileSize/3, 0, PI*2)
    case 'stripes':
        // 绘制条纹：ctx.fillRect(x, y, tileSize * 0.4, tileSize) 交替
    case 'radial':
        // 径向渐变从中心向外
}
```

不引入新文件，所有图案在 `applyProceduralGround` 内部以 canvas 2D 完成。

**纹理滚动与纹理旋转的共存方案**：

当前 `groundTextureRotation` 通过修改 `uOffset/vOffset` 模拟旋转（中心对齐偏移），滚动也通过 `uOffset/vOffset` 累加实现。两者都写同一组 offset，直接叠加会冲突。

修正方案：**旋转为基准偏移，滚动在其上累加**。具体实现：

1. 存储模块级累计滚动偏移量 `_groundScrollU` / `_groundScrollV`（每帧由 `ensureEnvUpdateObserver` 累加）
2. 计算基准旋转偏移量（由 `groundTextureRotation` 角度算出）：
   ```
   baseU = 0.5 * (1 - cos) + 0.5 * sin
   baseV = 0.5 * (1 - cos) - 0.5 * sin
   ```
3. 每帧最终 offset = 基准旋转偏移 + 累计滚动偏移（取模 1.0）
4. `applyGround()` 的原地更新分支也遵循同一公式

适用范围：checker 模式（`applyProceduralGround` 生成的纹理）和 texture 模式（外部纹理）。grid 模式（GridMaterial）不支持纹理滚动。

### 5.5 typeKey 增量更新规则（Phase A 补充）

`applyGround()` 通过 `_currentGroundKey` 判断是否需要重建地面。typeKey 变更 → 重建；typeKey 不变 → 走原地更新分支。新增字段需明确哪些加入 typeKey：

| 字段 | 是否加入 typeKey | 原因 |
|------|-----------------|------|
| `groundPattern` | ✅ 是 | checker 模式下图案变更需重新生成 canvas 纹理，必须重建材质 |
| `groundPitch` | ❌ 否 | 可原地修改 `ground.rotation.x`，无需重建 |
| `groundRoll` | ❌ 否 | 可原地修改 `ground.rotation.z`，无需重建 |
| `groundScrollSpeedX` | ❌ 否 | 每帧动态偏移由 observer 驱动，与重建无关 |
| `groundScrollSpeedZ` | ❌ 否 | 同上 |

**heightmap 模式的 typeKey** 不加入 pitch/roll（pitch/roll 走原地更新分支，无需重建）。

> **2026-07-12 修订**：heightmap 模式不再禁用倾斜，pitch/roll 对 terrain 同样生效，由坐标变换补偿高度查询。

**原地更新分支需追加**：
- `ground.rotation.x = groundPitch * PI / 180`（所有模式生效）
- `ground.rotation.z = groundRoll * PI / 180`（所有模式生效）
- texture/checker 模式下，调用 `_syncGroundTextureOffset()` 统一处理旋转+滚动偏移

## 6. 未解决的问题

| 问题 | 原因 | 后续方向 |
|------|------|---------|
| 高度图按高程着色精度 | per-vertex color 受 subdivisions 限制 | 可升级到 ShaderMaterial 片元级着色（无需增加顶点） |
| WASM 碰撞摩擦/弹性 | ADR-029 §7 记录：无运行时 API | 等上游 PR 或 hack WASM 内存 |
| 纹理旋转的实现方式 | 当前用 uOffset/vOffset 模拟旋转，非真正 UV 旋转，与滚动叠加时非严格数学正确 | 未来可改用 Texture.uAng/vAng 或自定义 UV 矩阵（需验证 Babylon 支持度） |
| 地形倾斜后物理碰撞 | GroundMesh 自带碰撞基于本地坐标，旋转后与视觉轻微错位 | 可自行实现碰撞查询的坐标变换，或等 Babylon 上游修复 |

## 7. 引用 ADR

- ADR-026: 环境系统增强（纹理地面）
- ADR-029: 物理设置界面重构（WASM 无 friction API 的记录来源）
- ADR-052: 地面模式增强（网格/第二色/高度/纹理旋转 + heightmap）
- ADR-062: 水面反射渲染目标（planar RT 模式复用）
- ADR-047: 配置持久化覆盖（需追加新字段）

## 8. 修订注记（2026-07-11）

> **地面模式分类重构**：原 `groundMode` 单枚举（solid/grid/checker/texture/heightmap）已拆分为两轴——
> `groundType`('flat'|'terrain') + `groundStyle`('solid'|'grid'|'checker'|'texture')。
> 背景与方案见 **ADR-089**。
> 本 ADR 中「heightmap 模式」一律等价于新模型的 `groundType === 'terrain'`；「非 heightmap 模式」等价于 `groundType === 'flat'`。
> 旧配置经 `setEnvState` 内的 `migrateEnvState()` 自动映射，无需手动迁移。

## 9. 修订注记（2026-07-12）

> **地形倾斜追加支持**：此前 §5.2 以 3 条理由禁用 heightmap 模式的 pitch/roll，现实现坐标变换方案正式解禁：
>
> **核心方案**：`getGroundHeightAt()` 在 terrain 有非零 pitch/roll 时，做 **世界→本地→查询→本地→世界** 四步坐标变换：
> 1. 求 mesh 逆世界矩阵，将世界 (x, z) 变换到本地空间
> 2. 调用 `getHeightAtCoordinates(localX, localZ)` 获得本地高度
> 3. 将结果点 `(localX, localHeight, localZ)` 用世界矩阵变换回世界坐标
> 4. 返回世界 Y
>
> 无倾斜时退化到直接查询（零额外开销），与改动前行为一致。
>
> **配套变更**：
> - `env-impl.ts`：添加 `Matrix` 导入 + 3 个模块级缓存变量（`_terrainInvWorld`/`_terrainLocalPos`/`_terrainWorldPos`），避免每帧 allocate
> - `env-impl.ts` `applyGround()`：移除更新分支中 `groundType !== 'terrain'` 守卫，pitch/roll 原地写入所有模式
> - `env-terrain.ts` `createHeightmapGround()`：onReady 回调中设置 `gm.rotation.x/z`
> - `env-feature-levels.ts`：移除 pitch/roll 滑块上的 `visibleWhen: () => envState.groundType !== 'terrain'` 条件守卫
> - 模型贴地：`setOnGroundChanged` 已检测 pitch/roll 变化并触发重贴地，`model-loader` 调用 `getGroundHeightAt()` 走坐标变换路径
>
> **风险与限制**：
> 1. 物理碰撞体（GroundMesh 自带）仍基于本地坐标；旋转后碰撞查询与视觉可能轻微错位——但 terrain 本身起伏大，微小旋转下此差异可忽略；若需精确碰撞，需等 Babylon 上游修复或自行实现坐标变换
> 2. `getHeightAtCoordinates` 每 query 做一次矩阵求逆 + 2 次坐标变换，仅在地面变化时触发，不构成性能瓶颈
