# ADR-170: 动作库选中范式 —— 将「默认」暴露为逐行「选中」（对齐模型焦点范式）

> **状态**: 已实施（2026-07-22, 9ac064d9）
> **日期**: 2026-07-22
> **依赖**: ADR-167（场景级动作库）、ADR-169（动作装载语义统一 replaceDefaultMotion）
> **路径约定**: 源码路径省略 `frontend/src/` 前缀，例如 `menus/motion-root-ui.ts` = `frontend/src/menus/motion-root-ui.ts`

## 背景与问题

### 「替换」失去了可视觉寻址的靶子

ADR-169 把「从文件装载动作」统一为 `replaceDefaultMotion`（原位替换默认）。但**「默认」是一个全局、不可见的指针**（`_activeMotionId`），在场景动作库列表里用户无法"选中"替换靶子。当前动作行（`buildMotionRootItems`，[motion-root-ui.ts:55](../../frontend/src/menus/motion-root-ui.ts#L55)）的交互是：

| 部位 | 现状 | 问题 |
|---|---|---|
| 行点击 | 进详情页（`__motion_detail__:<id>`） | 不是"选中"，无法指定替换靶子 |
| 行首（leading） | trash-2「删除动作」 | 删除占据主操作位 |
| 行尾（trailing，仅非默认行） | star「设为默认」 | star 被普遍误读为"收藏"；默认行无此按钮，"默认"只剩 clapperboard + 「默认」徽标，像个荣誉徽章而非可指向的靶子 |

后果（用户实测反馈）：「用户就不知道、也没法选中要替换的动作了」。要替换某个具体动作只能「①星标设默认 → ②回库网格 → ③双击新 VMD」三跳，因果链完全隐藏。

### 审计结论（2026-07-22）

- 🔴 P1：场景动作库无任何"替换/选中"入口；能力层早有 `updateSceneMotion`（[motion-intent.ts:127](../../frontend/src/scene/motion/motion-intent.ts#L127)）却全项目零调用
- 🟠 P2：star 图标语义错误（收藏 ≠ 设为默认）
- 🟠 P2：违反 ADR-169 自己写明的跨资源一致性原则——模型「点击 = 替换焦点的那个」，动作却无逐替换语义

### 模型列表已有成熟范式

模型行（`buildModelRootItems`，[library-core.ts:860](../../frontend/src/menus/library-core.ts#L860)）早已给出答案：**一个逐行可寻址的焦点指针 + 行首「设为焦点」按钮，所有"替换"语义挂在焦点上**：

```ts
const isFocused = focusedModelId === id;
const radioIcon = isFocused ? 'lucide:check-circle' : 'lucide:circle';
items.push({
    kind: 'action',
    label: inst.name,
    icon: radioIcon,              // 行主图标 = 单选态
    focused: isFocused,
    leading: { icon: radioIcon, title: t('library.focusModel'), onClick: () => focusModel(id) },
    trailing: { icon: 'lucide:settings-2', title: t('library.modelTools'), onClick: ... },
});
```

网格双击替换模型时，替换的正是 `focusedModelId` 指向的那个——**选中谁，替换谁**。

---

## 决策

### 核心语义：复用 `_activeMotionId` 作为「选中」指针

> **不新增任何状态**。`_activeMotionId`（默认动作）就是选中指针，只需把它暴露为逐行可选中的 affordance。`replaceDefaultMotion` 的靶子本来就是 `_activeMotionId`——把它暴露成行级「选中」按钮的那一刻，"替换默认"自动变成"替换选中"，ADR-169 的装载逻辑**一行不改**。

| 模型列表 | 动作列表（对齐后） |
|---|---|
| `focusedModelId` 焦点指针 | `_activeMotionId`——原样复用，零新增状态 |
| 行首 check-circle「设为焦点」 | 行首 check-circle「选中」 |
| 行尾 settings-2「模型工具」 | 行尾 settings-2「动作工具」→ 详情页 |
| 网格双击 = 替换焦点模型 | 网格双击 = 替换选中动作（`replaceDefaultMotion` 不变） |

缺的从来不是逻辑，是**寻址能力**。

### 动作行重构（motion-root-ui.ts buildMotionRootItems）

```ts
const isSelected = motion.id === activeId;
const radioIcon = isSelected ? 'lucide:check-circle' : 'lucide:circle';
items.push({
    kind: 'action',
    label: motion.vmdName || t('motion.intent.none'),
    icon: radioIcon,                                   // 行主图标 = 单选态
    target: `__motion_detail__:${motion.id ?? ''}`,    // 行点击 → 详情（保留）
    sublabel: isSelected ? t('motion.defaultMotion') : undefined,
    wrapLabel: true,
    leading: {
        icon: radioIcon,
        title: t('motion.selectMotion'),               // 「选中」
        onClick: () => { /* setDefaultMotion + undo + reRender */ },
    },
    trailing: {
        icon: 'lucide:settings-2',
        title: t('motion.motionTools'),                // 「动作工具」→ 详情页
        onClick: () => { /* push buildMotionDetailLevel(motion.id) */ },
    },
});
```

变更点（相对现状）：

| 部位 | 现状 | 改为 |
|---|---|---|
| 行主图标 | clapperboard / circle-play | check-circle / circle（单选态，对齐模型） |
| 行首 | trash-2「删除动作」 | check-circle「选中」（= setDefaultMotion，带撤销快照） |
| 行尾 | star「设为默认」（仅非默认行） | settings-2「动作工具」→ 详情页（所有行） |
| 删除 | 行首按钮 | **收进详情页**（`buildMotionDetailSchema` 已有删除 chip，[motion-detail-ui.ts:172](../../frontend/src/menus/motion-detail-ui.ts#L172)，行内按钮直接移除） |

> 少用功能（删除）收敛到工具页，行内只保留"选中"这一主操作——与模型行「行首焦点 + 行尾工具」的布局完全对齐。

### 语义拍板：选中 = 默认 = 当前活跃项

「选中 B」的瞬间角色即改跳 B。这正是焦点语义：**焦点打到谁、操作就落到谁，选中即预览**。与模型焦点"选中谁、替换就落到谁"同构。不引入"纯选中（不影响角色）"的第二状态——那会新增 `_selectedMotionId`，违背"别把它做复杂"的收敛初衷。

### 与备选方案对比

| 方案 | 否决理由 |
|---|---|
| 逐行「替换」按钮 + `updateSceneMotion`（审计初版建议） | 在 `replaceDefaultMotion` 之上再造一套瞄准系统，新增 UI 与 API 调用面，过度设计 |
| 选中与默认分离（纯选中态 `_selectedMotionId`） | 新增状态 + 持久化/广播面，复杂化；选中即生效本就是动作场景的自然语义 |
| 仅换图标（star → check-circle）不改布局 | 删除仍占行首主操作位，"选中" affordance 缺位，治标不治本 |
| **复用默认指针 + 行级选中（采纳）** | 零新增状态/API，对齐既有模型范式，"替换默认"天然变"替换选中" |

---

## i18n 变更（5 语言）

新增：

| key | zh-CN |
|---|---|
| `motion.selectMotion` | 选中 |
| `motion.motionTools` | 动作工具 |

（`motion.defaultMotion`=「默认」徽标、`motion.deleteMotion`=删除 复用现有 key；删除入口移至详情页，key 不变。）

---

## 实施分期

| 阶段 | 文件 | 操作 | 验收 |
|---|---|---|---|
| **P0** | `menus/motion-root-ui.ts` | 动作行重构：行首 check-circle「选中」（setDefaultMotion + pushUndoSnapshot/offerSceneUndoAndRefresh + reRender），行尾 settings-2「动作工具」→ 详情，移除行内 trash 与 star，行主图标改单选态 | tsc 通过；行内可选中任意动作，选中行显示 check-circle + 「默认」徽标 |
| **P0** | `core/i18n/locales/*` | 新增 `motion.selectMotion` / `motion.motionTools`（zh-CN/zh-TW/ja/en/ko） | 5 语言 key 齐全 |
| **P1** | `menus/motion-detail-ui.ts` | 确认详情页删除 chip 存在（已有，仅核验）；行尾「动作工具」与行点击同指详情页，无冗余副作用 | 详情页可删除动作（带确认 + 撤销） |
| **P1** | `__tests__/` | 如有动作行渲染测试则更新；`replaceDefaultMotion` 单测已覆盖替换语义（ADR-169） | `npm run test` 全绿 |

---

## 风险与缓解

| 级别 | 风险 | 缓解 |
|---|---|---|
| 🟠 P2 | 选中即生效：点「选中」会切换角色正在跳的动作，用户可能误触 | 带 pushUndoSnapshot + 撤销 toast；且"选中即预览"是焦点语义的固有行为，在 ADR 中明示 |
| 🟡 P3 | 行点击与行尾「动作工具」同指详情页，入口冗余 | 与模型行一致的视觉范式（行尾工具图标），多入口无害；行点击保留为主导航 |
| 🟡 P3 | 「默认」徽标与「选中」按钮并存，概念双名 | 徽标保留"默认"以延续 ADR-167 的"跟随默认"语义；行首按钮用"选中"表达操作，二者指向同一状态，不新增状态 |

---

## 不变的部分

| 模块 | 不动原因 |
|---|---|
| `replaceDefaultMotion`（ADR-169） | 靶子本就是 `_activeMotionId`，暴露选中后语义自动对齐，零改动 |
| `setDefaultMotion` / `_activeMotionId` / 广播逻辑 | 选中复用默认指针，状态机不变 |
| 详情页 `buildMotionDetailSchema`（删除/图层/覆盖） | 删除本就在详情页，仅从行内撤出 |
| 库网格双击 `replaceMotion` | 替换选中（默认）的入口不变 |
| 「浏览动作库」`onVmdPick`（addSceneMotion） | 显式"添加候选"语义保持（ADR-169 已界定边界） |

---

## 后续迭代方向

- **选中态视觉强化**：选中行可叠加高亮底色（复用模型行 `focused` 标记的样式），进一步降低"靶子"识别成本
- **「默认」徽标文案收敛**：待用户反馈后评估是否将"默认"统一改为"当前/已选中"，完成概念单一化
