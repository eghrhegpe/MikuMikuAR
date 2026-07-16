# ADR-119: 缩略图缓存键单一源治理

> **状态**: Phase 1 已完成（模型 + 道具写侧已收口至 `thumbnail-key.ts`；VMD 死路径与 meta 缓存错位列为 deferred，待批）；契约测试 `thumbnail-key.contract.test.ts` 已作防反弹熔断丝（16 例全过）
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
| 写侧-VMD | `renderInstanceThumbnail(scene, inst, vmdPath \|\| name)` | `vmd-loader.ts:192/195` |
| 读侧 | `libraryModelBaseKey(m)` + `buildThumbnailKey` | `library-core.ts:159 thumbnailKeyForModel` |
| 读侧宽高比 | `isStageLike(m.type)` | `library-core.ts:222` |
| 内存缓存 `thumbnailCache` | 仅 `set`（写），**全仓无 `get`/`has`** | `state.ts:160`、`thumbnail-capture.ts:254` |
| 实际读取路径 | `GetThumbnailBatch(keys)`（Go 侧读磁盘缓存） | `library-core.ts:433`、`library-actions.ts:95` |

### 1.2 取值域核对结论（P0 前提验证）

- `ModelInstance.kind` ∈ `actor` / `stage` / `prop`（运行时）。
- `LibraryModel.type`（Go `ModelEntry.Type`，`app.go:272`）实际取值：`actor` / `motion` / `stage` / `dressing` / `bundle` / `effect` / `scene` / `other`，**外加 `prop`**（注释枚举不全，道具分类在 `library.go:114` 返回 `"prop"`）。
- `isStageLike` = `'stage' | 'scene' | 'prop'`。**actor / stage / prop 三类在两侧取值完全对齐**，故 `isStage` 判定**不是**漂移点。
- baseKey 基底：写侧 `libraryPath ?? filePath`，读侧 `file_path`；库加载 `libraryPath: m.file_path`（`library-actions.ts:299`）、道具 `req.path === m.file_path`（`load-manager.ts:97/103`）。**基底语义等价**。
- **唯一历史漂移点 = res/aspect 的「双源字符串拼接」本身**（写 `thumbnail-capture.ts` / 读 `library-core.ts` 各拼一次）。

### 1.3 痛点

- **反弹难治本**：双源拼接，任一侧（含注释误导的 "漏拼 zip_inner" 误判）微调即 miss。
- **死路径噪音**：`thumbnailCache` 内存 Map 只写不读；VMD 缩略图写盘后无任何 UI 消费。二者持续产生无谓渲染 / 磁盘缓存条目，强化"存储不可靠"的体感。
- **元数据缓存错位（独立子系统）**：`modelMetaCache.get(inst.filePath)`（`model-detail.ts:311`）按 `m.file_path` 写入，但 zip 模型 `inst.filePath` 为解压临时路径 ≠ `m.file_path` → 详情面板元数据 miss。属 metadata 子系统，非缩略图键问题，本 ADR 不覆盖。

---

## 二、决策

**抽唯一纯函数 `thumbnail-key.ts`，所有写/读侧经它构造 key；契约测试锁死 `writeKey === readKey`。**

| 路线 | 结论 |
|------|------|
| A. 键推导单一化（采纳） | 新建 `thumbnail-key.ts`：`thumbnailBaseKey` / `libraryModelBaseKey` / `buildThumbnailKey` / `thumbnailKeyForKind`。三处调用点改调；契约测试当熔断丝 |
| B. 内容寻址（演进项，未做） | 键改为模型文件内容 SHA256（Go 侧 `thumbnail.Save` 已有 SHA256 落盘可复用），路径/重命名彻底免疫。留待后续评估 |
| C. 元数据内嵌（否决） | `GetModelMeta` DTO 内 `thumbnail` base64 字段从未被 UI 消费，是幽灵第二数据源，应删（见 deferred） |

---

## 三、实施

### Phase 1 — 已落地（commit 47fab97 + 本轮）

- 新建 `frontend/src/scene/manager/thumbnail-key.ts`：唯一 key 推导源。
- **模型写侧**：`model-loader.ts:173` 改调 `thumbnailBaseKey`；`thumbnail-capture.ts:113` `buildThumbnailKey`。
- **读侧**：`library-core.ts:159 thumbnailKeyForModel` 经 `libraryModelBaseKey` + `buildThumbnailKey`。
- **道具写侧（本轮）**：`props.ts:157` 改调 `thumbnailBaseKey({ filePath: inst.filePath })`，经统一源收口（道具无 `innerPath`，输出与裸 `inst.filePath` 等价，零行为变化）。
- **契约测试**：`thumbnail-key.contract.test.ts`（模型 actor/stage/prop × 普通/zip + 道具 3 路径 = 16 例），断言写侧/读侧 key 逐字节相等。

### Deferred — 待批

| 项 | 建议 | 风险 |
|----|------|------|
| 🟡 VMD 缩略图死路径（`vmd-loader.ts:180-199`） | 无任何 UI 读取。建议：删除该死写路径（省一次 RT 渲染 + 磁盘缓存写入）；或若 motion 缩略图为规划特性，则在 motion 列表侧补 `thumbnailKeyForKind` 读侧并接线。需用户拍板 | 删除属行为变更，应先确认无隐藏消费 |
| 🟡 `thumbnailCache` 内存 Map 死代码（`state.ts` / `thumbnail-capture.ts`） | 全仓只写不读，建议随 VMD 清理一并移除或改为真正的内存读取层 | 纯死代码，移除零风险 |
| 🟢 `GetModelMeta.thumbnail` 冗余 base64 字段 | 从未消费，删除以消灭第二数据源 | 删 DTO 字段需同步 Go 侧 `app.go` |
| 🟢 meta 缓存错位（`model-detail.ts:311`） | 独立子系统（metadata 非 thumbnail）。zip 模型 `inst.filePath`≠`m.file_path` 致详情面板元数据 miss。建议 meta 缓存也改走 `thumbnailBaseKey` 同源 key，或在详情面板改用 `computeLibraryRef(inst.filePath)` 归一 | 独立 ADR/P 处理，不在本 ADR 范围 |

---

## 四、验证

- `npx tsc --noEmit`：0 错误。
- `vitest thumbnail-key.contract.test.ts`：16/16 通过。
- `library-core.test.ts`：103/103 零回归（P0 已验）。
- 行为等价：道具收口前后 key 输出完全一致（`thumbnailBaseKey({filePath})` ≡ 输入 `filePath`）。

## 五、结论

反弹的结构性根因（双源拼接）已消除，模型 + 道具写/读两侧均经由 `thumbnail-key.ts` 单一源，契约测试作为防反弹熔断丝。剩余 VMD 死路径与 meta 缓存错位是**独立且不在键双源范围内**的问题，列为 deferred 待用户拍板，避免无确认大改动。
