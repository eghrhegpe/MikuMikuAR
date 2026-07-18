# ADR-129: 动作菜单场景级重设计（Scene-level Motion UI）

> **状态**: 规划中
> **日期**: 2026-07-18
> **依赖**: ADR-121（全局动作意图，已实施 P0+P1+P2）

## 背景与问题

ADR-121 在后端实现了「场景级 `activeMotion` + per-model 继承/覆盖」，但前端动作菜单（`menus/motion-popup.ts`）的根层结构仍是 **per-model 范式**：

```
当前根层结构：
  Card 1: 已加载模型列表（actor 行 → 点进去是该模型的动作绑定面板）
    ├─ 初音未来 [当前 VMD名]     → action:binding:{id}
    ├─ 雷电芽衣 [当前 VMD名]     → action:binding:{id}
    └─ ...
  Card 2: 相机 / 音乐库 / 姿势工作室 / 播放速度 / ...
  Card 3: 程序化动作 / 注视 / 高级设置 / 外部导入
```

**核心矛盾**：

| 维度 | 后端（ADR-121） | 前端（当前） |
|------|-----------------|-------------|
| 语义 | 「场上在跳什么」——场景级意图 | 「给哪个角色上什么动作」——per-model |
| 选动作 | `setActiveMotion(intent)` 全局生效 | 必须先选模型 → 进入该模型绑定面板 → 再选 VMD |
| 换角色 | 新模型自动继承全局动作 | 用户感知不到，需手动进每个模型面板重选 |
| Pin 覆盖 | `mode: 'pinned'` per-model 差异化 | 藏在模型绑定面板的卡片 4，用户难以发现 |

用户反复换皮欣赏时，每次都要点进模型 → 选动作 → 返回，与 ADR-121「换角色无需重选」的设计初衷背道而驰。

### 竞品参考（DanceXR）

DanceXR 的动作菜单首屏：

```
1. 当前加载的动作（场景级）→ 点击可微调骨骼设计/动作覆盖
2. 程序化动作
3. 音乐库
```

动作是**场景级一等公民**，模型列表是次级管理界面。

---

## 决策：场景级动作菜单重设计

### 设计原则

1. **动作是场景内容，不是模型属性**——根层展示「场上在跳什么」
2. **per-model 管理下沉**——pin/unpin/incompatible 作为模型行的 trailing 状态，不是根层入口
3. **渐进式重构**——分 Phase 落地，每 Phase 独立可交付，不一次性重写

### 新根层结构

```
新根层结构：
  Card 1: 当前动作（场景级）
    ├─ [当前动作名] / 静态（无动作）    → 进入动作详情（图层管理 + 微调）
    ├─ 浏览动作库                      → VMD 文件浏览器
    └─ 程序化动作                      → 进入 Procmotion 子页
  Card 2: 模型管理（per-model 差异化）
    ├─ 初音未来  [跟随全局] ↗          → 点击行进入模型动作面板（pin/unpin/图层）
    ├─ 雷电芽衣  [固定: xxx.vmd] 🔒   → trailing 显示 pin 状态
    └─ ...
  Card 3: 场景工具
    ├─ 相机
    ├─ 音乐库
    ├─ 姿势工作室
    ├─ 播放速度
    ├─ 注视追踪
    ├─ 骨骼覆盖
    ├─ 脚部调整
    ├─ 虚拟裙骨
    ├─ 高级设置
    └─ 外部动作导入
```

### 关键交互变更

| 操作 | 旧流程 | 新流程 |
|------|--------|--------|
| 加载动作 | 选模型 → 进绑定面板 → 浏览 VMD → 选文件 | 根层「浏览动作库」→ 选文件 → 全局广播 |
| 清除动作 | 选模型 → 进绑定面板 → 点清除 | 根层「当前动作」→ 进详情 → 点清除 |
| 换角色不换动作 | 每次换模型后重新选 | 自动继承（ADR-121 已实现，UI 现在可见） |
| Pin 独立动作 | 进模型绑定面板 → 卡片 4 pin 按钮 | 模型行 trailing 齿轮 → pin/unpin |
| 查看 incompatible | 进模型绑定面板才看到黄色提示 | 模型行 sublabel 显示状态 |
| 图层微调 | 进模型绑定面板 → 图层列表 | 根层「当前动作」→ 进详情 → 图层管理 |

---

## 实施分期

### Phase 1：根层结构重排（纯 UI 重构，不改后端）

**目标**：将根层从「模型列表优先」改为「当前动作优先」，不改变任何后端逻辑。

**文件变更**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `menus/motion-popup.ts` | 修改 `buildMotionRootItems()` | 重排卡片顺序：当前动作 → 模型管理 → 场景工具 |
| `menus/motion-popup.ts` | 新增 `buildCurrentMotionCard()` | 「当前动作」卡片：显示 activeMotion 名称/状态，点击进入动作详情 |
| `menus/motion-popup.ts` | 新增 `buildMotionDetailLevel()` | 动作详情页：图层管理 + 清除 + 播放控制（从现有 `buildActionBindingSchema` 提取） |
| `menus/motion-popup.ts` | 修改模型行 trailing | trailing 齿轮 → 进入模型动作面板（pin/unpin + incompatible 提示） |

**验收**：
- 根层首屏显示「当前动作」卡片，用户一眼可见场上在跳什么
- 点击「浏览动作库」选 VMD 后，所有 inherit 模型同步起舞（复用 ADR-121 广播）
- 模型行 trailing 显示 pin/incompatible 状态
- 现有功能（图层、清除、pin/unpin）均可通过新入口到达

### Phase 2：动作详情页整合

**目标**：将散落在 `buildActionBindingSchema` 中的图层管理、清除、pin/unpin 整合到统一的「动作详情」子页。

**文件变更**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `menus/motion-popup.ts` | 重构 `buildMotionDetailLevel()` | 统一动作详情：当前图层列表 + 添加图层 + 清除 + 播放控制 |
| `menus/motion-popup.ts` | 精简 `buildActionBindingSchema()` | 仅保留 per-model pin/unpin + incompatible 提示，图层管理移至动作详情 |

**验收**：
- 动作详情页包含所有图层操作（添加/删除/权重/启用）
- 清除动作在动作详情页内，不在模型面板
- 模型面板仅含 pin/unpin + 状态提示

### Phase 3：per-model 差异化增强

**目标**：强化模型行的差异化显示，让用户无需进入子页即可了解每个模型的动作状态。

**文件变更**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `menus/motion-popup.ts` | 增强模型行 sublabel | 显示：跟随全局 / 固定: [动作名] / 不兼容 |
| `menus/motion-popup.ts` | 模型行快捷操作 | 长按/右键弹出 pin/unpin 快捷菜单 |

**验收**：
- 模型行 sublabel 实时反映动作状态
- pin/unpin 操作可从根层快捷完成

---

## 不变的部分

| 模块 | 不动原因 |
|------|---------|
| `scene/motion/motion-intent.ts` | 后端逻辑完备，本 ADR 仅改 UI 层 |
| `scene/motion/playback.ts / vmd-loader.ts / vmd-layers.ts` | 播放链路不变 |
| ADR-116 动作覆盖模块 | per-model 覆盖层与全局意图正交 |
| ADR-121 广播逻辑 | 已正确实现，UI 只是换个入口调用 `setActiveMotion` |

---

## 风险与缓解

| 级别 | 风险 | 缓解 |
|------|------|------|
| 🟡 P3 | 根层重排涉及 `buildMotionRootItems` 重构，可能影响 `onFolderEnter` / `onItemClick` 路由 | Phase 1 仅重排 items 顺序 + 新增卡片构建函数，不改路由表 `MOTION_FOLDER_ROUTES` |
| 🟡 P3 | 「当前动作」卡片需订阅 `activeMotion` 变化以实时更新显示 | 复用 `getMotionMenu()?.reRender()` 模式（与现有 `updateControls` 一致） |
| 🟢 P4 | 现有测试 `motion-popup` 相关用例可能因 DOM 结构变化失败 | Phase 1 不改 `buildActionBindingSchema`，测试仅需更新 `buildMotionRootItems` 断言 |

---

## 后续迭代方向

- **动作预设组**：「演唱会包」一键设 `activeMotion` + 给特定角色 `pin` 独舞（ADR-121 已规划）
- **批量 pin**：多选模型统一指派动作
- **动作搜索**：VMD 库支持按名称/标签搜索
- **动作预览**：选 VMD 时实时预览骨骼动画（需性能评估）
