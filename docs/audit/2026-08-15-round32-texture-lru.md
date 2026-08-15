# texture-lru — 审核结果（round-32 / 测试 2）

**审核范围**
- 测试文件：`frontend/src/__tests__/scene/texture-lru.test.ts`（218 行，12 用例，全部通过）
- 被测源码：`frontend/src/scene/shared/texture-lru.ts`（107 行，全文件）
- 背景决策：ADR-189「纹理加载路径优化」Phase 1.3 LRU 缓存（2026-07-26 初版，含审核修订：AbortSignal / in-flight 去重 / 世代计数）
- 生产调用链（交叉核查）：`model-loader.ts:290`（collectTextureFiles 接入 LRU）、`outfit.ts:294`（换装纹理共享缓存）、`renderer.ts:146/163`（disposeRenderer → clearTextureLRU，scene.ts:325/830 亦有调用路径）

**总体结论：✅ 通过**

无 P1/P2 风险。模块 107 行、职责单一、类型干净（0 处 `as any`/`@ts-ignore`）、异常路径与并发路径均有对应测试覆盖；12/12 测试通过（实测 `npm run test -- src/__tests__/scene/texture-lru.test.ts`，1.59s，全绿）。仅 2 项 P3（测试断言/可测性）与 5 项 P4（死字段/文档漂移/边界假设）。

---

## 亮点

- **O(1) 近似 LRU 驱逐**：基于 Map 插入顺序，命中时 `delete+set` 重排到尾部、溢出时 `delete(keys().next())` 淘汰最旧（`texture-lru.ts:32-37, 51-58`），无双向链表；ADR-189 §1.3 设计完整落地。
- **in-flight 去重**：`_inFlight` Map 让并发同 key 读取共享同一 promise，避免重复读盘；`.finally` 保证 reject/正常完成均清理（`texture-lru.ts:25, 62-66, 84-88`），测试 10 验证"只调一次 readFileBytes、单条目缓存"。
- **世代计数防陈旧重填**：`clearTextureLRU` 自增 `_generation`，in-flight 完成时世代已变则跳过缓存插入——dispose 后迟到结果不再污染已清空的缓存（`texture-lru.ts:30, 67, 75-77, 95`），测试 12 精准覆盖。
- **AbortSignal 双段检查**：读前（`:59-61`）与读后（`:70-72`）均检查，与 ADR-189 风险表"aborted 则不入缓存"缓解措施一致，测试 6/7 覆盖。
- **异常处理规范**：`readFileBytes` reject 不吞错、经 `.finally` 清理 in-flight 后向上传播；`null` 返回不入缓存（`texture-lru.ts:84-86`），测试 1/11 覆盖；调用方 model-loader 有 catch → logWarn fallback。
- **资源释放闭环**：`clearTextureLRU()` 同时清 `_textureLRU` + `_inFlight`（`:92-96`），由 `disposeRenderer` 触发；本模块只持有 ArrayBuffer（GC 回收），不创建 Blob URL（下游 babylon-mmd 创建、由 Babylon Texture.dispose 管理），无泄漏点。
- **测试与修复注释一一对应**：生产代码 `[fix P3]`（in-flight）、`[fix code_review P3]`（世代/清理一致性）每条修复都有对应测试，是"测试反推源码"的正面案例。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | — | — | 无 | — |
| 🟠 P2 | — | — | 无 | — |
| 🟡 P3 | frontend/src/__tests__/scene/texture-lru.test.ts | 74-87 | 驱逐测试「evict oldest」只断言 `textureLRUSize() === MAX`，未断言被淘汰的确实是 `tex0`（未验证 LRU 顺序）；顺序正确性实际由测试 5（89-123，promote 后 a 存活）间接覆盖，测试 4 单独成立为弱断言 | 断言淘汰后 `tex0` 再读会触发第二次 readFileBytes（`mockReadFileBytes` 计数 +1）、或断言 `tex149` 仍命中缓存，使驱逐语义被直接验证 |
| 🟡 P3 | frontend/src/__tests__/scene/texture-lru.test.ts | 75, 109, 114 | 生产常量 `TEXTURE_LRU_MAX_ENTRIES` 未导出，测试用魔法字面量复刻（`5 * 30`、`toBe(150)`）；常量一旦变更（如校准为 180），测试 4/5 会静默失配——尤其测试 5 的 `fillCount = 150 - 3` 固定，容量变大后 overflow 不再触发驱逐、测试退化为只验证"命中仍在" | 生产侧导出 `TEXTURE_LRU_MAX_ENTRIES`（或测试专用只读访问器），测试引用导出值计算 `MAX`/`fillCount`，消除字面量复制 |
| 🟢 P4 | frontend/src/scene/shared/texture-lru.ts | 11, 54, 81 | `lastUsed` 字段只写不读（全仓 3 处写入、0 处读取）——驱逐实际依赖 Map 插入顺序，该字段为死状态，维护者易误以为驱逐按时间戳 | 删除字段，或让驱逐真正读取它并注释 Map 顺序与时间戳的一致性关系 |
| 🟢 P4 | frontend/src/scene/shared/texture-lru.ts | 20 | 容量按条目数（150）而非字节数：单条 4K 纹理可达 20MB+，最坏 ~600MB 常驻；ADR-189 风险表已记录"按模型数×平均纹理数估算，待 Phase 1 统计校准"（接受项） | Phase 1 运行时统计实际纹理数后校准；如需更强保障可加字节级上限或按模型维度分组 |
| 🟢 P4 | frontend/src/scene/shared/texture-lru.ts | 51-58 | 命中路径不检查 `signal.aborted`：abort 后仍返回缓存数据。行为合理（缓存命中零 IO、数据仍新鲜），但与注释"abort 后不入缓存"语义有歧义 | 注释明确"abort 仅约束读盘与写入，不约束命中返回"，避免后续维护者误改 |
| 🟢 P4 | frontend/src/scene/shared/texture-lru.ts | 81 | `data.buffer as ArrayBuffer` 假设后端返回 byteOffset=0 的满视图；若未来某 adapter 返回子视图（subarray），将缓存整块底层 buffer 含多余字节 | 加防御 `data.byteOffset === 0 ? data.buffer : data.buffer.slice(data.byteOffset, ...)`，或后端契约明确"始终返回满视图" |
| 🟢 P4 | docs/knowledge/texture-lru.md:25、docs/adr/adr-189-ktx2-texture-compression.md:429 | — | 文档写"9 用例"，实际测试文件 12 用例（ADR 修订期新增 in-flight/世代/reject 测试后未回写计数）；知识卡「释放：scene.ts disposeRenderer」实际定义在 `renderer.ts:146`（scene.ts:133/325/830 为调用/再导出，语义不误但定位略粗） | 文档计数改为 12 并注明"随测试演进"，dispose 释放点指到 `renderer.ts:146-163` |
| 🟢 P4 | frontend/src/__tests__/scene/texture-lru.test.ts | — | 容量 0 / 容量 1 边界不可测（常量未导出、无注入点）；命中路径返回缓存数据时无 signal 语义测试（与 P4-3 同源） | 随 P3 常量导出一并补 capacity=1 的单条目淘汰用例；命中+abort 语义测试可选 |

---

## 测试质量评价

**总体：质量高（12/12 通过，实测 1.59s），与生产代码修复点强对应。**

- **Mock 合理**：`vi.hoisted()` 桥接 + 整模块 mock（`../../core/wails-bindings`），工厂只引用 hoisted 绑定，符合 frontend/AGENTS.md §2.3 铁律；`// @vitest-environment node` 避免 DOM 依赖；`beforeEach` 调 `_resetTextureLRUForTest` + `mockReset`，模块级单例状态隔离干净（测试文件内 12 用例顺序无关）。
- **断言有效性强**：测试 2 用 `toBe(buf)` 验证命中返回同一底层 ArrayBuffer（引用相等，非内容拷贝）；测试 3 构造 `('a','x:y')` vs `('a:x','y')` 验证 `\x00` 键防碰撞；测试 10 验证并发同 key 单次 IO + 单条目；测试 12 用延迟 promise 精确控制 clear 与 release 时序验证世代守卫——均直击行为而非实现细节。
- **边界覆盖**：未命中/null（测试 1）、首次缓存（2）、键碰撞（3）、满容量淘汰（4）、LRU 重排（5）、abort 前置（6）、abort 后置（7）、clear（8）、modelDir 隔离（9）、并发去重（10）、reject 清理（11）、clear 期间 in-flight（12）——12 个方向覆盖了任务清单中除"容量 0"外的全部边界。
- **无跳过测试**：grep `.skip/.todo/.only` 零命中。
- **弱项**：测试 4 断言弱（见 P3-1）；生产常量未导出导致测试字面量复制与容量 0/1 不可测（见 P3-2）；测试数 12 与文档 9 漂移（见 P4-5）。
- **备注**：`npm run check`（tsc 全量）未运行——按任务约定若耗时过长可跳过，本报告基于测试实测 + 源码全读 + 调用链 grep 完成，结论不受影响。

---

**审核日期：** 2026-08-15

**审核员：** 子代理 round32-texture-lru
