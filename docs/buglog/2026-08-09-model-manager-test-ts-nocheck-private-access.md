> **状态**: 🟡 搁置
>
> **日期**: 2026-08-09
> **严重程度**: 🟡 P3
> **影响范围**: `frontend/src/__tests__/model-manager.constructor.test.ts`（同类：`model-manager.focus.test.ts`、`model-manager-mocks.ts` 及全部分拆测试族）
> **发现方式**: 开发发现
> **搁置原因**: 测试组织债，非源码缺陷；`@ts-nocheck` 是 vi.mock 运行时替换 Babylon 类型的统一组织模式，单文件修补反破坏测试族一致性

# model-manager 测试：`@ts-nocheck` 全局抑制 + 直接访问 private 字段

**日期**: 2026-08-09
**关联**: model-manager 拆分测试族（constructor / focus / physics / transform / vmd-morph / bone-overlay）

---

## 问题描述

`model-manager.constructor.test.ts` 以 `@ts-nocheck` 全局抑制类型检查（第 1 行），并在测试中直接访问 `ModelManager` 的 private 字段 `_initialRigidBodyStates`（第 113 行 `mgr._initialRigidBodyStates.get('m1')`）。`@ts-nocheck` 抑制了「访问 private 字段」的编译错误，属于测试侧绕封装。

## 根因分析

1. **`@ts-nocheck` 是组织模式而非本文件缺陷**：Babylon.js mock 类型由 `vi.mock` 运行时替换，`model-manager-mocks.ts` 与全部 `model-manager.*.test.ts` 统一使用 `// @ts-nocheck` 声明（同构的 library-core.* / camera.* / material-editor.* 测试族亦然）。单独给本文件移除会破坏一致性。
2. **可测性缺口**：`storeRigidBodyState` 有公开写入 API（`model-manager.ts:263`），但「验证拷贝而非同一引用」需要读回内部缓存，而私有 Map 没有公开只读 getter，测试被迫触达私有字段断言。
3. **两套触达模式并存**：`model-manager.*.test.ts` 靠 `@ts-nocheck` 直接访问；`scene-model.test.ts:73` 用 `(mgr as any)` 显式断言。说明无统一约定。

## 修复方案

**决定：暂不修。** 依据：

- 源码侧封装正常（`private _initialRigidBodyStates` 的可见性是合理设计），无用户可见症状，非源码缺陷。
- `@ts-nocheck` 的移除属测试族级重构，需同步处理 Babylon mock 类型声明，风险与收益不成比例。

**将来若改进（长治久安方向）**：

- 给 `ModelManager` 补私有缓存的只读访问途径（如测试专用 getter 或经 `restore` 行为断言），把断言从「白盒字段」改为「行为验证」；
- 统一 `@ts-nocheck` / `(mgr as any)` 两种触达模式为一种，列入测试组织规范。

## 教训

- 测试触达 private 字段是「可测性缺口」信号：优先考虑补只读接口或改行为断言，而非依赖 `@ts-nocheck`/`as any` 静默绕过。
- `@ts-nocheck` 在 vi.mock 运行时替换场景是合理的组织手段，审计时应区分「组织债」与「源码缺陷」，勿为一致性破坏测试族根基。
