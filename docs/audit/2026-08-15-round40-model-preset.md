# [model-preset] — 审核结果（round-40 测试 2）

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/model-preset.test.ts`（918 行，@ts-nocheck，C 组合并 5 文件，33 用例） |
| 测试辅助 | `frontend/src/__tests__/model-preset-helpers.ts`、`model-preset-mocks.ts`、`mocks/babylon-classes.ts`、`mocks/babylon-factories.ts` |
| 被测生产源码 | `frontend/src/menus/model-preset.ts:46-383`（serializeModelPreset 80-125 / applyModelPreset 127-206 / tryAutoApplyPreset 216-291 / applyPresetFromLib 293-335） |
| | `frontend/src/scene/manager/material.ts:951-1049`（getMatState / applyMatState）+ 材质应用链 65-929 |
| | `frontend/src/scene/manager/material-sss.ts:31-230`（SSS 状态读写） |
| | `frontend/src/scene/manager/model-ops.ts:239-253`（stopVMD） |
| 验证 | `npm run test -- src/__tests__/model-preset.test.ts` → 33/33 通过，执行 19ms（import 3.84s） |

**总体结论：⚠️ 有条件通过** — 测试合并质量高、断言有效、33 用例全绿；生产源码状态流/资源释放/异常处理整体良好。4 项 P3：3 项为生产边界防御缺口（非法预设 TypeError、NaN matIndex 幽灵条目、VMD 加载失败无回滚），1 项为测试覆盖缺口（serialize→apply 全闭环、VMD 加载分支未覆盖）。无 P1/P2。

## 亮点

- **跨模型材质保护**：`model-preset.ts:186-203` — overrides/enabled 按 matIndex 索引不通用，跨模型应用时置为 undefined 仅保留 categories 名称匹配兜底 + logWarn 记录；测试 `model-preset.test.ts:312-360` 专门验证跳过行为，`state!.overrides[0]` 断言为 undefined。
- **重入守卫 + 撤销快照清理**：`model-preset.ts:216-231`（`_autoApplying` Set 防快速连点重入）+ `272-279`（try/finally 保证 applyModelPreset 失败时删除脏快照，撤销栈不残留）— 并发安全与状态流清晰。
- **XSS 防御**：`model-preset.ts:281` toast 文案经 `escapeHtml` 后才插入。
- **序列化默认值过滤**：`material.ts:967-993` — `_ensureState` 种入的 6 类默认值不落盘（避免预设膨胀）；per-mat 为 Partial 仅落盘「值 ≠ DEFAULT」显式字段，全默认 entry 跳过，与「无调整」语义一致。
- **PBR 映射数值断言有效**：`model-preset.test.ts:378-425` 断言 albedoColor.r = 1×2 = 2、reflectionColor.r = 1×0.5 = 0.5、roughness = (200-100)/200 = 0.5 及 shininess 0↔200 极值，与 `material.ts:487-528` `_applyPbrMatParams` 实现逐行核对一致（scale 乘率、clamp01 反比公式）。
- **合并消除重复**：`model-preset.test.ts:798-918` `describe.each(['standard','pbr'])` 将 round-5 遗留的 Standard/PBR 同构场景矩阵（categories/overrides/empty/string-keyed × 4）合并为单一来源，注释完整说明历史（786-790）。
- **spy 参数断言优于字段断言**：`model-preset.test.ts:203-205` 注释明确"断言 mock 自身无意义"，改断言 scene API 真实调用参数，双重验证。

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `menus/model-preset.ts` | 190 | `preset.model.filePath` 直接访问：version=1 但缺 `model` 字段的非法预设（且含材质字段时）抛裸 TypeError，无 formatError 兜底；缺 model 且无材质字段则静默成功 | 应用入口统一防御：`if (!preset.model)` 抛 `t('model-preset.formatError')`；测试补一条缺 model 字段的非法预设用例 |
| 🟡 P3 | `scene/manager/material.ts` | 831 / 1037 | `setMatParams` 守卫 `matIndex < 0 \|\| matIndex >= meshes.length` 对 NaN 均不拦截：`applyMatState` 的 `parseInt(idxStr, 10)` 遇到非法字符串键（如 JSON 手改 "abc"）产生 NaN 幽灵 entry（Map NaN key 合法），getMatState 序列化后变 "null" 键 | 守卫加 `Number.isNaN(matIndex)` 拦截；测试补一条 string-keyed 非法键用例（现 894-916 行仅覆盖合法数字字符串键） |
| 🟡 P3 | `menus/model-preset.ts` | 162-179 | `preset.vmd.path` 非空时先 `stopVMD(id)` 再 load，load 失败仅 feedbackStatus + logWarn，旧 VMD 已被清除且无回滚（undo 仅存在于 tryAutoApplyPreset 路径，手动应用无撤销） | load 失败时尝试恢复旧 VMD 或提供撤销入口；至少注释说明"部分失败语义" |
| 🟡 P3 | `__tests__/model-preset.test.ts` | 全文件 | 覆盖缺口：① 无 serialize→apply→serialize 全闭环用例（材质 roundtrip 走 getMatState 层，JSON 产物未回灌 applyModelPreset）；② `preset.vmd.path` 非空加载分支无测试（loadManager 未 mock，刻意避开） | 补 1 条「serializeModelPreset 产物 → applyModelPreset → 再 serialize 等价」闭环；补 loadManager mock 后覆盖 VMD 加载分支 |
| 🟢 P4 | `__tests__/model-preset-helpers.ts` | 123-126 | 注释声称 MockPBRMaterial "含 PBRSubSurfaceConfiguration 插件 stub"，但 `mocks/babylon-classes.ts:692-745` 的 MockPBRMaterial 无 `subSurface` 属性 → 4 条 `no PBRSubSurfaceConfiguration plugin found` stderr 噪音；SSS 测试实际只验证状态层（_sssState Map），材质应用层未生效 | 给 MockPBRMaterial 补 subSurface stub（或改注释为"状态层 roundtrip，材质应用层跳过"），消除噪音与文档漂移 |
| 🟢 P4 | 测试环境 | — | `applyModelPreset` 成功路径 `t('model-preset.applied')` 报 `key not found in zh-CN base bundle`（生产键存在于 zh-CN.ts:1123，属测试环境 i18n bundle 未加载） | 测试 setup 中加载 zh-CN locale 或 mock t()，消除 warn 噪音 |
| 🟢 P4 | `menus/model-preset.ts` | 138-148 | transform 部分字段静默忽略：positionX/Y/Z 须三者全定义才应用，只含其一则丢弃（serializeModelPreset 自产全量，仅手工构造 JSON 受影响） | 注释说明"位置三轴须同时提供"或逐轴应用 |
| 🟢 P4 | `menus/model-preset.ts` | 213 / 265 | 魔法值 8000（undo toast 时长）重复出现 | 提取 `const UNDO_TOAST_MS = 8000` 常量 |
| 🟢 P4 | `scene/manager/model-ops.ts` | 244-251 | `inst.mmdModel && mmdRuntime` 与 `isPlaying && mmdRuntime` 双条件：mmdRuntime 为 null 时 runtime animation 未清、isPlaying 不复位（状态残留）；测试 761-779 仅验证不崩溃，未断言 isPlaying 复位 | 注释说明 mmdRuntime null 时保持 isPlaying 的设计理由，或补断言 |
| 🟢 P4 | `scene/manager/material.ts` | 967 | `JSON.stringify(DEFAULT_MAT_PARAMS)` 每次调用重复序列化 | 提升为模块级常量 |

## 测试质量评价

**合并质量（优）**：5 文件合并干净 — ① vi.mock 取并集去重为一份（42 条，pbr 独占的 `pbrMaterial` 保留，`model-preset.test.ts:105`）；② toast/playback 统一 `mockToast()`/`mockPlayback()` 工厂，注释声明与原内联形状等价（6-8 行）；③ 三份重复的 15-DOM-id 创建块幂等合并为单份 `vi.hoisted`（68-93 行）+ 顶层 `beforeAll(setupDomRefs)` + `beforeEach(modelPresetBeforeEach)`（181-186 行）；④ **import 顺序约束显式注释**（11、58-59 行）：PBRMaterial import 必须位于 `./model-preset-mocks` 之后，否则 hoist 工厂 TDZ ReferenceError；⑤ 用例守恒：grep 统计 36 处 describe/it（含 3 个 describe 行）与运行结果 33 用例一致，**无 skip/todo**。

**断言有效性（优）**：transform/visibility 用 spy 参数 + 实例字段双重验证；PBR albedo/reflection/roughness 数值断言与实现公式核对一致；roundtrip 用例（applyMatState → getMatState → 再 apply → 再 getMatState）验证跨模型状态迁移；`describe.each(['standard','pbr'])` 双材质矩阵消除同构重复。

**@ts-nocheck 合理性**：合理 — 全仓 16 个测试文件同款惯例（vi.mock 运行时替换无法静态类型化 mock 形状），非本文件特例；helpers 层已用精确类型 + 局部 `as any`，仅测试文件整体关闭检查。

**边界覆盖**：非法 version 拒绝（生产 135-137 行）无测试、缺 model 字段无测试、非法 override 键无测试、VMD 加载分支无测试 —— 见风险表 P3 项。

**运行验证**：`npm run test -- src/__tests__/model-preset.test.ts` 33/33 通过（19ms，import 3.84s），合并削减依赖图加载的目标达成；`npm run check` 未跑（只读审核不涉及编译变更，任务允许跳过）。

## 与前轮关系（round-14 / round-25）

- **round-14**（model-preset UI 剩余）：`buildPresetListLevel` / `savePresetToLibDialog` / `applyPresetFromLib` / `tryAutoApplyPreset` 库管理链路（依赖 wails bindings `GetModelPresets` 等）仍无测试覆盖；本测试聚焦核心 4 函数（applyModelPreset / serializeModelPreset / getMatState-applyMatState / stopVMD），库管理 UI 链路遗留不变。
- **round-25**（buildModelSchema 消费）：`menus/model-detail.ts:40,601` 消费 `savePresetToLibDialog` / `buildPresetListLevel`（模型详情菜单 → 预设库入口）；该消费点（菜单 Schema 渲染）不在本测试覆盖范围，`model-detail.ts:294-637` 的 Schema 构建未纳入本轮。

---

审核日期：2026-08-15
审核员：子代理 round40-model-preset
