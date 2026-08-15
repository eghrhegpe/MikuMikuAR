# round-35 审核 — playback.ui.test.ts + updatePlaybackUI

> 本轮第 2 个测试之一（round35-playback-ui），锁文件制：只读生产代码，仅写本报告。

## 一、审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/playback.ui.test.ts`（171 行，9 用例，`@vitest-environment node`） |
| 被测源码 | `frontend/src/scene/motion/playback.ts:182-206`（`updatePlaybackUI`，233 行文件全读） |
| 测试 mock 的生产模块 | `@/core/config`（barrel：mmdRuntime / isPlaying / setIsPlaying / autoLoop / seekDragging / dom / formatTime）、`@/core/audio`（syncAudioPlayback / isAudioPlaying）、`../scene/camera/camera`（animateCameraVmd）、`./perception-shared`（feetDebug，真实导入） |
| 共享 fixture | `frontend/src/__tests__/playback-helpers.ts`（`mockRuntime` / `mockManager` / `makeObsMock`） |
| 执行验证 | `npm run test -- src/__tests__/playback.ui.test.ts` → **9/9 通过（40ms）** |

**与历史审核的关系（按任务要求注明）：**
- 本测试是 **ADR-204 拆分产物**：原 `playback.test.ts`（515 行）垂直拆为 `playback.seek.test.ts`（seekFromEvent）/ `playback.ui.test.ts`（updatePlaybackUI）/ `playback.observables.test.ts`（initPlaybackObservables），原文件已删（ADR-204 文档 & round-31 报告确认）。
- playback.ts 生产主体由 **round-6**（`docs/audit/round-6-playback-procedural-perception.md`，✅ 通过，当时 205 行）与 **round-15**（✅ 优）审核；`updatePlaybackUI` 的未就绪告警经 **ADR-248**（feetDebug 门控 + 60 帧节流）改造，本轮是其 UI 更新拆分的独立审核。
- 同族 **round-31**（`2026-08-15-round31-playback-seek.md`）审 `seekFromEvent`，与本轮共享同一生产文件、同一 mock 超集形状与 helpers fixture；round-31 已记录的时长来源不一致观察点（seek 用 `animationDuration` vs UI 用 `_getDuration`）在本轮复核依然成立（见风险表 P3-2）。

## 二、总体结论

**✅ 通过**（0 处 P1/P2；2 项 P3 为低概率/既有设计；4 项 P4 观察点，不阻断）

## 三、亮点

- **热路径守卫设计正确**：`updatePlaybackUI` 被 `onAnimationTickObservable` 每帧调用（`playback.ts:73`），函数以双守卫开头——`!dom.playbackBar` 直接 return（L183-185）、`!mmdRuntime || !dom.seekBar` 降级 warn + 跳过（L189-196），注释明示「throw 会炸掉整帧渲染」的设计意图。
- **ADR-248 落地且被测试合同验证**：热路径告警 `feetDebug.value && _uiWarnFrame++ % 60 === 0` 门控 + 帧节流（`playback.ts:192`）；本测试验证「默认关闭不刷告警」（L99-115）+「开启后精确告警一次（含完整消息文本）」（L161-170），60 帧节流本身由 observables 测试覆盖（`playback.observables.test.ts:375-388`）——两文件互补，无重复。
- **测试 mock 卫生合规**：`vi.hoisted` 共享状态 + mock 工厂仅引用 hoisted 绑定（`playback.ui.test.ts:6-61`），符合 frontend/AGENTS.md §2.3 铁律；`@/core/config` mock 为超集形状（含本文件未用的 `seekDragging`/`syncAudioPlayback`/`animateCameraVmd`，服务 playback.ts 的静态导入完整性）。
- **fixtures 复用（ADR-204 方向）**：`mockRuntime` 从 `./playback-helpers` 导入（L74），`beforeEach` 覆写 `currentTime: 30 / animationDuration: 120`（L80），不重复造 runtime 桩。
- **降级路径断言有效**：mmdRuntime null / seekBar null 两用例不仅断言「不崩溃」，还断言「DOM 不被修改」（`playbackBar.style.display` 保持 ''，L106/L114）与「默认不刷告警」——对「每帧调用、静默降级」的合同是真实验证。
- **进度数学断言精确**：`60/120 → '50%'`（L151）与 `200/120 → '100%'`（L158，触发 `Math.min(pct, 100)` 上限钳制）均为精确字符串断言，非空断言。
- **用例间防污染**：`origSeekBar` 捕获 + `beforeEach`/`afterEach` 双恢复（L77/L90/L95，注释说明防前置用例断言失败泄漏 null）、`vi.restoreAllMocks()`（L96）、`feetDebug.value` 双复位（L89/L94）——与 seek 测试同款卫生。
- **生产代码零新增类型逃生**：updatePlaybackUI 无 `as any`/`@ts-ignore`；全文件唯一断言 `e as MouseEvent | PointerEvent`（L233）是 scene-action-bridge `unknown` 载荷的必要收窄，非 `any`。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | — | — | 无 | — |
| 🟡 P3 | playback.ts | 197-204 | DOM 守卫只检查 `playbackBar`/`seekBar`（L183/L189），但随后解引用 `btnPlayPause`/`btnLoopToggle`/`timeDisplay`/`seekProgress` 四个元素（L198-204）；若部分 DOM 缺失，L188 注释警告的「throw 炸掉整帧」场景依然可能发生（元素同源静态 HTML，概率低，但守卫哲学不一致） | 对全部访问元素做统一空检（如提取 `if (!dom.playbackBar || !dom.seekBar || !dom.btnPlayPause || …) return;`）或加注释说明其余元素与 playbackBar 同生命周期 |
| 🟡 P3 | playback.ts | 200 vs 212 | 时长来源不一致（round-31 已记录，复核成立）：UI 用 `_getDuration`（聚焦模型时长优先，L200），`seekFromEvent` 用 `mmdRuntime.animationDuration`（L212）；多模型/模型时长≠runtime 时长时进度显示与 seek 比例错位 | 统一时长来源，或注释说明单模型场景下两者相等（属既有设计，接受即可） |
| 🟢 P4 | playback.ts | 203-204 | 进度只做上限钳制（`Math.min(pct, 100)`），无下限钳制：`currentTime` 为负（或 NaN）时产出 `-N%`/`NaN%` 无效 CSS；runtime 不变量下 currentTime ≥ 0，概率低 | 用 `clamp01` 或 `Math.max(0, …)` 兜底，与 seekFromEvent 的 clamp01 风格一致 |
| 🟢 P4 | playback.ts | 192/199/204 | 魔法数值：`'0.35'` 透明度、`100` 百分比、`60` 帧节流未定义为命名常量（60 有注释 + ADR-248 背书，0.35/100 无） | `const LOOP_OFF_OPACITY = '0.35'`、`const PCT_MAX = 100` 命名化 |
| 🟢 P4 | playback.ui.test.ts | 56-60 + 144 | `formatTime` mock 重实现与生产 `core/format.ts`（`MM:SS.CC` 补零，如 `01:05.00`）不一致：断言 `1:05 / 2:00`（L144）并非生产实际输出字符串，只验证了 `${formatTime(cur)} / ${formatTime(dur)}` 插值模板；mock 重实现使「生产格式变更→测试不红」与「mock 格式变更→测试误红」双向失真（真实 formatTime 边界已由 `config.test.ts:26-68` 全覆盖，无覆盖空洞，仅忠实度问题） | mock 改为固定返回值（如 `formatTime: vi.fn((s) => \`T\${s}\`)`），或对齐真实 `MM:SS.CC` 形状 |
| 🟢 P4 | playback.ui.test.ts | — | 未覆盖分支：`!dom.playbackBar` 首个守卫（playback.ts:183-185）、`duration <= 0` 时 seekProgress 不写（playback.ts:202-205）、`_manager` 非空时 `_getDuration` 聚焦模型时长路径（playback.ts:200；后者经 observables 测试间接覆盖） | 补 1 个 `playbackBar = null` 降级用例 + 1 个 `duration = 0` 进度不动用例即可闭环 |
| 🟢 P4 | playback.ui.test.ts | 7/36 | 测试 mock 使用 `as any` 收窄（`mockState.mmdRuntime as any`、`mockDom as any`）——测试代码可接受，但可借 `DomRefs` 类型（core/dom.ts:64）收紧 | 可选优化，不强制 |

## 五、测试质量评价

- **有效性**：9 用例全绿（40ms）。断言以精确字符串/精确 warn 消息为主（`'flex'`/`'▶'`/`'⏸'`/`'1'`/`'0.35'`/`'50%'`/`'100%'`），降级路径额外断言「DOM 不动 + 不刷告警」；唯一弱点是 formatTime mock 形状与生产不一致（P4，模板验证有效但字符串失真）。
- **mock 合理性**：`vi.hoisted` + 超集形状 + helpers fixture 复用，完全符合 frontend/AGENTS.md §2.3 与 ADR-204；mock 覆盖了 updatePlaybackUI 访问的全部 DOM 属性（含 seekBar 的 getBoundingClientRect 超集项，本文件未用，为家族共享形状服务）。`feetDebug` 为真实导入（非 mock），测的是真实门控合同——加分项。
- **边界覆盖**：守卫分支（mmdRuntime null / seekBar null）、状态切换（isPlaying 双向、autoLoop 双向）、进度数学（50% 精确、100% 钳制）全覆盖；缺口为 playbackBar null、duration≤0、_manager 聚焦时长三处（P4，均已记录，后两处概率低/他处间接覆盖）。
- **无跳过**：无 `it.skip/only/todo`（全文件通读核实）。
- **运行验证**：本文件 9/9 绿；`npm run check` 未单独跑（耗时考虑，见任务许可）——但本文件为纯 mock 隔离测试且 9/9 通过，类型层面 playback.ts 与 `npm run test` 全量基线均绿（round-31 同族文件基线确认）。如需可在主模型汇总轮补跑。

---

审核日期：2026-08-15
审核员：子代理 round35-playback-ui
