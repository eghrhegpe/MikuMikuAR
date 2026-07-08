# ADR-065: 纯 items 层级语言热切换刷新

> **状态**: 待实施
> **关联**: ADR-059（i18n 框架）、ADR-065 概念稿（StreamAudioPlayer，未落文件）
> **背景**: ADR-059 声称「已开面板标签自动刷新」，但当前 `scheduleRefresh` 仅遍历已注册的 `_controls`，纯 `items` 层级（无 `registerControl`）的 `PopupRow` 标签在构建时通过 `t()` 冻结，不会随 `setLang` 刷新。

---

## 一、问题边界

### 1.1 当前机制

```
setLang() → scheduleRefresh() → SlideMenu.updateControls()
                                   └→ 只调 this._controls[].update()
                                   纯 items 层级 _controls = [] → 不刷新
```

- `replaceCurrentLevel` 修复只解决了**当前子菜单**（语言层级选中后重建）。
- Settings 根菜单（第 0–9 行所有文件夹标签）仍持有**旧 `t()` 值**。
- 所有使用纯 `PopupRow[]` 的子菜单（如 motion 层级、scene 层级等）均不刷新——**当前 ADR-059 的承诺是部分虚假的**。

### 1.2 波及范围

| 层级类型 | 示例 | 当前能否热刷新？ |
|----------|------|-----------------|
| `registerControl` 注册项 | settings-appearance toggle/switch | ✅ 由 `updateControls` 驱动 |
| `replaceCurrentLevel` 重建项 | 语言子菜单（2026-07-08 修复） | ✅ 选中后重建 |
| 纯 `items` 根层 | Settings 根（外观/性能/路径…） | ❌ 关闭重开才翻释 |
| 纯 `items` 子层 | scene 预设/布料物理选项等 | ❌ 同左 |

### 1.3 严重度

影响所有语言切换后的立即视觉反馈。用户切到 English 后，Settings 根菜单文件夹名（"外观"/"性能"/"路径"）仍为中文，直到手动关闭 Settings 并重新打开。**对演示/流畅度体验有实质影响，但不是功能阻塞。**

---

## 二、方案设计

三种思路，均不依赖外部库。

### 方案 A：纯 items 统一注册 `reRender` 控制

**思路**：`registerPopupMenu` / `SlideMenu` 内部，对纯 `items` 的层级自动注册一个 `reRender()` 控制，在 `updateControls()` 时触发全量重建，从而重读 `t()`。

```ts
// menu.ts — buildPanel 末尾
if (level.items.length > 0 && !level.reRenderCustom && !level.renderCustom) {
    this.registerControl(() => this.reRender({ preserveFocus: true }));
}
```

**优点**：
- 一行改动，波及面最小
- 所有纯 items 层级自动受益，不需要逐个手动改
- 保持 `registerControl` 模式的统一性

**缺点**：
- 每次语言切换都触发所有打开菜单的全量重绘（即使没开 Settings）
- `reRender` → `buildPanel` 重建 DOM，已打开的子菜单 `currentLevel` 变根 → 导航栈重建丢失深度

**评估**：⚠️ 全量破坏型，不适合。`reRender` 会重置整个菜单树。

### 方案 B：`PopupLevel` 持 builder 引用

**思路**：`PopupLevel` 增加可选字段 `itemBuilder?: () => PopupRow[]`。纯 items 层级在构建时存储 builder，`updateControls` 时反射重建 `items` 数组，然后轻量 patch（`patchPanel`）而非全量 `buildPanel`。

```ts
interface PopupLevel {
    label: string;
    dir: string;
    items: PopupRow[];
    itemBuilder?: () => PopupRow[];  // [doc:adr-065]
}

// menu.ts updateControls
for (const c of this._controls) c.update();
// 反射：如果有 itemBuilder，重建 items + patchPanel
const level = this.currentLevel;
if (level?.itemBuilder) {
    level.items = level.itemBuilder();
    this.patchPanel(level.items);
}
```

**优点**：
- 增量 patch，不重建 DOM，保持子菜单导航栈
- 不会因为语言切换丢失深度层级
- 粒度精确（只刷新 items 标签，不动控件）

**缺点**：
- 需改 `PopupLevel` 接口 + `menu.ts` render/update 路径
- 需要各 builder（`buildSettingsRootItems` / `buildAppearanceLevel` 等）传入 builder 引用
- `patchPanel` 需要验证：对 `kind: 'folder' | 'action' | 'divider'` 行做等价替换而非重建整个 list

### 方案 C：`scheduleRefresh` 直接触发 `reRender`

**思路**：`SlideMenu` 的 `subscribe` 回调改成直接调 `reRender()` 而非 `updateControls()`。

```ts
// menu.ts line 147-148
// 改前：
this._unsubscribe = subscribe(() => this.updateControls());
// 改后：
this._unsubscribe = subscribe(() => this.reRender({ preserveFocus: true }));
```

**优点**：零接口改动，一句话修。

**缺点**：
- `reRender` 全量重建当前层级 DOM，丢弃未保存的注册 control 状态（toggle 值等）
- 效果同方案 A（破坏深度子菜单导航栈）
- 且 `reRender` 有 `transitioning` 守卫和 RAF 去抖，频繁切换语言可能落下一次 `reRender` 被屏蔽

**评估**：❌ 不可行。暴力破坏 toggle/switch 的局部更新。

---

## 三、推荐方案：方案 B

### 3.1 实施路线

**Phase 1（基础设施）**：

- `core/config.ts` — `PopupLevel` 接口新增可选 `itemBuilder?: () => PopupRow[]`
- `menu.ts` — `updateControls()` 在遍历 `_controls` 后，读取 `currentLevel.itemBuilder`，若存在则执行 `level.items = level.itemBuilder()` 并调 `patchPanel(level.items)`
- 验证：`patchPanel` 对纯 items（folder/action/divider）须能正确 diff 替换

**Phase 2（迁移 builder）**：

- `settings.ts` — `buildSettingsRootItems` 传入 `buildRoot` 的 builder 引用
- `settings-language.ts` — `buildSettingsLanguageLevel` 已自带 builder 模式，直接设 `itemBuilder`
- 其他 `settings-*.ts` 的 `buildXxxLevel` 逐个补上 `itemBuilder?: buildXxxLevel`（依优先级：Settings 根 > scene 子层 > motion 子层）

**Phase 3（测试）**：

- 新增测试：给 `menu` 实例设一个带 `itemBuilder` 的 level，调 `scheduleRefresh`，验证 `patchPanel` 已执行且 items 标签已翻释
- 现有 E2E：verity `@dom` 测试中切语言后根菜单标签变英文

---

## 四、决策对比

| 方案 | 影响面 | 子菜单栈保持 | 施工量 | 回归风险 |
|------|--------|-------------|--------|---------|
| A. 全量 reRender | ❌ 栈丢失 | ❌ | 1 行 | 高 |
| **B. itemBuilder + patchPanel** | ✅ 精确增量 | ✅ | 中（~3 文件 + 逐 builder） | 低 |
| C. 暴力 reRender | ❌ 栈丢失 + toggle 状态丢失 | ❌ | 1 行 | 中高 |

**选 B**。

---

## 五、边界与风险

| 风险 | 缓解 |
|------|------|
| `patchPanel` 对文件夹行/分隔行的同替换不拉垮 | `patchPanel` 已有 `replaceWith` 逻辑（menu.ts:411-416），增量替换单行；若 rows 数量变化，需重建整个 list |
| 多个打开菜单同时刷新时的性能 | buildSettingsRootItems 仅 10 个 folder 项，微秒级；`patchPanel` 不触发 layout 重排 |
| builder 模式破坏懒构建 | 纯 items 层级本身无懒加载（所有子菜单在 `folder:enter` 时构建），加 builder 引用只是事后重建，不影响时序 |
| 与已注册的 `_controls` 冲突 | `updateControls` 先遍历 controls 再处理 itemBuilder，互不覆盖 |

---

## 六、验证

1. 打开 Settings → 切语言 → 根菜单文件夹名即时变为目标语言
2. 打开 Settings → 切语言 → 已开子菜单（如外观）内的 toggle 标签即时翻释（依赖原 registerControl 路径 + itemBuilder）
3. 不打开 Settings → 切语言 → 无任何冗余 reRender 开销
4. `npm run check && npm run test && npm run build` 全绿
