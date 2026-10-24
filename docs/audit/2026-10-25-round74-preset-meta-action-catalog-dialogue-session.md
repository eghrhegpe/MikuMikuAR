# Round 74 审核报告 — preset-meta / action-catalog / dialogue-session

> **日期**: 2026-10-25
> **模式**: 继续 `test-files.txt` 队列，按队列顺序取首批 3 个未审测试文件（round-73 之后的下一批）；主模型直接审核（三模块合计 ~550 行，子代理开销不成比例）。
> **范围**: `frontend/src/core/__tests__/preset-meta.test.ts` + `preset-meta.ts`、`frontend/src/core/ai/__tests__/action-catalog.test.ts` + `action-catalog.ts`、`frontend/src/core/ai/__tests__/dialogue-session.test.ts` + `dialogue-session.ts`（及上游 `action-registry.ts` / `character-bible.ts` 类型面）

---

## 执行摘要

| 模块 | 文件 | 结论 | 关键发现 |
|------|------|------|----------|
| preset-meta | `frontend/src/core/preset-meta.ts`（99 行） | ✅ 通过 | P3×1（零生产消费方的前瞻模块）、P4×2 |
| action-catalog | `frontend/src/core/ai/action-catalog.ts`（105 行） | ✅ 通过（本轮补测） | P4×2（缺 3 种参数类型测试——已补 4 用例；同义词记法不统一——登记） |
| dialogue-session | `frontend/src/core/ai/dialogue-session.ts`（34 行） | ✅ 通过 | P4×1（activeBible 不持久化，ADR-156 注释已声明为后续扩展） |

**本轮修复**：`action-catalog.test.ts` 补 4 用例（15→19），覆盖 `boolean`/`toggle`/`string` 参数 schema 生成 + catalog 文本参数形态 + enum 同义词形态。零源码改动。

---

## 逐模块结论

### preset-meta — 读侧归一（ADR-130 Phase 2.7）

**亮点**
- 四系统（env/render/scene/model）list 结果归一为 `PresetMeta[]`，`id` 用 `${category}:${name}` 前缀天然消跨类重名（`frontend/src/core/preset-meta.ts:41`）
- Go nullable 返回逐分支 `?? []` 守卫（:65/:74/:81/:89），NPE 免疫
- 上游契约有锁定：`browser-adapter.contract.test.ts:126,141` 分别钉死 `GetModelPresets`/`ListEnvPresets` 的条目形状，读侧与写侧形状不漂移

**风险**

| 文件 | 位置 | 观察 | 建议 |
|------|------|------|------|
| 🟡 P3 | `frontend/src/core/preset-meta.ts` 全模块 | **零生产消费方**：`listPresets`/`toPresetMeta` 仅被自身测试引用（全仓 grep 确认），属 ADR-130 有意前瞻（"供未来的跨类浏览/排序/标签筛选/搜索复用"） | 维持现状（ADR 背书）；若 2 个版本后仍无消费方，按死码基线处置 |
| 🟢 P4 | `frontend/src/core/preset-meta.ts:57-99` | 四分类**串行** await，聚合调用为 4 次 round-trip；任一 backend 绑定 reject 则整体 reject，无单类降级 | 有真实消费方时再改 `Promise.all` + 逐类 try/catch，避免为无消费方代码调优 |
| 🟢 P4 | `frontend/src/core/preset-meta.ts:68` | model 预设 `updatedAt` 复用为 `createdAt`（注释已声明语义漂移） | 写侧信封化（ADR-130 挂起项）落地时自然消除 |

### action-catalog — LLM Tool Schema 双产物（ADR-155/197）

**亮点**
- `paramToJsonSchema` 的 switch 穷尽 `ParamType` 全部 7 成员（`frontend/src/core/action-registry.ts:7`），strict 下天然 exhaustiveness 护栏
- `buildToolSchemas` 与 `buildToolCatalogText` 同用 `!a.uiOnly` 过滤，两产物动作集一致（`frontend/src/core/ai/action-catalog.ts:53,80`）
- description 走 `t(a.label)`，LLM 描述随 UI 语言切换（:67-68 注释引 ADR-155）

**风险**

| 文件 | 位置 | 观察 | 建议 |
|------|------|------|------|
| 🟢 P4 | `frontend/src/core/ai/action-catalog.ts:23-27 vs :88-93` | 两份 LLM 产物对同义词记法不一致：JSON schema description 用 `k→v`，文本 catalog 用 `k=v` | 统一为单一记法（LLM 均可解析，纯一致性收益，不急） |
| 🟢 P4 | `frontend/src/core/ai/action-catalog.ts:97,101` | 文本 catalog 面向 LLM 的片段（`名称`/`[需确认]`/`[只读，自动执行]`）硬编码中文，仅 catalogHeader 走了 i18n | LLM 对中文标记无语义障碍，可接受；若 LLM 侧出现非中文理解偏差再 i18n 化 |
| 🟢 P4（已修） | 测试侧 | `boolean`/`toggle`/`string` 三种参数类型的 schema 生成与 catalog 文本形态零覆盖 | **本轮已补 4 用例**（`action-catalog.test.ts`：boolean/toggle → `{type:'boolean', description:name}`；string → `{type:'string'}`；catalog 文本 `name:type`；同义词 `k=v` 形态钉死） |

### dialogue-session — 角色圣经单点状态（ADR-156）

**亮点**
- 全模块仅一处模块级 state（`_activeBibleId`），写入点唯一（`setActiveBible`），且经 `getBible(id).id` 归一——非法/空字符串 id 兜底到内置首个，测试双钉（:32-36、:45-49）
- 上游 `character-bible.ts` 纯函数零副作用（126 行，`BUILTIN_BIBLES as const`），`parseDialogueLines` 容错链完整（非法情绪→neutral、解析失败→整段兜底，UI 永不空）
- 消费方 `menus/diagnostic-chat.ts:10-15` 四函数全用，无死导出

**风险**

| 文件 | 位置 | 观察 | 建议 |
|------|------|------|------|
| 🟢 P4 | `frontend/src/core/ai/dialogue-session.ts:14` | activeBible 不持久化：HMR/重开应用后重置为 miku | 模块注释已声明"便于后续扩展（用户自定义角色/序列化）"，与 UI 层 settings 持久化一起做，不单修 |

---

## 验证

| 项 | 结果 |
|---|---|
| 三测试文件 vitest | 3 文件 31 用例全绿（310ms；action-catalog 15→19） |
| `npm run check`（tsc + 棘轮 + i18n parity） | exit 0；i18n 5 语言 1879 键全对齐 |

## 队列状态

`test-files.txt` 308 项，本轮前未审 42 项 → 本轮消 3 项（preset-meta / action-catalog / dialogue-session）。下一批（队列顺序）：`dialogue-speech.test.ts`、`backend.capabilities.test.ts`、`backend.extract.test.ts`；后续还有 core/backend 余 7 项、scene 4 项（ar-webxr-probe / pmx-texture-audit / texture-fallback / transform-mode）、Go 测试 12 项（round-14 只审了 Go 源码未审 Go 测试文件）、scripts 16 项、python 2 项。
