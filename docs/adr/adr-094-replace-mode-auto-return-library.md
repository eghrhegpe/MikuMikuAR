# ADR-094: 资源库替换模式 — 加载后自动保持替换状态并回到模型列表

> **状态**: 已完成（2026-07-27 简化：自动跳转机制已替换为 `stay` 模式，见下方 §变更记录）
> **模型记忆接入**: 见 ADR-097（更换模型路径已接入 RecentModels 驱动的模型记忆恢复）

## 1. 背景

资源库（Library）的替换模式（Replace Mode）由用户在模型详情页点击「更换模型」卡片触发，进入以当前模型名为标题的资源库浏览器，选择模型后加载替换。但加载完成后，弹窗直接跳转到新模型的详情页（`buildModelLevel`），不再处于替换菜单中。用户若想继续替换另一个模型，需手动从详情页再次进入「更换模型」→ 翻回资源库，形成断层的操作路径。

典型场景：普通用户想逐一看过模型库中的多个模型，每次加载后都得「翻回 → 再选」，体验上割裂。

## 2. 决策

替换模式加载新模型成功后，**不再跳转模型详情页**，而是：

1. 自动激活新模型的替换模式（`setModelReplaceTargetId(newModelId)`）
2. 重置栈至根目录（`resetToRoot()`）
3. 自动推入以新模型命名的资源库浏览器（`buildLevel`）

这样用户看到的就是以新模型命名的模型列表，点击任一行即触发下一次替换，形成「选 → 加载 → 自动回列表 → 再选」的无缝循环。

## 3. 方案细节

### 3.1 核心逻辑

在 `library-core.ts` `onModelRowClick` 的 Replace mode 分支中，将原 `.then()` 处理：

```typescript
// 旧逻辑：加载完成 → 跳转模型详情页
stackRegistry.modelStack?.resetToRoot();
stackRegistry.modelStack?.push(buildModelLevel(handle.id));
```

改为：

```typescript
// 新逻辑：加载完成 → 激活新模型替换模式 → 回到模型列表
setModelReplaceTargetId(handle.id);
stackRegistry.modelStack?.resetToRoot();
const newInst = modelRegistry.get(handle.id);
stackRegistry.modelStack?.push(
    buildLevel(
        getBrowseDir('pmx'),
        t('model-detail.replaceModelTo', { name: newInst?.name ?? handle.name }),
        (model) => model.format === 'pmx',
        stackRegistry.modelStack!,
        externalPaths.map((ep) => ({ label: ep.name, path: ep.path }))
    )
);
```

### 3.2 关键点

- `setModelReplaceTargetId(handle.id)` 在 `resetToRoot` **之前**调用（与第 2 节决策、3.1 代码例子顺序一致）。`resetToRoot` 仅重建层级栈（`this.levels`），不触碰 `state.ts` 中的 `modelReplaceTargetId`，故激活的新目标不会被清除，调用顺序安全。
- `buildLevel` 的参数与模型详情页「更换模型」卡片中 `model-detail.ts` 第 285 行的参数一致（`getBrowseDir('pmx')` + 外部路径），保证两入口行为等价。
- 错误路径（`.catch`）保持不变：重置栈并 `reRender()`。
- ZIP 容器路径（`doReplace` 被 `ExtractZip` 调用）同步受益，无需额外改动。

## 4. 涉及文件

| 文件 | 操作 |
|------|------|
| `menus/library-core.ts` | 修改：`onModelRowClick` 替换模式 `.then()` 分支，移除 `buildModelLevel` 跳转，改为激活替换 + 推入资源库浏览器 |

## 5. 关联

- ADR-094 独立改动，不依赖其他 ADR
- 涉及的 `setModelReplaceTargetId` / `buildLevel` / `getBrowseDir` 为已有 API，无需新增

## 6. 变更记录（2026-07-27）

### 背景
ADR-094 原始方案在替换成功后使用 `resetToRoot()` + `push(buildLevel(..., { mode: 'jumpToDir' }))` 重建浏览层，每次替换后重置到根目录。用户反馈此跳转过于折腾，且与动作资源库的 `stay` 模式体验不一致。

### 变更
替换模式已将 `jumpToDir` 契约完全移除，统一使用 `stay` 模式：

1. **`startReplaceModel`**：加载新模型后不再 `resetToRoot()` + `push(buildLevel)`，改为直接更新当前层的 `outcome.modelId` 指向新模型，浏览器保持原位不动。
2. **`activateItem` / `onItemClick`**：`stay` 模式增加 PMX 模型分支，选中模型时通过 `outcome.modelId` 传参替换，与 VMD 连续预览共用同一契约。
3. **`BrowseOutcome` 类型**：移除 `jumpToDir` 变体，`stay` 成为唯一的连续/替换模式契约。

### 动因
- 替换角色不需要跳转重置，保持当前浏览目录即可连续替换
- 与动作资源库的 `stay` 模式保持一致，降低用户心智负担
- 消除 `resetToRoot` + 重建浏览层的冗余操作，简化代码

### 涉及文件
| 文件 | 操作 |
|------|------|
| `menus/library-actions.ts` | `startReplaceModel` 移除 `resetToRoot` + `buildLevel`，改为更新 `currentLevel.outcome` |
| `menus/library-core.ts` | `activateItem` 中 `jumpToDir` 分支替换为 `stay` + PMX 分支 |
| `menus/library-browse.ts` | `onItemClick` 中 `jumpToDir` 分支替换为 `stay` + PMX 分支 |
| `core/types.ts` | 移除 `BrowseOutcome` 中的 `jumpToDir` 类型 |

### 关联
- ADR-131：`jumpToDir` 从契约中移除，相关描述已更新
- ADR-094：本 ADR 所有原始决策仍有效（替换后保持浏览器打开），仅实现方式简化
