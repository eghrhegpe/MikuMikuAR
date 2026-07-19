# ADR-143: 可统一代码收敛（P1 之外剩余项）

- **状态**: 已完成
- **日期**: 2026-07-19
- **完成日期**: 2026-07-19
- **相关**: ADR-139（ObserverRegistry）、ADR-140（DragSliderController）、ADR-142（withLoadingStatus）、ADR-096（通用 Helper 收敛）、ADR-101（通用逻辑第二波收敛）、ADR-105（AbortSignal 传递规范）

## 背景与问题

2026-07-19 一轮「难审核但可统一」代码巡查（`docs/audit/unification-triage-2026-07-19.md`）共识别 7 类重复 + 5 个过载文件。经冲突核对发现，**3 个 P1 主题已被同日立项覆盖**：

| 原 P1 主题 | 已覆盖 ADR | 本 ADR 是否重复建 |
|-------------|-------------|------------------|
| 主题 4 Observer 生命周期 | ADR-139 | 否，已覆盖 |
| 主题 1 滑块拖拽/键盘 | ADR-140 | 否，已覆盖 |
| 主题 2 `setStatus` 状态机 | ADR-142 | 否，已覆盖 |

为避免重复立项（冲突），本 ADR **只收敛 P1 之外的剩余项**：P2（主题 3、主题 5）、P3（主题 6、主题 7），并把 4 个过载文件列为后续拆分候选。

---

## 决策

按优先级分两组收敛，全部复用已有设施（`core/utils.ts` 的 `tryCatchStatus`/`swallowError`/`LoadingGuard`、`load-manager` 的串行队列），不引入新抽象层。

### 组 A — P2（中优先，统一错误/持久化上报）

#### 主题 3：持久化 `SetEnvState().catch()` 4 处重复

| 项 | 内容 |
|----|------|
| 涉及文件 | `scene/env/env-bridge.ts` 4 处结构相同（logWarn 标签各异）：:273（`stopTimeOfDay`）、:395（`_presetAnimLoop`）、:587（`setEnvState` 防抖回调）、:606（`flushEnvState`）；`menus/library-actions.ts:431-432`（`.then(() => setStatus(...)).catch(err => setStatus(...))`）、:438-442（zip 分支近似模式） |
| 统一动作 | 抽 `persistEnvState(payload)` 单一助手，内部含唯一 catch + `setStatus(t('env.persistFailed'), false)` 上报；调用点改为 `persistEnvState({...})`（无 `.catch`）。`library-actions.ts` 的 then/catch 链不在本次范围，待 ADR-142 后续处理 |
| 验收 | `env-bridge.ts` 中持久化 `.catch` 块归零为 ≤1 处（在助手内） |

#### 主题 5：`loadManager.load()` 缺失 `signal` 参数

| 项 | 内容 |
|----|------|
| 并发现状 | `AbortSignal` 已透传至多处 loader：`library-actions.ts:112`、`library-core.ts:264`、`plaza.ts:953`、`outfit/outfit.ts:107`、`props.ts:36`、`vmd-loader.ts:60/201/320/347`、`model-loader.ts:257`、`fileservice.ts:68`。但 **`loadManager.load(req)` 本身无 `signal` 参数**，是该链路剩余断点 |
| 统一动作 | 给 `loadManager.load(req)` 增加 `signal?: AbortSignal` 参数并向下透传至各 loader；调用点分批迁移，先 `library-actions.ts` 主路径，其余传 `undefined` 兼容 |
| 验收 | `loadManager.load` 签名带 `signal` 且 `library-actions.ts` 主路径传入 |

> 注：生产代码中已无静默空 `catch {}`（早期已清理），本主题不再将其列为 action item。

### 组 B — P3（低优先，UI 行与魔法数值）

#### 主题 6：自定义 `cs-row` / `toggle-row` 孤岛

| 项 | 内容 |
|----|------|
| 涉及文件 | `menus/env-preset-levels.ts:108`（手写 `cs-row` 按钮）、`menus/motion-camera-levels.ts:156`（手写 disabled `cs-row`）、`menus/settings-rendering.ts:93`（手写 `toggle-row`） |
| 统一动作 | `core/ui-rows.ts` 增加 `addActionRow(container, label, onClick, icon?)` 与 `addDisabledRow(container, label)`，替换三处内联 DOM，复用 `addSliderRow` 既有 aria/样式 |
| 验收 | 上述 3 处内联 DOM 删除，改调共享 builder |

#### 主题 7：魔法数值 / 硬编码

| 项 | 内容 |
|----|------|
| 涉及文件 | 滑块四分位 `0.15/0.05`：`core/ui-rows.ts:309-317`；`quarter/1`：`core/ui-advanced-rows.ts:628-637`；环境光 `0.5` 上限：`scene/env/env-bridge.ts:99`；默认重力 `-98`：`:127`；阈值 `0.5`：`:199`；状态事件魔法串 `'scene:save'`：`menus/scene-menu.ts:282,455` |
| 统一动作 | 新建 `core/ui-constants.ts`（滑块步进分数常量 `SLIDER_QUARTER_STEP` 等）；新增状态事件枚举对象 `SCENE_EVENTS.SAVE` 等替代字面量 |
| 验收 | `grep -rn "'scene:save'" src` 归零；四分位步进常量集中定义 |

---

## 过载文件（关联候选，本 ADR 不展开拆分）

以下 4 个文件 >1300 行、职责混杂，属「难审核」但修复方式是**拆分**而非「统一」，列为后续独立 ADR 候选：

| 文件 | 行数 | 混杂职责 | 建议拆分方向 |
|------|------|----------|--------------|
| `menus/env-feature-levels.ts` | 1632 | 全部 env 子系统 Schema + 53 `setEnvState` + 闭包读 `envState` | 按子系统拆 `env-*-levels.ts`（已部分进行） |
| `scene/camera/camera.ts` | 1475 | 相机装配 + 5 render observer + 多行为 | observer 部分借 ADR-139 group；行为拆独立模块 |
| `scene/scene-serialize.ts` | 1415 | 全量序列化/反序列化 | 按资源类型拆 dump/load 段 |
| `menus/plaza.ts` | 1365 | 广场浏览器搜索/分页/下载/缩略图 | 拆 browser / download / thumbnail 三模块 |

> 注：`menus/motion-popup.ts`（1255 行）略低于 1300 阈值，如后续职责继续膨胀可纳入；`core/i18n/locales/*.ts`（1500+ 行）为翻译数据表，不计入。

---

## 影响面

- **新增**: `core/ui-rows.ts`（`addActionRow`/`addDisabledRow`）、`core/ui-constants.ts`（常量 + `SCENE_EVENTS` 枚举）
- **修改**: `scene/env/env-bridge.ts`（主题 3 助手）、`core/load-manager.ts`（`loadManager.load` 加 `signal`）、`menus/*`（主题 6 孤岛行）、`core/ui-rows.ts`（主题 7 常量）
- **行为**: 无用户可见行为变化（仅内部收敛 + 错误上报规范化）
- **测试**: 助手与常量加单测；`npm run test` 全绿

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| `loadManager.load` 加 `signal` 改变签名，调用点需同步 | 🟠 中 | 分批迁移，先 `library-actions.ts` 主路径，其余传 `undefined` 兼容 |
| `SCENE_EVENTS` 枚举与现有字面量不一致 | 🟢 低 | 枚举值取原字面量，grep 校验归零 |

## 分阶段实施

- **阶段 1（本 ADR）**: 立项 + 冲突核对（确认 P1 已由 139/140/142 覆盖）
- **阶段 2**: 主题 3 `persistEnvState` 助手 + 迁移 `env-bridge.ts` 4 处
- **阶段 3**: 主题 5 `loadManager.load` 加 `signal` + `library-actions.ts` 主路径透传
- **阶段 4**: 主题 6 `addActionRow`/`addDisabledRow` + 主题 7 `ui-constants.ts`/`SCENE_EVENTS`
- **阶段 5**: 全量回归（`npm run test`）

## 修订记录

### 2026-07-19 残差清零（`docs/audit/adr-143-residual-workorders.md`）

主体 4 个主题早前已落地。本次按"信任但验证"标准对 3 个**经核实仍残留的小项**做最终收敛：

| 工单 | 位置 | 整改 | 状态 |
|------|------|------|------|
| ① persistUIState | `env-bridge.ts:646`（`flushUIState` 内裸 `SetUIState(...).catch`） | 抽 `persistUIState(payload: Partial<UIState>)` 助手，与 `persistEnvState` 对称 | ✅ 已完成 |
| ② audio signal | `load-manager.ts:205`（audio 分支漏传）+ `audio.ts:248`（签名无 signal） | load-manager 调用点 `loadAudioFile(req.path, signal)`；audio.ts 形参加 `signal?: AbortSignal` + 入口 `if (signal?.aborted) return;` | ✅ 已完成 |
| ③ SLIDER_QUARTER_* 接线 | `ui-constants.ts` 已定义无消费者 | 用户裁定：前瞻指引，不做存量改造；`env-state-schema` 的 0.15/0.05 语义不同不改 | ⏸ Deferred（未来 slider 用常量替字面量） |

**验证**：
- `npm run check`（tsc --noEmit）0 错误
- `npm run test -- --run src/__tests__/audio.test.ts src/__tests__/env-bridge.test.ts`：120/120 通过
- `npm run test -- --run src/__tests__/library-thumbnail-streaming.test.ts src/__tests__/library-core.test.ts src/__tests__/thumbnail-key.contract.test.ts`：127/127 通过
- grep 校验：
  - `SetUIState(payload` 唯一命中在 `persistUIState` 助手内
  - `SetEnvState(payload` 唯一命中在 `persistEnvState` 助手内
  - `loadAudioFile(req.path, signal)` 命中 1 处
  - `loadAudioFile(filePath: string, signal` 命中 1 处

> 主题 6（`addActionRow`/`addDisabledRow`）+ 主题 7 的 `SCENE_EVENTS` 枚举消费早前已在 `scene-menu.ts` 落地，本 ADR 验收全部通过。

## 验收标准

- `env-bridge.ts` 持久化 `.catch` 块 ≤1 处（在助手内）
- `loadManager.load` 签名带 `signal` 且 `library-actions.ts` 主路径传入
- `grep -rn "'scene:save'" src` 归零
- 主题 6/7 三处孤岛行与四分位硬编码消除
- `npm run test` 全绿
