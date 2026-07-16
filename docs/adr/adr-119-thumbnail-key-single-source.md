# ADR-119: 缩略图缓存键单一源治理

> **状态**: Phase 1 + Phase 2 已完成（模型 + 道具写侧收口至 `thumbnail-key.ts`；VMD 缩略图死路径已删除；meta 缓存错位已修复）。后续审计曾将 `thumbnailCache` 内存缓存与 `GetModelMeta.thumbnail` 列为待清理 deferred，经核实二者均**无需清理**（`thumbnailCache` 为活跃 UI 缩略图数据源；`ModelMeta` 本无 `thumbnail` 字段，先前误将 `DanceSet.Thumbnail` 归错）。治理已闭环。契约测试 `thumbnail-key.contract.test.ts` 已作防反弹熔断丝（16 例全过）
> **背景**: 「截角色图」经 12 轮修改反复反弹。根因不是渲染逻辑（`thumbnail-capture.ts` 的并发互斥 / 物理冻结 / 投影冻结 / 翻转均正确），而是**缓存键（cache key）被两套独立代码、从两套不同数据模型各推导一次**——写侧（`ModelInstance`/运行时 `filePath` + `kind`）与读侧（`LibraryModel`/库元数据 `file_path` + `type`）各自用字符串拼接构造 `<baseKey>::<resolution>::<aspect>`，任何一侧微调即导致缓存 miss → 缩略图"消失/重生"。这是典型的"状态来源不唯一"，修一处裂另一处。
> **关联**: [ADR-100](adr-100-camera-control-behavior-dual-axis.md)（渲染收尾）、thumbnail 物理冻结修复、[ADR-105](adr-105-abort-signal-and-async-error-handling.md)（加载流程 AbortSignal）

---

## 一、问题边界

### 1.1 现状清点

| 项 | 事实 | 来源 |
|----|------|------|
| key 格式 | `<baseKey>::<resolution>::<aspect>` | `thumbnail-capture.ts:113` `buildThumbnailKey` |
| 写侧-模型 | `thumbnailBaseKey({ libraryPath, filePath, innerPath })` | `model-loader.ts:173`（P0 已收口） |
| 写侧-道具 | `thumbnailBaseKey({ filePath: inst.filePath })` | `props.ts:157`（本轮收口） |
| 写侧-VMD | `renderInstanceThumbnail(scene, inst, vmdPath \|\| name)`（**已删除，2026-07-16**） | 原 `vmd-loader.ts:192/195` |
| 读侧 | `libraryModelBaseKey(m)` + `buildThumbnailKey` | `library-core.ts:159 thumbnailKeyForModel` |
| 读侧宽高比 | `isStageLike(m.type)` | `library-core.ts:222` |
| 内存缓存 `thumbnailCache` | **活跃 UI 数据源**：`ui-resource-panel.ts` 用 `liveThumbnailCache.has/get` 渲染缩略图 + 冷缓存回填；`renderGrid/renderList/createVirtualGrid` 消费它 | `state.ts:154-164`、`ui-resource-panel.ts:7,102,117` |
| 实际读取路径 | `GetThumbnailBatch(keys)`（Go 侧读磁盘缓存） | `library-core.ts:433`、`library-actions.ts:95` |

### 1.2 取值域核对结论（P0 前提验证）

- `ModelInstance.kind` ∈ `actor` / `stage` / `prop`（运行时）。
- `LibraryModel.type`（Go `ModelEntry.Type`，`app.go:272`）实际取值：`actor` / `motion` / `stage` / `dressing` / `bundle` / `effect` / `scene` / `other`，**外加 `prop`**（注释枚举不全，道具分类在 `library.go:114` 返回 `"prop"`）。
- `isStageLike` = `'stage' | 'scene' | 'prop'`。**actor / stage / prop 三类在两侧取值完全对齐**，故 `isStage` 判定**不是**漂移点。
- baseKey 基底：写侧 `libraryPath ?? filePath`，读侧 `file_path`；库加载 `libraryPath: m.file_path`（`library-actions.ts:299`）、道具 `req.path === m.file_path`（`load-manager.ts:97/103`）。**基底语义等价**。
- **唯一历史漂移点 = res/aspect 的「双源字符串拼接」本身**（写 `thumbnail-capture.ts` / 读 `library-core.ts` 各拼一次）。

### 1.3 痛点

- **反弹难治本**：双源拼接，任一侧（含注释误导的 "漏拼 zip_inner" 误判）微调即 miss。
- **死路径噪音**：VMD 缩略图写盘后无任何 UI 消费（已删除）；`thumbnailCache` 实为活跃 UI 数据源（先前误判为只写不读），非噪音。
- **元数据缓存错位（已修复，2026-07-16）**：`modelMetaCache.get(inst.filePath)`（`model-detail.ts:311`）按 `m.file_path` 写入，但 zip 模型 `inst.filePath` 为解压临时路径 ≠ `m.file_path` → 详情面板元数据 miss。现已让 `ModelInstance` 携带 `libraryPath`（库引用绝对路径，==`m.file_path`），读侧改 `inst.libraryPath ?? inst.filePath` 对齐写侧 key。属 metadata 子系统，非缩略图键问题，本 ADR 不覆盖但一并修复。

---

## 二、决策

**抽唯一纯函数 `thumbnail-key.ts`，所有写/读侧经它构造 key；契约测试锁死 `writeKey === readKey`。**

| 路线 | 结论 |
|------|------|
| A. 键推导单一化（采纳） | 新建 `thumbnail-key.ts`：`thumbnailBaseKey` / `libraryModelBaseKey` / `buildThumbnailKey` / `thumbnailKeyForKind`。三处调用点改调；契约测试当熔断丝 |
| B. 内容寻址（演进项，未做） | 键改为模型文件内容 SHA256（Go 侧 `thumbnail.Save` 已有 SHA256 落盘可复用），路径/重命名彻底免疫。留待后续评估 |
| C. 元数据内嵌（否决） | 早期曾疑 `GetModelMeta` DTO 内 `thumbnail` base64 字段为幽灵第二数据源，但核实 `ModelMeta` 结构体仅含 `NameJp/NameEn/Comment`，无 `thumbnail` 字段（先前误将 `DanceSet.Thumbnail` 归错），故该路线前提不成立 |

---

## 三、实施

### Phase 1 — 已落地（commit 47fab97 + 本轮）

- 新建 `frontend/src/scene/manager/thumbnail-key.ts`：唯一 key 推导源。
- **模型写侧**：`model-loader.ts:173` 改调 `thumbnailBaseKey`；`thumbnail-capture.ts:113` `buildThumbnailKey`。
- **读侧**：`library-core.ts:159 thumbnailKeyForModel` 经 `libraryModelBaseKey` + `buildThumbnailKey`。
- **道具写侧（本轮）**：`props.ts:157` 改调 `thumbnailBaseKey({ filePath: inst.filePath })`，经统一源收口（道具无 `innerPath`，输出与裸 `inst.filePath` 等价，零行为变化）。
- **契约测试**：`thumbnail-key.contract.test.ts`（模型 actor/stage/prop × 普通/zip + 道具 3 路径 = 16 例），断言写侧/读侧 key 逐字节相等。

### Phase 2 — 已落地（commit 本轮，2026-07-16）

- **VMD 缩略图死路径删除**：`vmd-loader.ts:180-199` 的 `renderInstanceThumbnail` 调用块已移除。核实 `GetThumbnailBatch` 仅模型调用、VMD 缩略图写盘后无任何 UI 消费 → 纯浪费，删除零功能损失。`seekAnimation(0)`（纠正切换动作时钟滞留致 onPause）保留，与缩略图截帧无关。删除后 `scene` 仍被 `new VmdLoader(scene)` 等使用，无悬挂引用；`vmdPath` 参数因 `noUnusedParameters:false` 不报错。
- **meta 缓存错位修复**：`core/types.ts` 的 `ModelInstance` 新增可选 `libraryPath` 字段（= 库引用绝对路径 `m.file_path`）；`model-loader.ts` stage/actor 两处 inst 构造赋值 `libraryPath`（捕获 `loadPMXFile` 的 `libraryPath` 参数，普通模型为 `undefined`、zip 模型为 `m.file_path`）；`model-detail.ts:311` 读侧改 `modelMetaCache.get(inst.libraryPath ?? inst.filePath)`。zip 模型详情面板元数据现可命中，普通模型回退 `inst.filePath` 零行为变化。

### Deferred — 经核实无需清理（2026-07-16 收尾审计）

| 项 | 核实结论 | 处置 |
|----|----------|------|
| ✅ VMD 缩略图死路径（`vmd-loader.ts:180-199`） | **已删除（2026-07-16）**：无任何 UI 读取，纯浪费 | 已执行，零功能损失 |
| ❌ `thumbnailCache` 内存 Map「死代码」 | **误判纠正**：`ui-resource-panel.ts:102,117` 用 `liveThumbnailCache.has/get` 渲染缩略图 + 冷缓存回填，`renderGrid/renderList/createVirtualGrid` 消费它 → 是活跃 UI 数据源，**不可删** | 撤销 deferred |
| ❌ `GetModelMeta.thumbnail` 冗余字段 | **前提错误**：`ModelMeta`（app.go:292-296）仅含 `NameJp/NameEn/Comment`，**无 `thumbnail` 字段**；先前误将 `DanceSet.Thumbnail`（app.go:305，dance set 功能预留扩展点，构造赋空串、无消费）归错；该 DanceSet 特性已于 2026-07-16 整体删除。前端 `ModelMeta` 类型本就不含该字段，两端一致 | 撤销 deferred |
| ✅ meta 缓存错位（`model-detail.ts:311`） | **已修复（2026-07-16）**：`ModelInstance.libraryPath` 携带库引用路径，读侧 `inst.libraryPath ?? inst.filePath` 对齐写侧 `m.file_path` | 独立 metadata 子系统，已一并修复 |

> 附注：`DanceSet.Thumbnail`（app.go:305）原为 dance set 功能的预留字段（恒空串、无消费），当时判定为规划扩展点而非死代码、未删除；该 DanceSet 特性已于 2026-07-16 整体删除，此预留字段随特性一并移除。

---

## 四、验证

- `npx tsc --noEmit`：0 错误。
- `vitest thumbnail-key.contract.test.ts`：16/16 通过。
- `library-core.test.ts`：103/103 零回归（P0 已验）。
- 行为等价：道具收口前后 key 输出完全一致（`thumbnailBaseKey({filePath})` ≡ 输入 `filePath`）。

## 五、结论

反弹的结构性根因（双源拼接）已消除，模型 + 道具写/读两侧均经由 `thumbnail-key.ts` 单一源，契约测试作为防反弹熔断丝。VMD 缩略图死路径已删除、meta 缓存错位已修复（独立 metadata 子系统，顺带归一）。后续审计曾将 `thumbnailCache` 与 `GetModelMeta.thumbnail` 列为 deferred 清理项，经收尾核实二者均**无需清理**（`thumbnailCache` 为活跃 UI 数据源；`ModelMeta` 本无 `thumbnail` 字段，先前误将 `DanceSet.Thumbnail` 归错）。缩略图治理已闭环。
