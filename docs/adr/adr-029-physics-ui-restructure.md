# ADR-029: 物理设置界面重构 — 从布料单页到双系统分治

> **状态**: 已实现
> **日期**: 2026-07-05
> **关联**: ADR-019 (XPBD 布料模拟), ADR-007 (场景菜单设计), ADR-027 (菜单响应式系统)

---

## 0. 问题陈述

物理设置原本分布在两个位置，均存在可用性问题：

| 位置 | 内容 | 问题 |
|------|------|------|
| 动作菜单 → 物理 → 布料子页 | 布料参数 + 调试 + 变换 | 296 行单页过于臃肿；调试可视化埋没在布料参数中；变换与模型详情页重复 |
| 动作菜单 → 模型详情卡片 | WASM 物理分类开关 | 藏在模型行双击弹窗内，无独立导航入口；无 WASM 主开关 UI |

此外，物理设置挂在「动作」菜单下概念错误——物理（重力、碰撞、模拟速度）是**场景级全局属性**，不因动作播放/切换而变化。

---

## 1. 决策概览

四次迭代，累计改动 7 个文件：

| 迭代 | 内容 | 文件数 |
|------|------|--------|
| 1. 调试剥离 | 从布料子页提取调试到独立子页 | 2 |
| 2. 根页重构 | 布料主开关/重力/求解质量/模拟速度/碰撞主从/精细调节 | 5 |
| 3. WASM 补全 | 新增 WASM 物理子页（主开关+分类toggle） | 1 |
| 4. 搬迁到场景 | 完整搬迁 + 文件重命名 | 3 |

---

## 2. 迭代一：调试剥离

### 动机

布料子页 `motion-cloth-levels.ts` 包含 6 个 collapsible 区，其中「调试」区负责材质线框/骨骼线/骨骼关节/粒子球/约束线/碰撞体线框等可视化开关——这些与布料参数（形状/物理/细分）无直接关系。

### 决策

将调试可视化从布料子页提取为**物理根页下的独立调试子页**。

```
改前: 动作 → 物理 → 布料 → [折叠] 调试
改后: 动作 → 物理 → 调试 → 6 toggle 平铺
```

### 要点

- 调试仍留在物理域内（未搬去模型详情页），保持上下文聚集
- 无重复代码，无新增依赖

---

## 3. 迭代二：根页重构

### 动机

物理根页原入口仅一个「布料模拟」folder，用户必须先进入 folder 才能看到参数。布料模拟的产能瓶颈在于预设 chip（两行 8 个）而非参数 slider，根页的 `headerToggle + folder` 模式增加了不必要的导航深度。

同时，以下物理参数需要全局可见：

| 参数 | 原位置 | 新位置 |
|------|--------|--------|
| 布料开关 | headerToggle 藏在 folder | 根页独立 toggle |
| 重力强度 | 无全局 UI（仅 WASM 内部调参） | 根页 slider #1 |
| 求解迭代数 | 布料子页参数折叠 | 根页 slider |
| 模拟速度 | 不存在 | 根页 slider (NEW) |
| 碰撞开关 | 不存在（地面碰撞在 cloth-manager 内部） | 根页 folder + 主从 toggle |

### 决策

```
布料模拟  [toggle]          ← 独立主开关
├─ 重力强度  1.0            ← WASM Bullet + XPBD 统控
├─ 求解质量  4              ← 原名「求解迭代」
├─ 模拟速度  1.0            ← 时间缩放 0.1x~5x (NEW)
├─ 🛡 碰撞   [folder+toggle]
│  ├─ 地面碰撞  [toggle]    ← 现读 envState
│  └─ 身体碰撞  [toggle]    ← NEW: XPBD 布料-身体碰撞
├─ 精细调节    [→]          ← renamed from 布料（容纳后续非布料物理参数）
└─ 调试        [→]          ← from 迭代一
```

### 技术细节

- `envState.solverTimeScale`: 新增字段，在 `xpbd-cloth.ts` 的 `buildClothUpdateFn` 闭包内乘以 dt
- `envState.collisionEnabled / bodyCollisionEnabled / groundCollisionEnabled`: 碰撞主从状态，`cloth-manager._applyCollisionState()` 计算有效开关
- 重力 slider 同时调用 `setGravityStrength()`（WASM Bullet）和 `setClothGravity()`（XPBD），实现双系统统控
- `timeScale` 通过回调注入 `buildClothUpdateFn`，避免循环依赖

---

## 4. 迭代三：WASM 物理子页

### 动机

重构后物理根页仍只有 XPBD 布料设置，WASM Bullet 物理（骨骼刚体物理）的开关隐藏在模型详情弹窗中。用户没有统一入口查看/控制 WASM 物理状态。

### 决策

在物理根页新增「WASM 物理」folder 子页：

```
WASM 物理 [→]
├─ 模型物理  [toggle]       ← setModelPhysics(id, enabled)
├─ 裙子物理  [toggle]       ← setPhysicsCategory(id, 'skirt', enabled)
├─ 胸部物理  [toggle]       ← setPhysicsCategory(id, 'chest', enabled)
├─ 头发物理  [toggle]       ← setPhysicsCategory(id, 'hair', enabled)
├─ 配件物理  [toggle]       ← setPhysicsCategory(id, 'accessory', enabled)
```

仅在有聚焦模型时显示具体 toggle，否则显示提示行。

### 局限

WASM Bullet 物理（`babylon-mmd` 的 `MmdWasmPhysics`）仅暴露 `rigidBodyStates: Int32Array`（每个刚体的 0/1 开关），无 stiffness/damping/friction 等参数的运行时 API。当前 UI 已覆盖 100% 可用 API。

---

## 5. 迭代四：搬迁到场景菜单

### 动机

物理是**场景级全局属性**——重力、碰撞、模拟速度不因动作或模型切换而变化。挂在「动作」菜单下概念错误，且动作菜单以模型/动作文件操作为主，物理设置与上下文无关。

### 决策

将物理设置从动作菜单完整搬迁到场景菜单：

```
改前: 动作 → 物理 → ...
改后: 场景 → 物理 → ...
```

附带操作：

- 文件重命名 `motion-physics-levels.ts` → `scene-physics-levels.ts`
- `getMotionMenu()` → `getSceneMenu()`, `refreshMotionRoot()` → `refreshSceneRoot()`
- 从 `motion-popup.ts` 移除 `scene:physics` 路由和物理 folder 条目
- 在 `scene-menu.ts` 新增 `scene:physics` 路由和物理 folder 条目
- 清理含 `onFolderEnter` 的 `PopupLevel` 返回对象（该字段不在类型定义中，路由已由 SlideMenu 构造参数处理）

### 最终导航结构

```
场景
├─ 预设场景
├─ 保存场景
├─ 后处理
├─ 舞台
├─ 物理
│  ├─ 重力强度（WASM + 布料）  [slider]
│  ├─ WASM 物理                [→]
│  │  ├─ 模型物理主开关         [toggle]
│  │  ├─ 裙子/胸部/头发/配件     [toggle × 4]
│  ├─ 布料模拟                  [toggle]
│  ├─ 求解质量                  [slider]
│  ├─ 模拟速度                  [slider]
│  ├─ 碰撞                      [folder + toggle]
│  │  ├─ 地面碰撞               [toggle]
│  │  └─ 身体碰撞               [toggle]
│  ├─ 精细调节                  [→] (原布料参数子页)
│  └─ 调试                      [→]
│     ├─ 材质线框/骨骼线/关节球   [toggle × 3]
│     └─ 粒子球/约束线/碰撞体线框 [toggle × 3]
├─ 截图
```

---

## 6. 影响范围

| 文件 | 改动 |
|------|------|
| `frontend/src/core/config.ts` | EnvState 新增 4 字段 |
| `frontend/src/physics/cloth-manager.ts` | 新增 timeScale/collision/gravity API + `_applyCollisionState` |
| `frontend/src/physics/xpbd-cloth.ts` | 闭包接收 getTimeScale 回调 |
| `frontend/src/menus/motion-popup.ts` | 移除物理 folder + 路由 |
| `frontend/src/menus/scene-menu.ts` | 新增物理 folder + 路由 |
| `frontend/src/menus/motion-cloth-levels.ts` | 移除重力倍率 preset；更新 import 路径 |
| `frontend/src/menus/motion-physics-levels.ts` | **重命名 → scene-physics-levels.ts** |
| `frontend/src/menus/scene-physics-levels.ts` | 重构根页 + buildCollisionLevel + buildWasmPhysicsLevel + buildPhysicsDebugLevel |

---

## 7. 未解决的问题

| 问题 | 原因 | 后续方向 |
|------|------|---------|
| WASM 物理无参数级调参 | babylon-mmd 运行时仅暴露刚体 0/1 开关，无 stiffness/damping/friction API | 需上游 PR 或自行 hack WASM 内存 |
| 碰撞主从开关仅作用 XPBD | WASM Bullet 无独立碰撞 toggle（只有主物理开关和分类开关） | 若 WASM 未来暴露碰撞组掩码，可接入 |
| 布料/非布料物理参数混在同一个「精细调节」 | 当前只有布料子页，未来可能有非布料 XPBD 参数 | 子页拆分留给后续演进 |

---

## 8. 验证

- `tsc --noEmit` 通过（仅预存测试 mock 错误，无源代码错误）
- `vite build` 通过（~1.5s，仅 babylon.js 预存 chunk size warning）
- 运行时：所有物理 toggle/slider 正确读写 envState，重力同时影响 WASM + XPBD，碰撞主从级联有效
