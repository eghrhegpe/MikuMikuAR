# Round 39 — model-manager 审核报告

## 审核范围

- **测试文件**：`frontend/src/__tests__/model-manager.test.ts`（1427 行，@ts-nocheck，@vitest-environment node）
  - 合并来源：git `3404d105`「model-manager 系列 7 文件合并为一」（constructor/bone-overlay/focus/physics/physics-categories/transform/vmd-morph），合并时 91 用例 / 1209 行 → 1070 行；后续 3 个 commit（`acdb355a`/`56e2fa01`/`93988090`）追加 NaN 校验、physics 契约清理顺序、stage 盲区、rotation/orbit/formation/input-validation 等，现为 **122 用例 / 20 个 describe**。
  - 共享 mock：`frontend/src/__tests__/model-manager-mocks.ts`（263 行，复用 `mocks/babylon-factories`，ADR-206）。
- **被测源码**：`frontend/src/scene/manager/model-manager.ts`（1352 行）
  - 注册表/生命周期：`register` 256-266、`remove` 302-380、`focus` 393-429、`dispose` 1141-1170
  - 属性：visibility/opacity/wireframe 479-511、physics 555-578、transform 580-766、orbit 664-747
  - 物理分类 784-841、Morph 843-876、骨骼覆盖 878-1138、阵型 440-475
  - 附属关系（[doc:adr-215]）1172-1352 —— **本文件不含其测试，归属 `model-attachment.test.ts`（round-22 已审）**
- **验证**：`cd frontend && npm run test -- src/__tests__/model-manager.test.ts` → **122/122 通过（38ms 用例时间 / 925ms 墙钟）**，无 skip/todo/only。

## 总体结论

⚠️ **有条件通过**（无 P1/P2；P3×4、P4×9，其中 2 项 P3 + 2 项 P4 为 round-22 attach 区遗留，非本次新增）

生产源码健康度良好：`remove()` 清理链完备（材质 Set 去重 + 共享 toon 摘除 + 顺序注释齐全），round-13 的 remove 隐式 focus 副作用、round-17 的重复注册/onRemoveModel 异常隔离、round-22 的 childIsDescendant 误判均已修复；0 处 `as any`/`@ts-ignore`，唯一类型逃生口为 round-22 已记录的 linkedBone 双重 cast（1244）。

测试文件质量高：7 文件合并干净（用例守恒可核）、断言真实验证（真实 material.ts `_applyAll` 链 + 字节级 physics 状态 + autoFrame 数学）、边界矩阵完整。**主要条件**：① 骨骼覆盖 updateFn 的每帧顶点更新/override 着色分支零覆盖（mock 返回 `null` 顶点数据 + 无测试触发 onBeforeRender 回调）；② `focus()` 同步异常未被 swallowError 兜住；③ `dispose()` 不清理 material/vmd-layers 模块级 per-model 状态；④ round-22 attach 遗留（P3×2）择机处理。

---

## 亮点

- **`remove()` 清理链设计严谨且顺序有注释**：`model-manager.ts:302-380` — onRemoveModel 包 try/catch 隔离（外部回调抛错不中断清理链，round-17 修复），材质用 Set 去重后 `detachSharedTextures` 再 dispose（防 toon 全局单例被误毁，337-344），`destroyBoneOverlay` 在 registry delete 之后调用并有注释说明为何不得提前 delete（357-359），删除焦点模型才 `focus(nextId)` 重取景（round-13 修复，377-379）。
- **重复注册防御**：`model-manager.ts:256-266` — 同 ID 不同实例先 `remove` 释放旧资源再注册，防止 mesh/材质泄漏（round-17 P2 修复，有测试 `test:93-101`）。
- **物理状态恢复的边界处理与测试一一对应**：`setPhysics` 长度失配 `fill(1)`（566-571）、`setPhysicsCategory` init 越界回退 1（831-832），测试逐一覆盖（`test:505-514`、`test:671-682`），并含 serialize→reload→restore 往返模拟（`test:685-722`，ADR-193 稳定 id）。
- **测试真实验证而非 mock 自证**：visibility describe 通过 `setModelRegistry` 接真实 `material.ts:_applyAll` 链（`test:775` + `material.ts:623`），断言 alpha/transparencyMode/wireframe 落点；focus 断言 autoFrame 边界数学（center=0.75 / extent=1.5，`test:311-316`）；全文件仅 mock Babylon 8 模块，config/orbit/clamp/async/logger/material/vmd-layers 均真实执行。
- **未知 id 统一 no-op 矩阵 + NaN/Infinity 输入校验矩阵**：`test:1323-1398` 对 setScaling/setPosition/setOpacity/setRotationY/setRotation 的 NaN/Infinity 断言「值不变 + onChange 不触发」；各 describe 均有 unknown-id no-op 用例。
- **合并纪律**：`test:1-9` 头注释完整记录合并结构/改名理由/mock 收敛；唯一 describe 命名冲突（physics-categories 与 physics 同名）按语义改名并在头注释说明；共享样板收敛为 `model-manager-mocks.ts` 一份。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | frontend/src/__tests__/model-manager-mocks.ts | 48, 59 | `getVerticesData: vi.fn(() => null)` 使 updateFn（`model-manager.ts:986-1049`，全文件最复杂运行时代码：逐帧骨骼线顶点更新 + override 着色 + joint 跟随）被短路跳过；且无任何测试触发 `scene._callbacks` 里的 onBeforeRender 回调，`markDirty`/`dirty` 语义零覆盖 | mock 返回可变顶点数组，新增测试：调用 onBeforeRender 回调前先 `entry.markDirty()`，断言 `updateVerticesData` 被调用、override 线段随 `getOverrideType` 注册着色/隐藏 |
| 🟡 P3 | frontend/src/scene/manager/model-manager.ts | 402-404 | `swallowError(Promise.resolve(this.onModelFocused(id)))` —— `onModelFocused(id)` 在 Promise.resolve 之前同步求值，若回调同步抛错会逃出 `focus()` 不被吞掉 | `try { const r = this.onModelFocused(id); if (r) swallowError(Promise.resolve(r)); } catch (e) { logWarn(...) }` |
| 🟡 P3 | frontend/src/scene/manager/model-manager.ts | 1141-1170 | `dispose()` 不清理 `_initialRigidBodyStates`/`_physicsCatState`，也不调 `disposeModelMaterialState`/`disposeVmdLayerState` —— material.ts/vmd-layers.ts 模块级 per-model map 在场景重建时残留（shutdown 场景影响低，但 dispose 与 remove 语义不对称） | dispose() 遍历 registry 调用 `disposeModelMaterialState(id)` + `disposeVmdLayerState(id)`，并 clear 两个实例 map |
| 🟡 P3 | frontend/src/scene/manager/model-manager.ts | 1261-1274 | **round-22 遗留**：attach 字段写入与 `attachToBone` 非原子，mesh 操作抛错则字段已落而网格未挂（本文件不覆盖，归 model-attachment.test.ts） | round-22 建议：mesh 操作先行 + try/catch 回滚字段 |
| 🟢 P4 | frontend/src/scene/manager/model-manager.ts | 1244 | **round-22 遗留**：`rb as unknown as { linkedBone?: ... }` 双重 cast 类型逃生口（非 `as any`） | core/types.ts augment 骨骼元素类型，消除 cast |
| 🟢 P4 | frontend/src/scene/manager/model-manager.ts | 1344-1351 | **round-22 遗留**：`detachChildModels` 命名与级联**销毁**语义相反 | 注释明示销毁语义或改名 `cascadeRemoveChildren` |
| 🟢 P4 | frontend/src/scene/manager/model-manager.ts | 225, 435, 459, 932 | 魔法数值：阵型默认间距 3、v-shape 0.6/0.8、diagonal 0.7/0.5、arc 0.8/0.4、关节球直径 1.5/segments 8 未常量化 | 提取命名常量（如 `FORMATION_DEFAULT_SPACING = 3`） |
| 🟢 P4 | frontend/src/scene/manager/model-manager.ts | 817-820, 840 | `setPhysicsCategory` auto-enable 路径先 `setPhysics`（内含 triggerAutoSave）再尾部再触发一次 → 双重 autoSave（上游已防抖，无害） | 内部直调逻辑分支或注释说明防抖依赖 |
| 🟢 P4 | frontend/src/scene/manager/model-manager.ts | 1105-1138 | `ensureBoneUpdateObserver` 在零 overlay 时仍每帧遍历空 map 直至 dispose | 创建/销毁 overlay 时增删观察者（懒注册） |
| 🟢 P4 | frontend/src/__tests__/model-manager.test.ts | 126, 163-167, 245, 396-397, 520, 575, 588, 1417-1425 | 大量直接访问私有成员（`_initialRigidBodyStates`/`_boneOverlayMap`/`_physicsCatState`/`_boneUpdateObserver`）——@ts-nocheck 下合法但耦合实现细节 | 优先经公开行为断言；确需探私处加注释说明动机 |
| 🟢 P4 | frontend/src/__tests__/model-manager.test.ts | 1120, 1150, 1375 | 测试体内 `require('@babylonjs/core/...')` 与顶部 import 风格混用 | 统一为顶部 import |
| 🟢 P4 | frontend/src/__tests__/model-manager.test.ts | 93-101（触发） | `register is idempotent` 走真实 `remove()` → `getSceneAction` 未注册路径，产生一次性 `console.warn`（'disposeOverlay'/'restoreMaterials' 未注册，round-22 同类问题，source `scene-action-bridge.ts:193-196`） | mocks 中 `registerSceneAction` 注册 no-op 消除告警 |
| 🟢 P4 | frontend/src/__tests__/model-manager.test.ts | 1182-1188, 1204 | `setOrbit clamps invalid elevation and distance` 只断言 `distance > 0` 未钉 exact 钳制值（实际 0.001）；`getOrbit` 自引用同一公式断言（atan2 一致即过，不独立） | 断言 normalizeOrbit 的具体钳制常量；azimuth 用已知笛卡尔点（如 (0,0,5)→0°）独立验证 |
| 🟢 P4 | frontend/src/__tests__/model-manager.test.ts | 775, 785 | visibility describe 通过 `setModelRegistry` 接全局活绑定（afterEach 还原）——其余 describe 不设，若未来 describe 触碰 material 路径会静默早退（`material.ts:629`） | 头注释明示该全局依赖；或封装 `withModelRegistry` helper |

---

## 测试质量评价

### 合并质量（✅ 干净）
- git `3404d105` 可核：7 文件（constructor 118 / bone-overlay 178 / focus 193 / physics 162 / physics-categories 186 / transform 234 / vmd-morph 138，共删 1209 行）→ 1 文件 1070 行插入，commit message 声明 91 用例守恒；当前 122 用例为后续 3 个 commit 的净增长（NaN 校验、physics 契约清理顺序、stage 盲区、rotation/orbit/formation/input-validation/remove 等 describe），非合并丢失。
- mock 超集收敛为 `model-manager-mocks.ts` 一份（复用 `mocks/babylon-factories`，仅保留 MergeMeshes 副作用与 Vector3 原型补丁两类定制），样板不再 7 份重复。
- 唯一 describe 命名冲突（physics-categories 与 physics 同名）按语义改名并在头注释（`test:6-7`）记录。

### 断言有效性（✅ 强）
- 物理状态**字节级**断言（`Array.from(states)` 全等）；autoFrame 边界数学断言（center/extent 具体值）；visibility/opacity/wireframe 经**真实** material.ts `_applyAll` 链落点断言（`mat.alpha`/`transparencyMode`），非 mock 自证。
- 副作用断言严谨：NaN/Infinity 输入断言「值不变 + onChange 不触发」；frameCamera=false 断言「autoFrame 不触发 + onChange 触发」；remove 断言「mesh.dispose 调用 + 内部 map 清理 + focus 转移」。
- 物理分类序列化往返（`test:685-722`）以双 manager 模拟 serialize→reload→restore，覆盖 ADR-193 稳定 id 语义。

### @ts-nocheck 合理性（✅ 合理）
- Babylon 8 模块经 `vi.mock` 运行时替换，node 环境（ADR-255 分流），类型由 mock 工厂提供；`@ts-nocheck` 仅测试侧使用（test + mocks 两文件），与 ADR-206 既有模式一致，生产代码 0 处。

### 边界覆盖（🟡 大部良好，一处显著缺口）
- 已覆盖：重复注册、stale focus id、rigid body 长度失配、init 越界回退、orbit 越界钳制、formation NaN/0/负间距、无 mmdModel/空骨骼/空 morph、未知 id 全矩阵、dispose 无 setup 不崩。
- **缺口**：骨骼覆盖 updateFn 每帧更新与 override 着色分支零覆盖（见风险表 P3-1）；attach/detach/reattach/detachChildModels 四方法**不属本文件**（归 model-attachment.test.ts，round-22 已审，本文件零引用已核实）。

### 跳过测试
- 无 `.skip`/`.todo`/`.only`/`.each`（已 grep 核实）；122 用例全绿（38ms）。

---

## 与既往审核关系

- **round-13**（`2026-08-06-round13-scene-render-core-ui.md`）：remove() 隐式 reframe 副作用已修复（源码 377-379 注释 + `test:409-435` 锁定焦点转移行为）；无残留。
- **round-22**（`2026-08-15-round22-model-attachment.md`）：attach DAG 区（源码 1172-1354）由 `model-attachment.test.ts` 覆盖；P2（childIsDescendant 误判）已修（源码 1226-1228 注释）；**遗留未修**：P3×2（reattach toast/autoSave 风暴 1316-1340、attach 非原子字段 1261-1274）、P4×2（linkedBone cast 1244、detachChildModels 命名 1346），见风险表。
- **round-24**（material 系列）：本测试经真实 material.ts `_applyAll` 链联动，为 round-24 重构提供回归护栏。

---

审核日期：2026-08-15
审核员：子代理 round39-model-manager
