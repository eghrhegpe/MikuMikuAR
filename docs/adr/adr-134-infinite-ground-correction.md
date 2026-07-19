# ADR-134: 无限地面方案修正 — 废弃相机跟随，扩大地面尺寸范围

| 字段 | 值 |
|------|------|
| **状态** | 已采纳 |
| **日期** | 2026-07-19 |
| **作者** | Riku（首席架构师 AI） |
| **前置 ADR** | ADR-133（Android MPR 缺口） |

## 背景

无限地面功能在 v1.5.3 发布说明中标记为 ADR-134 Phase 1，但实际实现存在两个问题：

1. **相机跟随 lerp 方案未实现**：`_groundInfinitePrevX` / `_groundInfinitePrevZ` 变量已预留（用于 UV 补偿计算），但 `tickGround()` 中没有任何相机追踪逻辑。这些变量是死代码。
2. **地面尺寸过小**：`groundSize` 范围 `60–200` 在无限模式下仍不够大，远处可见地面边缘。

## 决策

### 1. 废弃相机跟随方案

无限地面改为**固定大 mesh + 纹理世界空间平铺**，不再跟随相机移动。

- 移除 `_groundInfinitePrevX` / `_groundInfinitePrevZ` 变量（从未被引用）。
- `tickGround()` 中不执行 mesh 位置更新。
- 纹理 UV 偏移仅由 `groundScrollSpeedX/Z` 驱动（已有逻辑），不受相机位置影响。

**理由**：
- 预留变量无消费者，属于半成品 stub。
- 相机跟随 + UV 补偿方案复杂度高（需每帧计算 mesh delta → UV offset），但收益有限——固定大 mesh 已覆盖相机视锥。
- 纹理世界空间平铺（UV 不依赖 mesh 位置）在视觉上已足够无缝。

### 2. 扩大地面尺寸范围

`groundSize` 范围从 `60–200` 扩大到 `60–500`。

- 无限模式下 `meshSize = INFINITE_GROUND_SIZE = 2000`（固定不变，不受此范围影响）。
- 非无限模式下，用户可将地面扩展到 500 单位，避免远处边缘穿帮。

**UI 变更**：`env-feature-levels.ts` 中 `groundSize` slider 的 `max` 从 200 改为 500。

## 影响

| 文件 | 变更 |
|------|------|
| `frontend/src/scene/env/env-ground.ts` | 移除 `_groundInfinitePrevX/Z` 变量及重置逻辑（L244-245, L817-818） |
| `frontend/src/menus/env-feature-levels.ts` | `groundSize` slider `max: 200` → `max: 500` |

## 备选方案（已否决）

| 方案 | 否决理由 |
|------|---------|
| 实现完整的相机跟随 lerp + UV 补偿 | 复杂度高，收益低；固定大 mesh + 世界空间 UV 已足够 |
| 使用 Babylon.js `InfiniteParameter` 内置方案 | 仅支持 StandardMaterial，与 PBR 材质不兼容；且项目已有自研纹理滚动逻辑 |
