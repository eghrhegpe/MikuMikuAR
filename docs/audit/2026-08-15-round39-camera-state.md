# 第 39 轮审核报告 — camera-state 纯状态模块（测试驱动审核）

> **审核日期**: 2026-08-15
> **审核员**: 子代理 round39-camera-state（本轮第 3 个测试，共 3 个）

## 审核范围

- **测试文件**: `frontend/src/__tests__/camera-state.test.ts`（415 行，39 用例）
- **被测源码**: `frontend/src/scene/camera/camera-state.ts`（412 行，全文件）——默认预设 `defaultCameraPreset`（:130-146）、类型守卫 `CAMERA_MODES`/`isCameraMode`（:21-36）、全部 getter/setter 状态转换（:91-319）、`isTouchDevice`（:313-319）、`resetCameraState`（:370-388）、模块加载时注册 `setCameraMode`/`getCameraMode` action（:390-412，含非法 mode 回退 orbit、无 switchCameraMode 时降级状态写入）
- **mock 依赖**: `frontend/src/core/scene-action-bridge.ts`（捕获式 mock，注册 action 可被验证）、`frontend/src/core/logger.ts`（mock `logWarn`，签名 `(tag, message, err?)` 与生产 :99 核对一致）
- **相关生产调用方（核实用）**: `camera.ts:873-875`（注册 `switchCameraMode` action）、`camera.ts:782-807`（`disposeCameraSystem` → `resetCameraState`）

## 总体结论

✅ **通过**（🔴 P1 ×0 / 🟠 P2 ×0 / 🟡 P3 ×2 / 🟢 P4 ×4）

### 与前几轮审核的关系

| 轮次 | 结论 | 关系 |
|------|------|------|
| round-13（2026-08-06，`2026-08-06-round13-scene-render-core-ui.md`） | camera-state **P2#1**：bridge `setCameraMode` 只写 `_cameraMode` 不真正切换相机 | ✅ 已修复：`camera-state.ts:392-409` 委托 `getSceneAction('switchCameraMode')`（`camera.ts:873-875` 注册，含 `isCameraMode` 运行时校验），未注册时降级状态写入。**本测试文件的「注册的 setCameraMode action」describe（test:320-350）正是该修复的回归测试**——合法委托/非法回退/无委托降级三条路径全覆盖 |
| round-32（2026-08-15，`2026-08-15-round32-render-postprocess.md`） | camera-state FOV 层 ✅ | 分工延续：FOV 层本测试仅 1 个基础往返用例（test:168-172），clamp min/max/NaN/Infinity 深测在 `camera.test.ts:933-971`，零重叠 |
| round-37（2026-08-15，`2026-08-15-round37-camera.md`） | camera 主模块（switchCameraMode/disposeCameraSystem）✅ | 本次为 camera-state 的**独立纯状态测试**：真实实现不 mock（纯状态无实例化风险），覆盖 resetCameraState 契约（test:360-415）与 action 注册，与 round-37 的 camera 集成测试互补 |

## 亮点

- **单一默认状态源**（`camera-state.ts:92-110, 370-388`）：模块级 `let` 初始化与 `resetCameraState` 均从 `DEFAULT_CAMERA_STATE` 取值（round-13 code_review P3 修复），reset 测试逐字段断言 13 项默认值（test:379-391），双源漂移无生存空间。
- **非法 mode 运行时校验 + 安全回退**（`camera-state.ts:392-399`）：桥接输入面宽（action-defs / NL 意图 / AI tool / E2E），`isCameraMode(mode) ? mode : 'orbit'` 回退 + `logWarn` 告警；测试验证回退值与告警（test:336-343），非静默吞错。
- **无委托降级路径**（`camera-state.ts:403-408`）：`getSceneAction('switchCameraMode')` 未注册（headless 无 scene 环境）时降级为 `setCameraMode` 状态写入；测试显式 `delete` switchCameraMode 后验证（test:345-349）。
- **类型双保险**：生产代码 0 处 `as any`/`@ts-ignore`/`@ts-expect-error`；`CameraMode` 联合字面量类型 + `CAMERA_MODES` 运行时常量（:21-31）与 `isCameraMode` 守卫（:34-36）双轨校验，`setCameraMode` 纯 setter 收窄到类型内（:197-199），非法值只能在桥入口被拦截。
- **mock 卫生**：`vi.hoisted` 单例（test:10-18）只被 `vi.mock` 工厂引用，规避 hoist 期 TDZ（符合 ADR-219 铁律）；捕获式 mock 使「模块加载时注册 action」这一副作用被真实断言（test:330-357 调用的是生产注册闭包，非 mock 复制品）。
- **isTouchDevice 四分支全覆盖**（test:281-318）：ontouchstart 存在 / maxTouchPoints>0 / pointer:coarse 命中 / 全不命中，每分支独立隔离 + afterEach 恢复全局。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | camera-state.test.ts | 全文件 | 无文件级 `beforeEach(resetCameraState)`，各 describe 依赖执行顺序下的状态自洽（如 test:347 写入 'vmd' 由后续用例自覆盖）；当前 39 用例顺序固定全绿，但新增用例可能踩到残留状态 | 文件级 `beforeEach` 调 `resetCameraState()`（必要时清 scene/canvas）建立独立状态基线 |
| 🟡 P3 | camera-state.test.ts | :360-402 | `resetCameraState` 用例未断言 `_currentPreset` 被重置（生产 :371 `_currentPreset = defaultCameraPreset()` 无覆盖） | 追加 `expect(getCameraPreset().orbit.distance).toBe(16)` 断言预设引用与值均复位 |
| 🟢 P4 | camera-state.ts | :271-273 | `hasCameraVmd()` 只查 `_cameraVmdName` 不查 path；name 非空 + path 为空（仅直接改 setter 参数可致）会误报 true；现有写入路径成对赋值，风险极低 | 改为 `!!name && !!path`，或注释说明「name 即判定依据」 |
| 🟢 P4 | camera-state.ts | :396 / camera.ts:874 | 非法 mode 回退 `isCameraMode(mode) ? mode : 'orbit'` 在两处注册点重复（round-13 修复产物） | 提取 `safeCameraMode(mode): CameraMode` 共享辅助，单点维护 |
| 🟢 P4 | camera-state.ts | :391 | import 语句位于文件中部（ES hoist 保证功能正确），仅风格问题；doc 注释已说明分组意图 | 可接受；若坚持顶部 import，保留注册块注释即可 |
| 🟢 P4 | camera-state.test.ts | :175,248,270,284,296,304,312,395,405 | 测试侧 `as any`（假对象）×5 与 `@ts-ignore`（`delete window.ontouchstart`）×4，均带业务注释，属测试惯用法 | 可接受；如需更严可换 `satisfies`/typed factory，非必须 |

## 测试质量评价

- **断言有效性：高。** 状态转换用例全部为「set 后 get 同一值/同一引用」双向验证（含引用同一性 test:124-130、174-178），非空跑；`resetCameraState` 13 字段逐项断言（test:379-391）+ `_currentCamera`/`_viewMatrixHandle` 置 null（test:394-402）+ scene/canvas **非 reset 范围**契约（test:404-414，与生产 :370-388 不触碰 scene/canvas 精确一致）；action 注册经 mock 捕获后调用生产注册闭包本身。
- **mock 合理性：高。** scene-action-bridge / logger 均为叶子依赖，捕获式 mock 形状与生产导出一致（`registerSceneAction`/`getSceneAction`/`logWarn` 签名逐一核对，见 scene-action-bridge.ts:173-198）；camera-state 本身真实实现（纯状态，无 Babylon 实例化，测试头注释 :6 明示）。
- **边界覆盖：良好。** 非法 mode 回退 + 告警、无 switchCameraMode 降级、null 引用边界（currentCamera/viewMatrixHandle/scene）、空 VMD name、isTouchDevice 四分支均覆盖；`clearCameraVmdState`、`setCameraCanvas(null)` 未直接测（低风险缺口）。
- **跳过测试：0 个**（Vitest 输出确认：`Tests 39 passed (39)`）。
- **小幅缺口**：surroundPaused 的 false 直接转换未测（仅经 reset 间接覆盖）；FOV 仅 1 个往返用例（与 round-32 分工一致，可接受）；无文件级状态隔离（见风险表 P3）。

## 验证记录

- `npx vitest run src/__tests__/camera-state.test.ts` → **Test Files 1 passed, Tests 39 passed (39), 0 skipped**（~0.5s，exit 0）
- `npm run check`（tsc --noEmit）未跑：基线全绿（round-32/37 已确认 camera-state 类型通过），全量 tsc 耗时权衡跳过；测试文件经 Vitest esbuild 转换并执行成功，无类型阻断。
- 资源生命周期核实：camera-state 无 `new`/`create`，仅持引用；`_viewMatrixHandle` 的 observer 实际生命周期在 camera-factory（`_bindViewMatrixPersist` :86-91 绑定 camera.onViewMatrixChangedObservable，切换相机路径 `disposeViewMatrixHandle` 于 camera.ts:474 调用），`resetCameraState` 置 null 与相机 dispose 清 observable 一致，无泄漏路径。
