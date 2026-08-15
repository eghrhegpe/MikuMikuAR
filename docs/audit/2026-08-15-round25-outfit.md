# 第 25 轮审核 — outfit 换装模块（测试文件 + 生产源码）

**审核范围：**
- 测试文件：`frontend/src/__tests__/outfit.test.ts`（704 行，32 用例；params/reset-load/variant 3 文件合并）
- 被测源码：`frontend/src/scene/manager/outfit.ts`（826 行，loadOutfits / applyOutfitVariant / resetOutfit + _applySlot 等内部函数）
- 关联依赖（只读核对）：`frontend/src/scene/manager/outfit-overlay.ts`、`frontend/src/core/async.ts`（LoadingGuard）、`frontend/src/__tests__/outfit-helpers.ts`、`outfit-mocks.ts`、`mocks/babylon-factories.ts`、`core/types.ts`（ModelInstance 类型）
- 验证：`cd frontend && npm run test -- src/__tests__/outfit.test.ts` → **32/32 通过**（245ms）；`npm run check`（tsc --noEmit + i18n）→ **通过**

**总体结论：⚠️ 有条件通过**

生产源码质量高（并发守卫、资源回收、幂等处理均有专项修复痕迹），测试合并干净且断言多数真实有效；但存在 1 处 P2 并发竞态（reset 与 in-flight apply 状态复活）、1 处 P3 状态流缺口（loadOutfits 失败清空已应用状态）及若干测试断言偏弱/覆盖缺口，建议修复后转正。

---

## 与既往审核的关系（专项核对）

| 既往报告 | 问题 | 现状 |
|----------|------|------|
| `docs/audit/2026-07-16-outfit-audit-mesh-leak.md`（第⑤轮，🔴 P1） | `loadOverlay` 中 `meshes` 声明在 try 内，catch 无法访问，重定向失败时 FBX mesh 残留 scene | **已修复且保留**：`outfit-overlay.ts:230` `let meshes: Mesh[] = []` 提至 try 外，`:280-290` catch 逐 mesh dispose 兜底。无遗留 ✅ |
| `docs/audit/2026-07-31-ai-outfit-physics-relay-audit.md`（🟠 P2） | `_applySlot` trySwap 兜底 observer 无超时，贴图永不加载时 observer+blob URL 永不释放 | **已修复**：`outfit.ts:389-405` 兜底 observer 另加 5000ms 超时清理（done 守卫 + dispose + revokeObjectURL）。无遗留 ✅ |
| 同上（🟢 P4） | 陈旧 overlay 用 `console.info` 而非日志子系统 | **已修复**：`outfit.ts:656` 改用 `logInfo('outfit', ...)` ✅ |

> 注：07-31 审核针对旧路径 `outfit/outfit.ts`，模块已迁至 `scene/manager/outfit.ts`（ADR-104/ADR-238 解耦），行号已按现路径重新核对。

---

## 亮点

| 模式 | 位置 | 说明 |
|------|------|------|
| last-wins 并发队列 | `outfit.ts:574-594` | `_applyingVariantGuard` + `_pendingVariant`：快速切换变体不丢用户点击、不并发竞态，队列清空才释放锁 |
| token 代次守卫 | `outfit.ts:287-289,349-353,370-373` | `_textureLoadToken` 与 overlay 共用同代 token，慢加载的旧变体纹理完成后检测过期即 dispose 丢弃，不覆盖新变体槽位 |
| blob URL / 资源三分支回收 | `outfit.ts:311-405` | 加载成功/失败(onError)/过期三分支均 `revokeObjectURL`；observer 句柄全部 dispose；双 5000ms 超时兜底（首段 + trySwap 段） |
| 幂等 tint 应用 | `outfit.ts:519-537` | 绝对 `set` 而非 `multiplyInPlace`，同一变体重复 apply 不产生几何级数漂移；并正确合并 `diffuseMul` 亮度因子 |
| HEAD 探测并发上限 | `outfit.ts:200-218` | 信号量=6 限制数百 `FileExists` 并发；每个 await 点前查 `effectiveSignal.aborted` |
| orig 快照一次性捕获 | `outfit.ts:539-562,615-632` | `_origTextures`/`_origParams` 仅在首次 apply 捕获，reset 全量还原并 dispose 变体纹理（含「原本无纹理、变体添加」槽位） |
| 空安全与 null 材质容错 | `outfit.ts:84-86,618-621,773-775` | `sm` 为 null 的 mesh 全部 `continue` 跳过，reset/apply 均不崩溃 |
| 真实资源回收断言（测试） | `outfit.test.ts:318-342` | 变体添加纹理→reset 后断言槽位回 null **且** 变体纹理 `dispose` 被调用——mesh-leak 主题的直接验证 |
| 精确数值断言（测试） | `outfit.test.ts:193-206,628-682` | params+tint 组合断言 `diffuseColor = 1×0.8×0.9 = 0.72` 等真实数值；tint-only / params-only / diffuseMul-only 分路径验证未设置参数保持原值 |

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 高 P2 | `frontend/src/scene/manager/outfit.ts` | 765-817（resetOutfit）↔ 574-594,759-760（applyOutfitVariant） | **reset 与 in-flight apply 竞态**：resetOutfit 不检查 `_applyingVariantGuard`、不清 `_pendingVariant`。apply 在 `await Promise.all(promises)` 后**无条件** `inst.activeVariant = variantName`（760 行）。用户点变体后立刻 reset：reset 先清空状态，晚完成的 apply 回填 activeVariant → **reset 后状态复活**；若队列中还有 pending 变体，reset 后仍会被执行。纹理侧有 token 保护（808 行置 undefined → isStale 丢弃），但状态侧无任何守卫 | ① resetOutfit 入口检测 `_applyingVariantGuard.isLoading(id)` 时先清 `_pendingVariant` 并等待当前 apply 结束再执行；② 或在 `_applyOutfitVariantCore` 末尾（759-760）加 `inst._textureLoadToken !== token` 校验，过期则跳过 activeVariant/toast/autoSave。两者取一即可 |
| 🟡 中 P3 | `frontend/src/scene/manager/outfit.ts` | 266-269 + 167,173,260 | **loadOutfits 失败路径吞错并清空已应用状态**：外层 `catch {}` 将发现阶段一切异常（含编程错误）静默归为「无换装」并 `inst.outfitFile = undefined`。而 `outfit-ui.ts:33-38` 在菜单渲染时会重入 loadOutfits——若变体已应用后重新加载失败，outfitFile 被清但 activeVariant/纹理仍生效 → UI 与模型状态不一致 | catch 区分可预期错误与真异常（后者 `logWarn`/`reportResourceWarning` 留痕）；失败路径不要清空已应用的 `inst.outfitFile`（或同时复位 activeVariant 与纹理） |
| 🟡 中 P3 | `frontend/src/__tests__/outfit.test.ts` | 559-563, 580-584, 565-571 | **弱断言 / 测试名与内容不符**：「byMaterial override over byCategory」实际未构造 byMaterial+byCategory 冲突场景（`byCategory` 键 `'服装'` ≠ mock 分类 `'皮肤'`，且只断言 activeVariant）；「all slot fallback」「默认恢复」同样只断言 activeVariant，未验证纹理/参数效果 | 补强：构造同名材质同时命中 byMaterial 与 byCategory 的变体，断言最终槽位取 byMaterial 值；「默认」用例断言 diffuseTexture 恢复为 origDiffuse |
| 🟡 中 P3 | `frontend/src/__tests__/outfit.test.ts` + `mocks/babylon-classes.ts` | 615-631（MockTexture.isReady 恒 true） | **关键路径不可达**：`MockTexture.isReady()` 恒 true → `outfit.ts:330-346,386-405` 两条 onLoadObservable/超时兜底分支在测试中永不执行（真实 Observable 也不被 mock）；token 过期丢弃路径（isStale）、last-wins 队列（_pendingVariant）、reset/apply 并发、loadOutfits 去重、overlay meshFile 路径（outfit-overlay 整体 mock）均无测试 | 为 MockTexture 增加可配置 isReady/onLoad 触发（如 `vi.spyOn` 或工厂参数），补一条「慢加载纹理 + 中途切换 → 旧纹理被 dispose」的 token 竞态测试；补 reset 与 apply 并发测试（对应 P2 修复） |
| 🟢 低 P4 | `frontend/src/scene/manager/outfit.ts` | 89-95, 692-746, 781-785 | 五个纹理槽位列表（diffuse/toon/spa/normal/emissive）在 `_collectSlotMappings` / apply / reset 三处重复书写，且槽位名映射（diffuse→diffuseTexture 等）分散 | 抽 `const OUTFIT_SLOTS: {slot: OutfitTextureSlot; key: TextureSlotKey}[]` 单一常量，三处循环复用 |
| 🟢 低 P4 | `frontend/src/scene/manager/outfit.ts` | 258, 821 | `results.filter(Boolean) as OutfitVariant[]` 可用类型谓词 `(r): r is OutfitVariant`；`:821` `as unknown as Promise<void>` 桥接双 cast（ADR-238 注册签名差异） | 前者改谓词过滤；后者加一行注释说明签名桥接原因 |
| 🟢 低 P4 | `frontend/src/scene/manager/outfit.ts` | 203-218, 342-345, 395-405 | `delay(10)` 自旋、两处 `5000` 超时均为裸魔法值 | 提为具名常量（如 `TEXTURE_LOAD_TIMEOUT_MS = 5000`、`HEAD_SEMAPHORE_DELAY_MS = 10`） |
| 🟢 低 P4 | `frontend/src/__tests__/outfit.test.ts` | 119-125, 242-248, 494-507；192-703 各处 | `origDiffuse` fixture 在 3 个 describe 重复 3 份；`const { applyOutfitVariant } = await import(...)` 重复约 30 次（vi.mock 已 hoist，静态导入即可） | fixture 可提文件级常量（若无需 describe 隔离）；动态 import 提至 describe 顶部一次 |
| 🟢 低 P4 | `frontend/src/__tests__/outfit.test.ts` | 17, 118, 698 等 | 测试代码使用 `as any`（URL 修补、`inst: any`、`variants: null as any`）——测试豁免可接受，但 `inst: any` 使断言失去类型护栏 | 可为 inst 定义最小 `Pick<ModelInstance, ...>` 类型，降低误写字段风险 |

---

## 测试质量评价

### 合并质量 —— 干净 ✅
git 核对：`b0e575ed`（test: outfit 3 文件合并）删除 `outfit.params.test.ts`(192 行) / `outfit.reset-load.test.ts`(164 行) / `outfit.variant.test.ts`(182 行)，生成 387 行合并文件；原 3 文件用例数 3+5+8=**16**，合并提交内恰好 16 用例，逐条保留无丢失、无重复。此后 `59f58a7d` / `0c6a08da` 两轮「测试反推源码审核」扩至当前 32 例（新增 reset 纹理槽清理、变体守卫等），与源码修复配套。文件头注释（3 文件同构、24 条 Babylon/BMD mock）经逐一核对准确；describe 按原主题分区保留并加分隔横幅，行为不变声明成立。

### mock 合理性 —— 良好，有 1 处盲区 ✅/⚠️
- 24 条 Babylon/babylon-mmd mock 工厂全部来自 `mocks/babylon-factories.ts` 单一规范源（ADR-206），`outfit-mocks.ts` 仅做别名映射，形状与场景/模型预设 mock 保持超集一致，符合 frontend/AGENTS.md 测试卫生铁律。
- 9 条应用级 mock（scene/i18n/t/toast/texture-lru/logger/resource-warning-sink/outfit-overlay/material/wails-bindings）形状最小化、返回契约匹配源码消费方式（如 `readTextureWithLRU` 返回 ArrayBuffer、`loadOverlay` 返回 `{meshes, retargetOk}`）。
- 盲区：`MockTexture.isReady()` 恒 true 使纹理加载异步分支（observer/超时/token 过期）不可达，见 P3。

### 断言有效性 —— 中上 ⚠️
- **强**：params+tint 组合数值断言（0.72=1×0.8×0.9）、tint-only/params-only/diffuseMul-only 分路径「未设置参数保持原值」、_origTextures 快照同一性（`toBe(firstCapture)`）、reset 后纹理恢复 `toBe(origDiffuse)`、变体纹理 dispose spy——均真实验证效果而非仅验状态字段。
- **弱**：3 处变体解析优先级用例只断言 `activeVariant`（P3 已列）。

### 边界覆盖 —— 良好 ✅
无模型 / 无 filePath / 不在 registry / 空 variants / `variants: null` / 未知变体 / 未知 id / AbortSignal 预中止 / 无效 JSON 回退自动发现 / 自动发现无匹配 / 有效 JSON 不触发子目录发现 / 材质 null / 原无纹理槽的变体添加与 reset 清理——覆盖充分。**无 skip/todo/only**（grep 确认 0 处）。

### 未覆盖（对应 P3）
last-wins 队列、token 过期丢弃、reset/apply 并发、loadOutfits 并发去重、纹理加载超时、overlay meshFile 实际加载路径。

---

**审核日期：** 2026-08-15
**审核员：** 子代理 round25-outfit
