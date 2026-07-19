# 可统一代码巡查 — 2026-07-19

**日期**: 2026-07-19
**范围**: `frontend/src/` 全部非测试 `.ts`（271 文件，约 9.7 万行，含 i18n 数据表）
**方法**: 按 `AGENTS.md` 审核标准，以「重复散落 ≥2 文件」+「单文件过载 >500 行」为判据做专项巡查（只读，未改文件）
**目的**: 列出「难审核、但可统一收敛」的代码候选，为后续 ADR 立项与重构提供清单

---

## 执行摘要

结论：**存在 7 类可统一重复 + 5 个过载文件**，但项目已具备收敛基础设施，本次属**增量收敛**而非从零建抽象。

已确认的良好基线（复用对象，勿重复造）：

| 设施 | 位置 | 作用 |
|------|------|------|
| `load-manager.ts` | `core/` | 跨资源**串行队列**（消除底层各自加锁） |
| `env-bridge.ts` | `scene/env/` | 环境状态**唯一入口** `setEnvState()`（真实赋值仅此一处） |
| `ui-rows.ts` / `ui-advanced-rows.ts` | `core/` | 共享 `addSliderRow`/`addToggleRow`/`addModeRow`… |
| `utils.ts` | `core/` | `LoadingGuard` / `DebouncedTimer` / `Abortable` / `swallowError` / `fireAndForget` / `tryCatchStatus` |

**最高杠杆点**：主题 4（Observer 生命周期）与主题 1（滑块交互）——二者分别把「render-loop 泄漏」和「用户输入一致性」收口到单一可审模块，且已有 `ui-rows`/`utils` 形态可复用，迁移成本最低。

---

## 冲突核对（2026-07-19 更新）

经 `docs/adr/` 全量核对，本巡查发现 **3 个 P1 主题已于同日被立项覆盖**，再建即冲突；另发现 **ADR 编号碰撞**两处。

### P1 已被覆盖（勿重复立项）

| 本巡查 P1 主题 | 已覆盖 ADR | 状态 |
|------------------|-------------|------|
| 主题 4 Observer 生命周期 | `adr-139-observer-registry.md` | 立项 |
| 主题 1 滑块拖拽/键盘 | `adr-140-drag-slider-controller.md` | 立项 |
| 主题 2 `setStatus` 状态机 | `adr-142-with-status.md` | 立项 |

→ 剩余可统一项（P2 主题 3/5、P3 主题 6/7、过载文件）已收口为 **`adr-143-unification-remaining.md`**（状态：立项）。

### ADR 编号碰撞（已修复 2026-07-19）

| 原编号 | 保留主题（不动） | 改名主题 | 新号 | 冲击 |
|------|------------|------------|------|------|
| `adr-124` | `filesystem-architecture`（被 `model-loader.ts:291` `[doc:adr-124]` 引用，指纹理 referenceFiles 直传） | `motion-presets` → | **`adr-145-motion-presets`** | 零源码：文件重命名 + H1 改号 |
| `adr-136` | `thumbnail-abortsignal`（被 `library-core.ts`/`library-browse.ts`/`library-actions.ts`/`model-loader.ts` + 测试引用） | `per-model-overlay-motion` → | **`adr-144-per-model-overlay-motion`** | 零源码：文件重命名 + H1 改号 |

> 修复策略：两个碰撞号各**保留被源码引用的主题**、只 `git mv` 改名**零外部引用的主题**到空闲号（144/145）。两个改名文件内部均无 `[adr-124]`/`[adr-136]` 自引用，全程未触碰任何 `.ts`。源码/测试中的 `[adr-124]`/`[adr-136]` 均仍指向保留主题，无需变更。

---

## 可统一主题清单（按优先级）

### 🔴 P1 — 主题 1：滑块「游标拖拽 + 键盘 + mousedown 拖拽」逻辑三处重写

| 项 | 内容 |
|----|------|
| 涉及文件 | `core/ui-rows.ts:213-342`（`addSliderRow`）；`core/ui-advanced-rows.ts:78-167`（`addColorSliderRow`）；`core/ui-advanced-rows.ts:266-432`（`addVector3SliderRow`）；`core/ui-advanced-rows.ts:551-657`（`addModeSlider`） |
| 重复证据 | 同一套「`setIndexFromClientX`/`setValueFromClientX` + 方向键 `handleKeyDown` + `mousedown→mousemove→mouseup` 拖拽（didDrag/dragRect/moveDisp/endDisp）」被复制 3~4 次 |
| 为何难审核 | **语义已漂移**：① `addSliderRow` 用 `step*shiftMult`/`step*10` 步进；② `addColorSliderRow` 键盘 `delta=0.01/0.1` **完全忽略 step**；③ `addModeSlider` 四分位步进（`quarter/1`）复制了 `addSliderRow` 的 `0.15/0.05`。键盘与拖拽都直接改写 `current[]`，无统一输入控制器，竞态/一致性无法一处审 |
| 统一建议 | 抽取 `DragSliderController(opts)`（参数化 min/max/step/snap/axis/onChange/onDragEnd），三个 builder 退化为此控制器的特例配置 |

### 🔴 P1 — 主题 2：`setStatus→await→setStatus` 加载状态机样板

| 项 | 内容 |
|----|------|
| 涉及文件 | `menus/library-actions.ts:230-606`（31 处 `setStatus`，3 套近乎相同的 解压→加载模型→加载VMD 块：230-322、414-433、580-606）；`scene/manager/model-loader.ts:280-677`；`menus/scene-menu.ts`（16 处）；`menus/settings-paths.ts`；`menus/plaza.ts` |
| 重复证据 | 同一「设 loading 态 → try/await → 成功设 done / 失败 `t(key)+formatError(err)`」模式在 library-actions 内重复 ≥3 次，成功/失败 key 散落为 i18n 字符串拼接 |
| 为何难审核 | 状态字符串无集中枚举；rapid 重入守卫**不一致**（library-actions 部分用 `LoadingGuard.tryEnter`，其余路径无）；错误上报文案与 `tryCatchStatus` 约定不统一，竞态维度难追 |
| 统一建议 | `core/status-bar.ts` 或 `utils.ts` 增加 `withStatus(loadingKey, successKey, fn)` 包装；菜单层统一经 `loadManager.load(req)` 而非各自 `setStatus`+`loadXxx` |

### 🔴 P1 — 主题 4：Observer 注册/移除分散，句柄藏在 `mesh.metadata`

| 项 | 内容 |
|----|------|
| 涉及文件 | 注册 `onBeforeRenderObservable.add` 约 34 处：`scene/camera/camera.ts`(5)、`scene/env/env-sky.ts`(2)、`scene/env/env-clouds.ts`(2)、`scene/env/env-particles.ts`(2)、`scene/render/lighting.ts`(3)、`scene/env/planar-reflection.ts`(4)、`core/render-loop.ts`(4)、`scene/motion/playback.ts`(2)、`scene/motion/perception.ts`(1)、`scene/env/env-water.ts`(1)、`scene/env/env-impl.ts`(1)、`scene/env/env-bridge.ts`(1)、`scene/motion/wasm-layers-blender.ts`(1)、`scene/motion/bone-override.ts`(1)、`scene/motion/feet-adjustment.ts`(1)、`scene/manager/model-manager.ts`(1)、`physics/physics-bridge.ts`(1)、`scene/ar/ar-scene.ts`(1)。移除仅约 23 处 |
| 句柄存储位置不统一 | `env-clouds.ts:731-736` 存 `_volCloudMesh.metadata.obs`/`.followObs`（并置 null）；`env-sky.ts:322` 存 `_envSys.sky.skyMesh.metadata.skyFollowObs`；其余存模块级变量 |
| 为何难审核 | **无中央 `ObserverRegistry`/`DisposableGroup`**；observer 句柄塞进 `mesh.metadata`（`any`）→ 丢失类型且 dispose 路径若漏调 `.remove()` 即泄漏渲染回调（尤其菜单/场景热重载）。移除句柄位置五花八门，grep 难以保证 add/remove 成对 |
| 统一建议 | 引入 `ObserverRegistry`/`DisposableGroup`（`add` 返回 `Disposable`，`group.dispose()` 统一移除）；`useObserver(scene, obs)` 封装；**禁止把 observer 句柄塞进 `metadata`** |

### 🟠 P2 — 主题 3：持久化 `SetEnvState(...).catch(...)` 错误上报 5 连重复

| 项 | 内容 |
|----|------|
| 涉及文件 | `scene/env/env-bridge.ts:421`、`543`、`705`、`721`、`764`（5 处完全相同 `SetEnvState({...}).catch(err => { logWarn(...); setStatus(t_i18n('env.persistFailed'), false); })`）；`menus/library-actions.ts:422-423`、`433`（`.then(setStatus(done)).catch(setStatus(failed))` 链） |
| 为何难审核 | 同一错误分支在 5 个位置各写一遍，若 `env.persistFailed` key 改名或需加埋点，需改 5 处，易漏 |
| 统一建议 | `persistEnvState()` / `persistUIState()` 单一助手（内部含唯一 catch + 上报）；或 `persistAndReport(label, payload)` |

### 🟠 P2 — 主题 5：错误处理助手已存在但采用不均

| 项 | 内容 |
|----|------|
| 涉及文件 | 空 `catch {}` 静默吞错约 70+ 处，集中在 `outfit/outfit.ts`(5)、`outfit/outfit-overlay.ts`(4)、`scene/motion/vmd-loader.ts`(5)、`scene/manager/model-loader.ts`(7)、`scene/env/env-texture.ts`(3)、`scene/env/props.ts`(3)、`scene/render/renderer.ts`(3)、`scene/motion/vmd-layers.ts`(4) 等，均绕过 `tryCatchStatus`/`swallowError` |
| 并发取消缺失 | `Abortable`/`AbortSignal` 全库**仅 `model-loader.ts:256-269`（ADR-096，`AbortSignal.any`）** 一处真正采用；`library-actions.ts`/`plaza.ts`/`vmd-loader.ts` 的异步操作基本不接收 `signal` → 标准 #4 基本未落地 |
| 为何难审核 | 真实错误被空 catch 吞掉（env/vmd 等底层尤其危险）；组件卸载无法取消进行中的异步，竞态维度无保障 |
| 统一建议 | ① codemod：菜单/底层异步统一走 `tryCatchStatus`（保留 `translateGoError` 上报）；② 给 `loadManager.load(req)` 加 `signal` 并向下透传；③ 空 catch 必须加 `// reason` 注释或 `swallowError` |

### 🟡 P3 — 主题 6：自定义 `cs-row` / `toggle-row` 孤岛

| 项 | 内容 |
|----|------|
| 涉及文件 | `menus/env-preset-levels.ts:108`（手写 `cs-row` 按钮）、`menus/motion-camera-levels.ts:156`（手写 disabled `cs-row`）、`menus/settings-rendering.ts:93`（手写 `toggle-row`） |
| 为何难审核 | 复制了 `addSliderRow`/`addToggleRow`/`addDangerRow` 已提供的 DOM 结构，样式/可达性（aria）与共享实现可能漂移 |
| 统一建议 | `ui-rows.ts` 增加 `addActionRow(container,label,onClick,icon)` 与 `addDisabledRow(container,label)`，替换三处内联 DOM |

### 🟡 P3 — 主题 7：魔法数值 / 硬编码

| 项 | 内容 |
|----|------|
| 涉及文件 | 滑块四分位 `0.15/0.05`：`core/ui-rows.ts:309-317`；`quarter/1`：`core/ui-advanced-rows.ts:630-638`；环境环境光 `0.5` 上限 + `0.15` 因子：`scene/env/env-bridge.ts:247`；默认重力 `-98`：`:275`；阈值 `0.5`：`:347`；状态事件魔法串 `'scene:save'`：`menus/scene-menu.ts:126,468`（非常量） |
| 统一建议 | `core/ui-constants.ts`（滑块步进分数常量）+ 状态事件枚举对象（`SCENE_EVENTS.SAVE` 等），消除字面量 |

---

## 过载文件 Top 5（>1300 行、职责混杂）

| # | 文件 | 行数 | 主要混杂职责 | 审计难点 |
|---|------|------|--------------|----------|
| 1 | `menus/env-feature-levels.ts` | 1596 | 天空/地面/雾/水/云/反射/碰撞/预设等全部 env 子系统 Schema 声明 + 大量 `visibleWhen` 闭包直接读 `envState`（53 `setEnvState` 调用） | 单文件声明所有 env UI；状态读取闭包与副作用交织；任何 env 字段改动需通读千行 |
| 2 | `scene/camera/camera.ts` | 1478 | 相机系统装配 + 5 个 `onBeforeRenderObservable` 注册 + 多种行为（orbit/beatcut/…） | 装配 + 渲染回调 + 交互状态混杂，observer 生命周期难追踪 |
| 3 | `scene/scene-serialize.ts` | 1371 | 场景序列化/反序列化（PMX/VMD/灯光/环境/物理全量 dump） | 40 处 try/catch + I/O + 类型转换样板密集，错误处理与数据流交叉 |
| 4 | `menus/plaza.ts` | 1364 | 模型广场浏览器（搜索/分页/下载/缩略图渲染） | 28 处 try/catch + 26 处 `setStatus`，加载状态机与 UI 渲染同文件 |
| 5 | `menus/motion-popup.ts` | 1300 | 动作菜单总入口 + 播放控制 + 刷新 | 26 处 try/catch + 5 处 `setStatus`，菜单生命周期与播放状态耦合 |

> 次席参考：`env-water.ts` 1289、`lighting.ts` 1221、`env-ground.ts` 1189、`renderer.ts` 1120、`model-detail.ts` 1104。
> 注：`core/i18n/locales/*.ts`（1500+ 行）虽大，但属翻译**数据表**而非逻辑，不计入过载项。

---

## 推荐攻击顺序

| 顺序 | 主题 | 理由 |
|------|------|------|
| 1 | **主题 4 Observer 生命周期** | 最高杠杆：消除整个 render-loop 泄漏面，只需「加封装、改调用点」，不碰逻辑 |
| 2 | **主题 1 滑块交互** | 直接消除用户输入一致性隐患，复用现有 `ui-rows` 形态，迁移成本最低 |
| 3 | **主题 2 + 3** | 复用 `loadManager`+`tryCatchStatus`，属「用齐已有设施」 |

---

## 后续 ADR 立项建议

每个 P1 主题建议单独立项（按规范取 `docs/adr/` 最大编号 +1，当前已达 ADR-106）：

| 拟立项 | 对应主题 | 范围 |
|--------|----------|------|
| ADR-107（待定） | 主题 1 | `DragSliderController` 统一滑块输入 |
| ADR-108（待定） | 主题 4 | `ObserverRegistry`/`DisposableGroup` 生命周期收敛 |
| ADR-109（待定） | 主题 2 | `withStatus` + 菜单统一走 `loadManager` |

> 待 Jieling 拍板编号与范围后再开 ADR 正文。本报告为巡查清单，不直接修改代码。

---

## 审核标准参考

- 审核执行标准见 `AGENTS.md` → `# 审核代码可用性`
- 已有收敛基线：ADR-101（通用逻辑第二波收敛，1476 测试通过）、ADR-096（`AbortSignal` 透传）、ADR-103（SettingsStore 移除，统一 uiState 持久化）
- 术语规范：`docs/terminology.md`
