# ADR-248: 派生缓存依赖引用键 —— 缓存 key 必须携带依赖引用，依赖变更即失效

> **日期**: 2026-08-06
> **状态**: ✅ 已立（2026-08-06 立项；`material.ts` `getMaterialCategory` 已从无感知的 `_matCategoryCache` 改为委托带 `mapRef` 键的 `_catCache`，陈旧缓存幽灵路径消除）
> **编号**: 248
>
> **关联**: [ADR-188](adr-188-pbr-material-builder.md)（分类材质系统，materialCategoryMap 覆盖机制）、[ADR-204](adr-204-unit-test-layering-and-hygiene.md)（测试分层，缓存失效须有测试）、[ADR-191](adr-191-god-barrel-debarreling.md)（依赖治理，纯/叶模块零依赖）
>
> **来源**: 2026-08-06 第 13 轮代码审核（`docs/audit/`）幽灵路径：`material.ts` 存在两个分类缓存——`_matCategoryCache`（`getMaterialCategory(mat)` 使用，**不感知 `materialCategoryMap` 变更**）与 `_catCache`（`categoryOfMaterial` 使用，**以 `mapRef` 键控、感知变更**）。`outfit.ts:668` 调用 `getMaterialCategory(sm)` 命中陈旧缓存 → 用户修改 `materialCategoryMap` 后分类不更新。

**决策者**: AtomCode（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

---

## 背景

### 触发证据：双缓存并存，一新一旧（material.ts）

```ts
// 旧缓存：WeakMap<Material, MaterialCategory> — 不感知 materialCategoryMap 变更
const _matCategoryCache = new WeakMap<Material, MaterialCategory>();

// 新缓存：WeakMap<Material, { mapRef: unknown; cat: MaterialCategory }> — 感知变更
const _catCache = new WeakMap<Material, { mapRef: unknown; cat: MaterialCategory }>();
```

`getMaterialCategory(mat)`（被 `outfit.ts` 消费）走旧缓存：用户改 `materialCategoryMap` → 再次调用 → 命中缓存返回旧分类（**幽灵数据**）。`categoryOfMaterial`（material.ts 内部热路径）走新缓存：以 `uiState.materialCategoryMap ?? null` 作 `mapRef`，`mapRef` 变化即重算。

修复：`getMaterialCategory(mat)` 委托 `categoryOfMaterial(mat)`，删除 `_matCategoryCache`，双缓存归一。

## 决策

1. **缓存 key 必须包含其依赖的全部可变引用**：当缓存结果依赖某个可运行时变更的状态（`uiState.materialCategoryMap`、`envState.xxx`、`uiState.xxxMap` 等）时，缓存条目必须携带该依赖的引用（`mapRef`），依赖引用变化（引用相等性失败）即视为缓存失效、重算。
2. **禁止无引用键的派生缓存**：任何「由可变状态派生的结果缓存」（分类、映射、归一化结果），若缓存 key 不含依赖引用，一律视为幽灵路径风险，不允许新写入；既有此类缓存必须迁移为引用键控或删除。
3. **同一派生逻辑的缓存必须单实例**：同一输入→输出映射（如「材质→分类」）不得存在两套缓存（一新一旧、一感知变更一不感知），发现即归一（`_matCategoryCache` → `_catCache` 先例）。
4. **引用相等性 vs 深比较**：`mapRef` 用引用相等（`hit.mapRef === mapRef`）而非深比较——`uiState.materialCategoryMap` 整体替换即触发重算，字段级修改需先替换对象引用（UI 层 `setUIState` 语义），成本低且无深比较歧义。
5. **WeakMap 键防泄漏**：以 Material 等生命周期对象作缓存键时用 WeakMap（避免阻止 GC），缓存条目仅持有值 + 引用键，不持有强引用链。

## 影响

- **修改文件**：`scene/manager/material.ts`（`getMaterialCategory` 委托 `categoryOfMaterial`，删除 `_matCategoryCache`）。
- **测试**：`material-editor.cat-of.test.ts`（12 用例）验证分类逻辑；mapRef 失效路径建议补用例（P3 建议）。
- **验证**：material-editor 相关测试 88/88 通过；无行为回归（分类语义不变，仅缓存策略归一）。

## 回滚

若某缓存结果的依赖状态被证明不可变（模块级常量），可移除引用键——但须在 ADR 中说明「依赖不可变」依据，且该状态将来变为可变时必须补回引用键。

## 检查清单（供 code review / 子代理审核复用）

- [ ] 派生缓存（分类/映射/归一化结果）key 含全部可变依赖引用
- [ ] 同一派生逻辑无第二套缓存（grep 同名 WeakMap/Map 双实例）
- [ ] `mapRef` 用引用相等比较，依赖替换即失效
- [ ] 以生命周期对象为键用 WeakMap，无强引用泄漏
