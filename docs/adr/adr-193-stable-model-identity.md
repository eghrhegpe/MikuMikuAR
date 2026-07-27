# ADR-193: 模型稳定身份（inst.id = 持久化 uuid）

> **状态**: 已立项 · 已实现（2026-07-27 — tsc 零错误；resolve-model-id 5 + replace-model-inherit 16 + material-editor 50 + lighting-follow 8 + env-lighting 22 + scene-serialize-undo 6 全绿）
> **日期**: 2026-07-27（初版）
> **关联**: ADR-150（替换继承链）、ADR-168（个人灯默认关）、ADR-182（纹理命名空间）
> **来源**: 用户复现「再次载入场景后服饰/outfit/个人灯全部回到默认开启」；缓存目录 `last_scene.json` 实测无任何模型含 `materialEnabled/outfitVariant/personalLight` 字段。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-27

---

## 背景

模型运行时 id 由 `model-loader.ts` 以 `model_${Date.now()}_${Math.random()}` 生成，**每次加载/替换/恢复都重新生成**。而材质可见性（`material.ts` 的 `_matEnabled/_catState/_matState`）、个人灯（`lighting-follow.ts` 的 `_entries`）、outfit（`inst.activeVariant`）等"富状态"全部以该易变 `inst.id` 为 key 落盘。

导致两类缺陷：

1. **跨会话还原错位**：`serializeScene` 在条目里写 `uuid`（经 `modelUuidMap` 生成/映射），`deserializeModels` 恢复时却用 `loadPMXFile` 重新生成的随机 id，使 `modelUuidMap` 仅用于序列化/反查，状态 map 的 key 始终是新随机 id。虽然 `materialEnabled` 等字段挂在模型条目内（不按 uuid 索引）使恢复在"同一次保存"内可还原，但**一旦保存时刻状态 map 的 key 与恢复后实例 id 不一致，状态即丢失**。
2. **替换/重载丢状态**：替换角色或同会话重加载同模型时，旧实例 `remove` 触发 `disposeModelMaterialState(oldId)` 清空旧 key，新实例用新随机 id、状态 map 为空 → 落盘不含富状态字段。

实测 `last_scene.json`：所有模型条目仅含 `position/scaling/visible/...` 基础字段，`materialEnabled/materialCategories/materialOverrides/outfitVariant/personalLight/boneOverrides/feet` **全部缺失**（Grep 零匹配），证实保存时 `getMatState(inst.id)` 等对易变 id 的读取返回了空。

## 决策

**让 `inst.id` 直接等于已持久化的稳定 uuid**，消除中间映射层：

1. 新增纯函数 `resolveModelId(preferredId?)`（`scene/manager/model-id.ts`，零 Babylon 依赖）：`preferredId ? preferredId : generateUuid()`。替代原 `model_${Date.now()}_${random}`。
2. `loadPMXFile` 新增可选第 7 参 `preferredId`，`id = resolveModelId(preferredId)`。
3. `serializeScene` 模型 `uuid` 字段直接取 `inst.id`（不再经 `modelUuidMap.get/set`）。
4. `deserializeModels` 恢复时对每个模型调用 `loadPMXFile(resolvedPath, …, m.uuid)`——把存档 `uuid` 作为 `preferredId` 传入，使恢复后实例 `id` 与保存时完全一致。
5. **移除 `modelUuidMap`**：其全部用途（序列化生成 uuid、props 的 `targetModelUuid` 跨引用、accessory 恢复按 uuid 反查）改用 `inst.id` 直连——
   - props `targetModelUuid: p.targetModelId ?? undefined`；
   - accessory 恢复 `targetModelId = p.targetModelUuid` 并 `modelRegistry.has` 守卫。
   - `propUuidMap` 保留（道具本次范围外，仍走原 uuid 机制）。

## 状态管理不变量（重申）

- **材质/纹理/个人灯是角色专属状态**，不进入替换继承链（ADR-150 已排除），也不跨模型共享；本次仅将其存储 key 从易变 id 改为稳定 uuid，语义不变。
- 恢复后 `applyMatState(inst.id, entry.materialEnabled)` / `setPersonalLightState(inst.id, …)` / `inst.activeVariant = m.outfitVariant` 均按稳定 id 还原，跨会话一致。
- 关闭时 `cleanupAndFlushSave()`（visibilitychange/beforeunload）已强制即时落盘，与本次改动正交、互不冲突。

## 影响面与验证

| 改动文件 | 内容 |
|---------|------|
| `scene/manager/model-id.ts` | 新增 `resolveModelId`（纯函数，可单测） |
| `scene/manager/model-loader.ts` | 引入 `resolveModelId`；`loadPMXFile` 增 `preferredId` 参数 |
| `scene/scene-serialize.ts` | `uuid` 直取 `inst.id`；恢复传 `m.uuid`；移除 `modelUuidMap` |

**验证**：
- `tsc --noEmit` 零错误。
- `resolve-model-id.test.ts`（5）：覆盖复用存档 uuid / 生成 v4 / 空串回退 / 旧 `model_` 格式已废弃。
- 回归：`replace-model-inherit`(16)、`material-editor`(50)、`lighting-follow`(8)、`env-lighting`(22)、`scene-serialize-undo`(6) 全绿。

## 遗留 / 注意

- 道具（prop）身份仍走 `propUuidMap` 旧机制，未纳入本次稳定身份改造（范围外）；若后续需统一，可同样改为 `inst.id = uuid`。
- 材质面板的 `id` 在模型被替换/重载后若未重建，可能持有旧 id（与本次易变 id 无关，属 UI 重建时序问题）；本次改动不引入也不修复该边缘项。
