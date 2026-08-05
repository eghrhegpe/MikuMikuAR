# ADR-246: 序列化往返显式字段原则 —— 判别字段必须显式持久化，禁止反推

> **日期**: 2026-08-06
> **状态**: ✅ 已立（2026-08-06 立项；bone-override 往返修复已落地：`BoneOverrideEntry` 增 `overrideRotation?: boolean`，`restoreOverrides` 优先用显式字段、旧数据回退 `!e.position` 推断）
> **编号**: 246
>
> **关联**: [ADR-123](adr-123-compute-override-semantics.md)（骨骼覆盖 absolute 显式序列化先例）、[ADR-226](adr-226-ground-material-spec-single-source.md)（spec 单源，结构性字段显式化）、[ADR-137](adr-137-envstate-single-source-schema.md)（EnvState 单源 schema）
>
> **来源**: 2026-08-05 第 12 轮代码审核（`docs/audit/`）P2：`bone-override.ts` `restoreOverrides` 用 `overrideRotation: !e.position` **反推**覆盖类型，slot 同时含旋转+位置覆盖时（`setBoneOverride` 后 `setBoneOverridePosition`），序列化往返后旋转覆盖静默丢失。同轮 `browser-adapter.ts` `GetRenderPresets` 把存储的 `params` 字符串当 `RenderPreset` 对象读，`.name`/`.params` 得 undefined，属同族「存储形态与读取形态不一致」问题。

**决策者**: AtomCode（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

---

## 背景

### 触发证据一：`restoreOverrides` 反推覆盖类型（bone-override.ts）

```ts
// 修复前：用 position 字段反推 overrideRotation
overrideRotation: !e.position,
```

`_slotToEntry`（序列化方向）输出 `position` 字段，`restoreOverrides`（反序列化方向）用 `!e.position` 推断 `overrideRotation`：

| slot 状态 | 序列化后 | 反序列化推断 | 结果 |
|-----------|---------|-------------|------|
| 纯旋转（overrideRotation=true, 无 pos） | position=undefined | `!undefined` = true | ✅ 正确 |
| 纯位置（overrideRotation=false, 有 pos） | position=[x,y,z] | `![x,y,z]` = false | ✅ 正确 |
| **旋转+位置**（overrideRotation=true, 有 pos） | position=[x,y,z] | `![x,y,z]` = false | ❌ **旋转覆盖静默丢失** |

反推在「判别字段与另一字段的组合状态」下必然失真——这是**信息论层面**的缺陷，不是实现疏漏。

### 触发证据二：`GetRenderPresets` 存储形态与读取形态不一致（browser-adapter.ts）

`SaveRenderPreset` 存 `params` 字符串，`GetRenderPresets` 用 `idbGet<RenderPreset>` 读 → 调用方拿到 string 却当 `{name, params}` 对象用。

## 决策

1. **判别字段显式持久化**：凡是「运行时存在多种形态、序列化后需要区分」的状态（覆盖类型、启用标志、模式标志等），必须在持久化结构体中**显式声明判别字段**（如 `overrideRotation?: boolean`），禁止用其他字段反推。
2. **反推仅作旧数据回退**：显式字段缺失时（旧存档/旧缓存），才允许用启发式推断回退（`e.overrideRotation ?? !e.position`），且必须在注释中标注「旧数据回退，新数据走显式字段」。
3. **存储形态与读取形态必须同构**：写入的字节形态（string / 对象 / 数组）必须与读取解析后的结构一致；不一致时（如历史 string 存储）在读取侧归一化并补测试（`GetRenderPresets` 已按此修复：string → `{name, params: JSON.parse}`）。
4. **序列化字段增减即行为契约变更**：任何 `*Entry` / `*Spec` 持久化结构体的字段增删，必须同步检查序列化方向（to）与反序列化方向（from）两处，并补往返测试。

## 影响

- **修改文件**：`core/types.ts`（`BoneOverrideEntry` 增 `overrideRotation`）、`scene/motion/bone-override.ts`（`_slotToEntry` 输出 + `restoreOverrides` 优先显式字段）、`core/backend/browser-adapter.ts`（`GetRenderPresets` 归一化）。
- **测试**：`bone-override.test.ts` 现有 computeOverride 用例；建议补往返用例（getAllOverrides → restoreOverrides）锁定旋转+位置组合（P3 建议，未落地）。
- **验证**：bone-override 相关测试 120/120 通过；无行为回归（旧数据回退保留 legacy 语义）。

## 回滚

若某判别字段确无组合状态（单一形态），可移除显式字段改回推断，但须在 ADR 中说明该字段形态单一、推断无损。

## 检查清单（供 code review / 子代理审核复用）

- [ ] `*Entry`/`*Spec` 持久化结构体：判别字段全部显式声明，无「用 A 字段推断 B 语义」的反推
- [ ] 序列化方向与反序列化方向字段一一对应（`to`/`from` 两处同步检查）
- [ ] 读取侧归一化（历史形态 → 当前形态）有测试覆盖
