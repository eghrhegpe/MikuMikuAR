# ADR-169: 动作装载语义统一 —— 原位替换默认动作（replaceDefaultMotion）

> **状态**: 已实施
> **日期**: 2026-07-21
> **依赖**: ADR-167（场景级动作库）、ADR-121（全局动作意图）、ADR-131（库契约派发）
> **路径约定**: 源码路径省略 `frontend/src/` 前缀，例如 `core/load-manager.ts` = `frontend/src/core/load-manager.ts`

## 背景与问题

### 遗留的破坏性装载路径

ADR-167 建立了「场景级动作库 + 多主动作平等共存」模型。角色级动作应用路径（`applyIntentToModel` / stay 预览 / 预设应用）已通过 `skipSceneIntent` 标志做到对动作库非破坏（见提交 `51e597a9` / `265850ad`）。但**「用户从文件主动装载新动作」**的入口仍走已废弃的 `setActiveMotion`（单例替换语义：`_sceneMotions = [intent]`），把整个场景动作库替换为新装载的单个动作：

| 入口 | 位置 | 现状 |
|---|---|---|
| 库网格双击（`replaceMotion`） | `menus/library-actions.ts:447` | `loadVMDFromPath` → `setActiveMotion` → 库被清成 1 项 |
| 拖拽 / 打开文件 | `core/events.ts:435` | 同上 |
| 库行点击（close 模式） | `menus/library-actions.ts:379` | 同上 |
| zip 解压加载 | `menus/library-actions.ts:350` | 同上 |
| 外部拖入 | `menus/library-actions.ts:626` | 同上 |

后果：用户场景库里有 6 个主动作，在库中双击一个新 VMD → 库被清空成 1 个，其余角色的动作全部被广播覆盖。这是 ADR-167 落地后**最后残留的破坏链**。

### 与其他资源类型的语义不一致

对比各资源类型的「库中点击」行为：

| 资源 | 库中点击的行为 | 是否破坏已加载集合 |
|---|---|---|
| 模型 / 道具 | 装载 = 加入场景；替换模式 = 换掉选中的那一个 | 否 |
| 动作（现状） | 替换整个场景动作库 | ⚠️ 是 |
| 场景 | 装载新场景替换当前场景 | 固有语义 |

模型菜单的「保存预设」（`savePresetToLibDialog`，[model-preset.ts:368](../../frontend/src/menus/model-preset.ts#L368)）示范了正确范式：**操作作用域限定在选中对象、对集合非破坏**——保存只新增一个预设，不动其他预设。动作装载应收敛到同一范式：操作「选中的动作」（点击的那个 VMD），而非夷平整个库。

---

## 决策

### 核心语义：原位替换默认动作

所有「从文件装载动作」入口统一为：

> **装载的动作成为新的默认动作；若原默认动作存在，将其从库中移除（由新动作原位顶替）；若不存在默认，新动作加入库并设为默认。**

| 场景 | 装载前库 | 默认 | 装载后库 | 默认 |
|---|---|---|---|---|
| 有默认（装载新 VMD） | `[A, `**`B`**`, C]` | B | `[A, `**`D`**`, C]` | D |
| 有默认（装载的已是候选） | `[A, `**`B`**`]` | B | `[`**`A'→复用A`**`]`…见下 | A |
| 无默认、库非空 | `[A, B]` | null | `[A, B, `**`D`**`]` | D |
| 空库 | `[]` | null | `[`**`D`**`]` | D |

**去重细化**：若装载的路径已是库中某个非默认候选，则**复用该候选**（提升为默认），不重复添加；原默认仍被移除。即「替换」始终作用于旧默认，新动作能复用则复用。

替换后的角色引用行为由 ADR-167 既有广播逻辑天然支持，**无需新增逻辑**：

- 跟随默认的角色（`sceneMotionId=undefined`）→ 切到新默认 D
- 显式引用旧默认 B 的角色（`sceneMotionId=B.id`）→ B 已移除，按 ADR-167 失效引用回退到默认 D
- 显式引用其他动作（A/C）的角色 → 不受影响，继续跳 A/C

### 与备选方案对比

| 方案 | 语义 | 否决理由 |
|---|---|---|
| 仅加进库（`addSceneMotion`） | 装载 = 新增候选，默认不变 | 与「双击 = 现在就用它」直觉不符，用户需再手动设默认 |
| 加进库并设默认 | 装载 = 新增 + 设默认，旧默认保留为候选 | 库随装载无限膨胀，与「替换」语义不符 |
| 仅应用到聚焦模型 | per-model，库不变 | 场景语义不变，与「入口统一」决策冲突 |
| **原位替换默认（采纳）** | 装载 = 新默认顶替旧默认 | 库大小稳定、符合「替换当前在跳的动作」直觉、对非默认动作非破坏 |

### API 变更（motion-intent.ts）

```ts
/**
 * [adr-169] 原位替换默认动作。
 * - 装载路径已是库中候选 → 复用该候选（提升为默认），不重复添加
 * - 否则新增动作，插入到旧默认原位置（保持库顺序稳定）
 * - 旧默认（若存在且非复用项）从库中移除
 * - 触发广播：跟随默认 / 引用旧默认的角色切到新动作
 * @returns 新默认动作的 id
 */
export function replaceDefaultMotion(intent: SceneMotionIntent): string {
    const prev = getActiveMotion();
    const prevId = _activeMotionId;

    const existing = intent.vmdPath
        ? _sceneMotions.find((m) => m.vmdPath === intent.vmdPath)
        : undefined;

    let newId: string;
    if (existing) {
        newId = existing.id;
        if (prevId !== null && prevId !== newId) {
            _sceneMotions = _sceneMotions.filter((m) => m.id !== prevId);
        }
    } else {
        newId = intent.id ?? genMotionId();
        const withId: SceneMotionIntent = { ...intent, id: newId };
        if (prevId !== null) {
            const idx = _sceneMotions.findIndex((m) => m.id === prevId);
            _sceneMotions = _sceneMotions.filter((m) => m.id !== prevId);
            _sceneMotions.splice(idx >= 0 ? idx : _sceneMotions.length, 0, withId);
        } else {
            _sceneMotions.push(withId);
        }
    }

    _activeMotionId = newId;
    _motionGen++;
    _broadcastCallback?.(getActiveMotion(), _motionGen, prev);
    return newId;
}
```

`replaceDefaultMotion` 是 `removeSceneMotion + addSceneMotion + setDefaultMotion` 的原子组合，保证「移除旧默认 → 加入/复用新动作 → 设默认 → 广播」在一次 generation 递增内完成，避免中间态被并发广播读到。

### 入口迁移（vmd-loader.ts loadVMDFromPath）

`loadVMDFromPath` 非 `skipSceneIntent` 分支的两处 `setActiveMotion`（[vmd-loader.ts:233/242](../../frontend/src/scene/motion/vmd-loader.ts#L233)）替换为 `replaceDefaultMotion`，保留「同路径去重」守卫：

```ts
if (!skipSceneIntent) {
    const cur = getActiveMotion();
    if (!cur || cur.vmdPath !== path) {
        replaceDefaultMotion({
            vmdPath: path,
            vmdName: vmdName.replace(/\.vmd$/i, ''),
            vmdLayers: [],
            source: 'vmd',
        });
    }
}
```

所有「从文件装载」入口（`replaceMotion` / 拖拽 / 行点击 / zip 解压）都经 `loadManager.load({kind:'vmd'})` → `loadVMDFromPath`，**改这一处即完成入口统一**——这正是「入口统一」决策的落点。

### 与「浏览动作库」的语义边界

「浏览动作库」（`__scene_motion_browse__` 的 `onVmdPick` → `addSceneMotion`）是**显式的「添加候选」**入口——用户主动构建候选库，每次挑选 = 新增候选，不设默认。这与「从文件装载 = 现在就用」是两种用户意图，**保持各自语义**：

| 入口 | 用户意图 | 语义 |
|---|---|---|
| 浏览动作库（动作菜单内） | 构建候选库 | `addSceneMotion`（仅加候选） |
| 库网格双击 / 拖拽 / 打开 | 装载并立即使用 | `replaceDefaultMotion`（替换默认） |

### !mmdRuntime 占位路径的边界说明

`vmd-loader.ts:82` 的 `setActiveMotion({ vmdPath: null, ... })`（运行时未就绪时的「缓存等待」占位）是遗留边界：

- 仅在 `loadVMDMotion` 被直接调用且运行时未就绪时触达（`loadVMDFromPath` 已在前置按 `mmdRuntime` 分流，主路径不经过此）
- `vmdPath: null` 的占位语义本身存疑（后续无法真正加载）

处置：本 ADR 一并迁移为 `replaceDefaultMotion` 保持一致（使 `setActiveMotion` 生产调用点归零）；其占位语义的合理性作为后续观察项记录，不在本 ADR 展开。

---

## 跨资源类型一致性原则（写明，不在本 ADR 实施场景/道具）

> **原则：库中点击 = 装载/加入选中项到集合；操作作用域限定在选中项，对同类其他成员非破坏。**

| 资源 | 现状 | 对齐情况 |
|---|---|---|
| 模型 / 道具 | 装载 = 加入；替换 = 换掉选中的 | ✅ 已符合 |
| 动作 | 装载 = 原位替换默认（对非默认动作非破坏） | ✅ 本 ADR 对齐 |
| 场景 | 装载新场景替换当前场景 | 固有语义（场景是整体舞台，非集合成员），不适用本原则；但「替换应有确认/撤销」应遵循 |

场景 / 道具如需细化收敛，另开 ADR 引用本原则。

## 撤销支持

原位替换默认会移除旧默认，属破坏性操作（按交互可用性审核「破坏性操作防呆」项）。缓解：

- `replaceMotion` 路径加「操作前快照 + 撤销提示」，复用既有 `pushUndoSnapshot` / `offerSceneUndoAndRefresh`（参照 `__motion_clear__` 的用法，[motion-popup.ts:272](../../frontend/src/menus/motion-popup.ts#L272)）
- 普通拖拽 / 打开依赖场景自动保存 + 场景级撤销兜底

---

## 实施分期

| 阶段 | 文件 | 操作 | 验收 |
|---|---|---|---|
| **P0** | `scene/motion/motion-intent.ts` | 新增 `replaceDefaultMotion`（含去重复用 + 原位插入 + 原子广播）；`setActiveMotion` 暂保留 | tsc 通过；单测覆盖四象限（有默认/无默认/空库/路径已存在） |
| **P0** | `scene/motion/vmd-loader.ts` | `loadVMDFromPath` 两处 `setActiveMotion` → `replaceDefaultMotion`（保留同路径去重）；`!mmdRuntime` 占位路径一并迁移 | tsc 通过；装载后库仅默认被替换、非默认动作保留 |
| **P1** | `scene/motion/motion-intent.ts` | 移除 `setActiveMotion`（生产零调用后）；清理 `scene-serialize.ts:29` 未使用导入 | 生产代码 `setActiveMotion` 零调用点 |
| **P1** | `menus/library-actions.ts` | `replaceMotion` 路径加撤销快照 | 双击替换后可撤销恢复旧默认 |
| **P1** | `__tests__/` | 新增 `replaceDefaultMotion` 单测 + `loadVMDFromPath` 集成测试；清理 `setActiveMotion` 相关 mock | `npm run test` 全绿 |

---

## 风险与缓解

| 级别 | 风险 | 缓解 |
|---|---|---|
| 🔴 P1 | 旧默认被移除导致显式引用它的角色回退 | 属预期语义（ADR-167 失效引用回退）；广播统一回退到新默认，无静态残留；在 ADR 中明示 |
| 🟠 P2 | 误操作：双击错误 VMD 丢失旧默认 | `replaceMotion` 加撤销快照；普通装载依赖场景自动保存 |
| 🟠 P2 | 聚焦模型被双重加载（`loadVMDMotion` 应用一次 + 广播再应用） | 既有行为（`setActiveMotion` 时代同样广播重应用）；`applyIntentToModel` 有同路径守卫，实际开销小；记为后续优化项 |
| 🟡 P3 | 原位插入位置（旧默认 index）的序列化依赖 | 场景库顺序仅影响展示；`sceneMotions` 数组顺序已持久化，保存/重载后顺序保持 |
| 🟡 P3 | `!mmdRuntime` 占位路径 `vmdPath=null` 语义存疑 | 本 ADR 迁移为 `replaceDefaultMotion` 保持一致；合理性列为后续观察项 |

---

## 不变的部分

| 模块 | 不动原因 |
|---|---|
| `applyIntentToModel` / stay 预览 / 预设应用（`skipSceneIntent` 路径） | 已非破坏（`51e597a9` / `265850ad`），不变 |
| `addSceneMotion` / `setDefaultMotion` / `removeSceneMotion` / `clearAllSceneMotions` | ADR-167 库管理 API，不变；`replaceDefaultMotion` 是其原子组合 |
| 「浏览动作库」`onVmdPick`（`addSceneMotion`） | 显式「添加候选」入口，保持添加语义（区别于「装载 = 立即使用」） |
| 广播逻辑 `initMotionBroadcast` | ADR-167 失效引用回退天然支持默认替换 |
| 场景序列化 `scene-serialize.ts` | `sceneMotions + activeMotionId` 结构不变 |

---

## 后续迭代方向

- **场景 / 道具装载语义收敛**：引用本 ADR 的跨资源一致性原则，另开 ADR 审视场景、道具的装载/替换语义
- **装载去重提示**：装载路径已在库中时，toast 提示「已提升为默认」而非静默复用
- **双重加载优化**：`replaceMotion` 路径避免聚焦模型被 `loadVMDMotion` 与广播重复应用
- **`!mmdRuntime` 占位路径重审**：评估 `vmdPath=null` 占位是否应整体移除
