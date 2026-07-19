# ADR-143: 可统一代码收敛（P1 之外剩余项）

- **状态**: 立项
- **日期**: 2026-07-19
- **相关**: ADR-139（ObserverRegistry）、ADR-140（DragSliderController）、ADR-142（withLoadingStatus）、ADR-096（通用 Helper 收敛）、ADR-101（通用逻辑第二波收敛）、ADR-105（AbortSignal 传递规范）

## 背景与问题

2026-07-19 一轮「难审核但可统一」代码巡查（`docs/audit/unification-triage-2026-07-19.md`）共识别 7 类重复 + 5 个过载文件。经冲突核对发现，**3 个 P1 主题已被同日立项覆盖**：

| 原 P1 主题 | 已覆盖 ADR | 本 ADR 是否重复建 |
|-------------|-------------|------------------|
| 主题 4 Observer 生命周期 | ADR-139 | 否，已覆盖 |
| 主题 1 滑块拖拽/键盘 | ADR-140 | 否，已覆盖 |
| 主题 2 `setStatus` 状态机 | ADR-142 | 否，已覆盖 |

为避免重复立项（冲突），本 ADR **只收敛 P1 之外的剩余项**：P2（主题 3、主题 5）、P3（主题 6、主题 7），并把 5 个过载文件列为后续拆分候选。

---

## 决策

按优先级分两组收敛，全部复用已有设施（`core/utils.ts` 的 `tryCatchStatus`/`swallowError`/`LoadingGuard`、`load-manager` 的串行队列），不引入新抽象层。

### 组 A — P2（中优先，统一错误/持久化上报）

#### 主题 3：持久化 `SetEnvState().catch()` 5 连重复

| 项 | 内容 |
|----|------|
| 涉及文件 | `scene/env/env-bridge.ts:421`、`543`、`705`、`721`、`764`（5 处完全相同 `SetEnvState({...}).catch(err => { logWarn(...); setStatus(t_i18n('env.persistFailed'), false); })`）；`menus/library-actions.ts:422-423`、`433`（`.then(setStatus(done)).catch(setStatus(failed))` 链） |
| 统一动作 | 抽 `persistEnvState(payload)` / `persistUIState(payload)` 单一助手，内部含唯一 catch + `setStatus(t('env.persistFailed'), false)` 上报；调用点改为 `persistEnvState({...})`（无 `.catch`） |
| 验收 | `env-bridge.ts` 中 `.catch` 持久化块归零为 ≤1 处（在助手内） |

#### 主题 5：错误处理采用不均 + 并发取消缺失

| 项 | 内容 |
|----|------|
| 涉及文件 | 空 `catch {}` 静默吞错约 70+ 处：`outfit/outfit.ts`(5)、`outfit/outfit-overlay.ts`(4)、`scene/motion/vmd-loader.ts`(5)、`scene/manager/model-loader.ts`(7)、`scene/env/env-texture.ts`(3)、`scene/env/props.ts`(3)、`scene/render/renderer.ts`(3)、`scene/motion/vmd-layers.ts`(4) 等 |
| 并发现状 | `Abortable`/`AbortSignal` 全库仅 `scene/manager/model-loader.ts:256-269`（ADR-096）一处真正透传；`library-actions.ts`/`plaza.ts`/`vmd-loader.ts` 异步基本不接收 `signal` |
| 统一动作 | ① codemod：菜单/底层异步统一走 `tryCatchStatus`（保留 `translateGoError` 上报）；② 给 `loadManager.load(req)` 增加 `signal` 参数并向下透传至各 loader；③ 空 `catch` 必须改为 `swallowError(err, context)` 或加 `// reason` 注释 |
| 验收 | 静默空 `catch {}` 归零；`loadManager.load` 签名带 `signal` 且 `library-actions.ts` 主路径传入 |

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
| 涉及文件 | 滑块四分位 `0.15/0.05`：`core/ui-rows.ts:309-317`；`quarter/1`：`core/ui-advanced-rows.ts:630-638`；环境光 `0.5` 上限 + `0.15` 因子：`scene/env/env-bridge.ts:247`；默认重力 `-98`：`:275`；阈值 `0.5`：`:347`；状态事件魔法串 `'scene:save'`：`menus/scene-menu.ts:126,468` |
| 统一动作 | 新建 `core/ui-constants.ts`（滑块步进分数常量 `SLIDER_QUARTER_STEP` 等）；新增状态事件枚举对象 `SCENE_EVENTS.SAVE` 等替代字面量 |
| 验收 | `grep -rn "'scene:save'" src` 归零；四分位步进常量集中定义 |

---

## 过载文件（关联候选，本 ADR 不展开拆分）

以下 5 个文件 >1300 行、职责混杂，属「难审核」但修复方式是**拆分**而非「统一」，列为后续独立 ADR 候选：

| 文件 | 行数 | 混杂职责 | 建议拆分方向 |
|------|------|----------|--------------|
| `menus/env-feature-levels.ts` | 1596 | 全部 env 子系统 Schema + 53 `setEnvState` + 闭包读 `envState` | 按子系统拆 `env-*-levels.ts`（已部分进行） |
| `scene/camera/camera.ts` | 1478 | 相机装配 + 5 render observer + 多行为 | observer 部分借 ADR-139 group；行为拆独立模块 |
| `scene/scene-serialize.ts` | 1371 | 全量序列化/反序列化 | 按资源类型拆 dump/load 段 |
| `menus/plaza.ts` | 1364 | 广场浏览器搜索/分页/下载/缩略图 | 拆 browser / download / thumbnail 三模块 |
| `menus/motion-popup.ts` | 1300 | 动作菜单 + 播放控制 + 刷新 | 拆 menu / playback-control / refresh |

> 注：`core/i18n/locales/*.ts`（1500+ 行）为翻译数据表，不计入。

---

## 影响面

- **新增**: `core/ui-rows.ts`（`addActionRow`/`addDisabledRow`）、`core/ui-constants.ts`（常量 + `SCENE_EVENTS` 枚举）
- **修改**: `scene/env/env-bridge.ts`（主题 3 助手）、`core/utils.ts`（`loadManager.load` 加 `signal`）、`menus/*`（主题 2 之外的残留 setStatus / 孤岛行）、约 70 处空 `catch` 改 `swallowError`
- **行为**: 无用户可见行为变化（仅内部收敛 + 错误上报规范化）
- **测试**: 助手与常量加单测；`npm run test` 全绿

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| `loadManager.load` 加 `signal` 改变签名，调用点需同步 | 🟠 中 | 分批迁移，先 `library-actions.ts` 主路径，其余传 `undefined` 兼容 |
| 静默 `catch` 改为上报后噪音增加 | 🟢 低 | `swallowError` 走 `logWarn` 分级，非 `console.error` |
| `SCENE_EVENTS` 枚举与现有字面量不一致 | 🟢 低 | 枚举值取原字面量，grep 校验归零 |

## 分阶段实施

- **阶段 1（本 ADR）**: 立项 + 冲突核对（确认 P1 已由 139/140/142 覆盖）
- **阶段 2**: 主题 3 `persistEnvState`/`persistUIState` 助手 + 迁移 `env-bridge.ts` 5 处
- **阶段 3**: 主题 5 `loadManager.load` 加 `signal` + `library-actions.ts` 主路径透传 + 空 `catch` codemod 试点
- **阶段 4**: 主题 6 `addActionRow`/`addDisabledRow` + 主题 7 `ui-constants.ts`/`SCENE_EVENTS`
- **阶段 5**: 全量回归（`npm run test`）

## 验收标准

- `env-bridge.ts` 持久化 `.catch` 块 ≤1 处（在助手内）
- 静默空 `catch {}` 归零
- `grep -rn "'scene:save'" src` 归零
- 主题 6/7 三处孤岛行与四分位硬编码消除
- `npm run test` 全绿
