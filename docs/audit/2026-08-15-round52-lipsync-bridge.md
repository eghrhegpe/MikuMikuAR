# round-52-3 lipsync-bridge 桥接层审核报告

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/lipsync-bridge.test.ts`（319 行，7 describe / 27 用例，`@vitest-environment node`） |
| 被测源码 | `frontend/src/scene/motion/lipsync-bridge.ts`（80 行，全量） |
| 间接依赖 | `motion-algos/lipsync.ts`（真实导入，纯算法层）、`scene/motion/perception-shared.ts`（仅 type import，编译期擦除）、`scene/motion/perception.ts`（mock，6 导出）、`core/scene-action-bridge.ts`（真实导入，纯叶子零依赖） |
| 验证方式 | `cd frontend && npm run test -- src/__tests__/lipsync-bridge.test.ts` → **27/27 通过（8ms）**；`npm run check` 未执行——本轮零代码改动、类型基线不受影响，按任务允许跳过 |

**总体结论：✅ 通过**（P1×0 / P2×0 / P3×1 / P4×3）

## 历史关系与覆盖闭环

- **round-6**：审旧路径 `scene/motion/lipsync.ts` + `scene/audio/lipsync-bridge.ts`（105 行）。
- **round-12**：审 lipsync-bridge ✅，指出「口型参数 [-1,1] 不变量」注释与实际 `clamp01 → [0,1]` 不一致。
- **round-15**：审 lipsync-bridge ✅ 优（转发层类型安全、状态流清晰）。
- **round-25**：审 `motion-algos/lipsync.ts` 算法层 ✅（42 用例），P4 指出 `lipsync-bridge.test.ts:197` 的 get 方向默认值断言只锁「桥与算法一致」不锁具体数值。
- **round-41**：审 `perception-lipsync.ts` 集成层，P3 指 multiMorph 集成路径无测试（归属感知层，非本文件）。
- **本轮（round-52）**：桥接层专项测试（2026-08-10 `da3d41d4` node 环境分流提交新增）。**算法层（round-25）→ 桥接层（本轮）→ 感知层（round-41）三层链路现已闭环**。
- **跨轮核实**：round-12 的 [-1,1] 不变量问题已被「桥纯透传 + perception 内 clamp01」的设计消除（桥无任何钳制，注释准确）；round-25 对 get 方向默认值锁定的担忧经核实被 **set 方向精确值断言（test L273-281 锁定字面量 0.2/0.8）** 缓解——改默认值 set 方向测试会红。

## 亮点

- **Mock 形状与生产 import 精确 6/6 对齐**：`vi.mock('../scene/motion/perception')` 工厂（test:50-57）提供的 6 个导出与 `lipsync-bridge.ts:7-14` 的 6 个真实 import 一一对应，无超集 spread 依赖；`vi.hoisted` 共享状态符合 frontend/AGENTS.md §2.3（工厂只引用 hoisted 绑定，无 TDZ 风险）。
- **Mock 镜像真实语义 + 副本断言双保险**：`getPerceptionState.mockImplementation(() => ({ ...defaultPerception }))`（test:67-68）镜像生产每次返回新对象（perception.ts:424-426），配合「返回副本/每次新对象」断言（test:200-213）锁定桥接层不暴露内部引用——防引用别名回归。
- **「不钳制」透传契约与感知层钳制互补成链**：test:107-115/135-143 断言越界值（-0.5/1.5/-1/2）原样透传，`perception-morph.int.test.ts:151-161` 断言感知层 `clamp01` 生效——两层分工明确、注释（「钳制由 perception 负责」）与生产源码一致（perception.ts:530-531, 536-537）。
- **Partial 更新语义被精确锁定**：test:244-258 用 `Object.keys(arg).sort()` 断言 `setLipSyncState` 只写 4 个 lip-sync 字段——防止未来误写成全量覆盖（会把其它 perception 字段清回默认）。
- **no-op 契约测试防「死而复生」**：test:288-318 锁定 `initLipSync`/`updateLipSync`/`resetLipSyncOnFocusChange` 不抛异常且不触碰 perception——若有人重新加逻辑或误接感知层，测试立即红。
- **类型护栏**：mock 的 `defaultPerception` 是完整 `PerceptionState` 结构，类型来自生产 `perception-shared`（test:4 type import），感知层接口新增必填字段会编译失败——mock 与生产接口强同步。
- **卫生达标**：测试与生产均 0 处 `as any`/`@ts-ignore`（test 仅 2 处 `as Record<string, unknown>` / `null as never`，均为有意的类型收窄）；0 个跳过测试；`@vitest-environment node` 选择正确（纯转发无 DOM 依赖）。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `frontend/src/scene/motion/lipsync-bridge.ts` + `frontend/src/__tests__/lipsync-bridge.test.ts` | L77-80 / 全文件 | 模块级 `registerSceneAction` 副作用（注册 `setLipSyncEnabled` / `getLipSyncState` 两个 scene action）在本测试（唯一真实加载 bridge 的测试）中**零断言**；`action-defs.test.ts` 对 scene-action-bridge 打桩，无法验证真实注册。删除/改名注册行测试仍全绿，只有运行时 action-defs 调用链断裂才会暴露（静默漂移） | 仿 `main.boot-anchor.test.ts`「桥接模块不 mock、作断言对象」模式：import `sut` 后断言 `getSceneAction('setLipSyncEnabled')` / `getSceneAction('getLipSyncState')` 返回函数（scene-action-bridge 为纯叶子零依赖，node 环境安全） |
| 🟢 P4 | `frontend/src/__tests__/lipsync-bridge.test.ts` | L38 | mock `defaultPerception.eyeGazeSmooth = 0.35`，生产 `DEFAULT_PERCEPTION_STATE` 为 0.65（perception-shared.ts:68）；注释称「感知层可调参数默认值」实际非生产默认。桥不读该字段，无功能影响，但 mock 数据真实性漂移 | 改为 0.65，或注释注明「任意合法值，断言不依赖」 |
| 🟢 P4 | `frontend/src/scene/motion/lipsync-bridge.ts` | L17-19 / L65-67 / L73-75 | `initLipSync` / `resetLipSyncOnFocusChange` / `updateLipSync` 全仓无生产消费者（仅 scene.ts:893 桶再导出 + 本测试），为兼容保留的空壳；有注释说明意图，但易误导读者以为有逻辑 | 注释标注「待消费者迁移后删除」；主模型可评估删除（需含桶导出路径的消费者扫描） |
| 🟢 P4 | `frontend/src/scene/motion/lipsync-bridge.ts` | L6 | `import { LipSyncState as LipSyncStateType }` 未写 `import type`；符号仅用于类型位置（TS 会擦除），但语义不纯，未来开启 `verbatimModuleSyntax` 会报错 | 改为 `import type`（测试文件 L3 已是 `import type`） |

## 测试质量评价

- **断言有效性（强）**：转发用例统一用 `toHaveBeenCalledOnce` + `toHaveBeenCalledWith(精确参数)`，杜绝「调了但参数错」的假绿；get 方向用差异化数值（0.9/0.1）验证字段映射，防 swap 错位；set 方向用 key-set 断言锁定字段白名单。全部断言可对照生产源码手工推导，非自证式 mock。
- **Mock 合理性（优）**：仅 mock 真正被依赖的 perception 6 导出；`motion-algos/lipsync` 真实导入（纯算法、无副作用）；`perception-shared` 仅 type import（擦除）；`scene-action-bridge` 真实加载（纯叶子，副作用安全）。`beforeEach` 全量 `mockReset` + 重设 `getPerceptionState` 实现，顺序正确。
- **边界覆盖（以契约定界）**：越界透传（负值/超上限）双方向覆盖；默认值一致性 + set 方向精确值双锁；副本/新对象/Partial 更新/隔离性（不调用其它函数）各维度齐备。**NaN/Infinity 未覆盖**——但桥是透传壳，NaN 处理属感知层职责（round-25 已在算法层登记 P4），桥层测 NaN 无意义，不算缺口。
- **次要 nit**：各 describe 的「不调用其它 perception 函数」断言只抽查 3-5 个中的部分 mock（如 test:88-93 未查 `setLipSyncIntensity`/`setLipSyncMultiMorphEnabled`），但跨 describe 组合已覆盖隔离矩阵，无实际漏网。
- **运行验证**：27/27 通过（8ms），无跳过、无 flaky 信号。

## 结论

桥接层测试质量高：mock 与生产 import 精确对齐、断言锁定转发/转换/Partial 更新/副本四类真实行为、与算法层（round-25）和感知层（round-41）测试互补成闭环。生产壳类型安全、无资源/异常/循环依赖风险。唯一 P3 为模块级 scene-action 注册副作用零断言（静默漂移风险），建议按 main.boot-anchor 模式补 1 例断言；P4×3 均为低危风格/死代码项，不阻塞。

---

审核日期：2026-08-15
审核员：子代理 round52-lipsync-bridge
