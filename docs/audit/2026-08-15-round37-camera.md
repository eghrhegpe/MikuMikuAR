# [camera] 主相机模块审核 — 第 37 轮（测试 2/3）

## 审核范围

**测试文件：** `frontend/src/__tests__/camera.test.ts`（1040 行，75 用例全绿、0 跳过，188ms）

**被测源码（只读，未修改）：**
- `frontend/src/scene/camera/camera.ts`（875 行）— 主调度
  - `:170-216` setOrbitParams / setFreeflyParams / setConcertParams / setSurroundParams / logCameraAlpha
  - `:226-287` _legacyEntry / _resolveBehavior / _syncAxesFromMode / clampFov
  - `:297-347` setCameraControl / setCameraBehavior / setFov（双轴写入）
  - `:352-368` initCameraSystem
  - `:373-573` switchCameraMode（含 AR 异步竞态 :405-455）
  - `:578-598` autoFrame
  - `:623-777` getCameraState / setCameraState（序列化 + 迁移）
  - `:782-807` disposeCameraSystem
- `frontend/src/scene/camera/camera-state.ts`（412 行）— 状态层（getter/setter + resetCameraState + bridge 守卫）
- 参照（mock 侧）：camera-vmd.ts（round-13 P1 修复核实）、camera-factory.ts:216-220、camera-behaviors.ts、camera-auto.ts（mock 形状一致性）

**验证：** `npm run test -- src/__tests__/camera.test.ts` → 75/75 通过（0 跳过，2.25s）。`npm run check` 未跑（基线全绿，耗时权衡跳过——round-32 已对 camera-state 跑过 check exit 0）。

## 总体结论

✅ **通过** — 测试断言有效、mock 合理、边界覆盖充分（AR 三路径竞态/旧存档迁移/非法 mode 回退/销毁幂等）；生产代码类型安全（0 处 `as any`/`@ts-ignore`）、资源释放完整（disposeCameraSystem 已接线 scene.ts:336）、历史 P1/P2 均已修复。仅 1 项 P3（AR 竞态 cleanup 分支测试严格性不足，见风险表）与 4 项 P4，均不阻塞。

## 与历史审核的关系与遗留

| 轮次 | 原问题 | 当前核实 |
|------|--------|----------|
| round-11（2026-08-06） | ar-camera **P1 死锁**：`ar-camera.ts:129-138,310` `requestCameraPermission` 检查缺失 → `_starting` 永不复位 → AR 永久死锁 | 属 **ar-camera.ts** 而非 camera.ts（不在本次被测范围，遗留待 ar-camera 专项确认）。本次确认 camera.ts 的 AR **入口侧**（switchCameraMode ar 分支 :405-455）已实现 resolve(false)/reject/resolve(true)已切走 三路径处理，死锁若复现必在 ar-camera 内部 |
| round-13（2026-08-06） | camera.ts **P1#1**：vmd→orbit→vmd 复用已 dispose MmdCamera | ✅ 已修复：`camera-vmd.ts:102` 加 `!_mmdCamera.isDisposed()` 守卫 + `:26` 保留 `_mmdAnimation` 源引用重建动画句柄（:108-113） |
| round-13（2026-08-06） | camera-state **P2#1**：bridge setCameraMode 只写标志不切相机 | ✅ 已修复：`camera-state.ts:392-409` 委托 `getSceneAction('switchCameraMode')`（camera.ts:873-875 注册，含 isCameraMode 运行时校验），未注册时降级状态写入 |
| round-13（2026-08-06） | camera **P2#2**：disposeScene 未调 disposeCameraSystem（全工程无调用点） | ✅ 已修复：`scene.ts:336` `tryDisposeSubsystem('camera-system', disposeCameraSystem)`，并有 `scene.test.ts:731` 断言 |
| round-13（2026-08-06） | camera **P3**：状态直写绕过 setter（uiState.autoCameraEnabled 直写） | ⚠️ 仍存在：`camera.ts:724,731` 直写 `uiState.autoCameraEnabled`，但代码注释明确「P2 权威原则」豁免（与 restoreAutoCameraState 启动顺序竞态的修复需要），测试 1023-1039 固化该行为，属有意设计 |
| round-32（2026-08-15） | camera-state FOV 层 ✅ 通过 | 分工延续：camera.test.ts:933-972 管相机层 clamp（min/max/NaN/Infinity/arc.fov 同步），render-postprocess.test.ts 管 UI 区间往返，零重叠 |

## 亮点

- **AR 异步竞态三路径闭环**（camera.ts:405-455）：乐观提交 `_cameraMode='ar'`（保证切走检测命中）→ `.then(resolve false → 还原标记)` / `.catch(reject → 还原标记 + logWarn)` / `resolve(true) 但已切走 → setARMode(false).catch 释放摄像头流`。测试 498-538 逐一覆盖三路径 + 离开 ar 注销，`flush()` 时序驱动验证（test:302）。
- **编译期穷尽 + 运行时守卫双保险**：`_legacyEntry`（camera.ts:248-251）与 switchCameraMode default 分支（:514-518）用 `never` 断言强制新增 CameraMode 报 TS 错；运行时侧 `isCameraMode`（camera-state.ts:34-36）守卫桥接入口与反序列化（camera.ts:661-664、camera-state.ts:396）。测试 it.each 穷尽 8 个合法 mode 派生双轴（test:915-931）。
- **旧存档迁移判别式**（camera.ts:670-683）：以 `'speed' in oldConcert && !('sweepAngle' in oldConcert)` 精确识别旧形态 concert，重定向为 surround 并 `delete` 旧字段，测试 635-651 验证 mode/behavior/preset 三处迁移结果。
- **FOV NaN/Infinity 防护**（camera.ts:279-287 clampFov）：NaN 回退 0.8 不污染 `_fov` 与 live camera，±Infinity 钳到边界；测试 958-971 覆盖 NaN/Infinity/无相机，且与 render-postprocess 分工注释明确。
- **resetCameraState 单一默认状态源**（camera-state.ts:95-110, 370-388）：模块级 `let` 初始化与 reset 均从 `DEFAULT_CAMERA_STATE` 取值（round-13 code_review P3 修复），`disposeCameraSystem` 结尾调用（camera.ts:806）防 HMR 状态分裂。
- **disposeCameraSystem 完整性**（camera.ts:782-807）：stop 全部 5 类行为循环 + `clearCameraVmd`（round-16 P3 修复，测试 738-742 断言）+ cam.dispose try/catch（场景已销毁时吞错）+ 清 scene/canvas + resetCameraState；无相机时幂等（测试 733-736）。测试 719-742 断言 5 个 stop 全部触发。
- **测试 mock 卫生**（test:16-257）：vi.hoisted 单例工厂只被 vi.mock 工厂引用（规避 hoist 期 TDZ，符合 ADR-219 铁律）；Babylon 假对象用 class 声明支持 `instanceof`（ArcRotate/Universal 判别路径真实可达）；**camera-state 用真实实现**（纯状态，测试:10 明示）；camera-behaviors 9 个 / camera-auto 6 个 mock 导出与生产逐一核对一致；beforeEach 全量复位双轴/相机/上下文/共享 mock（test:304-328）。
- **测试分工护栏**（test:334-339）：文件头注释声明与 vmd-state/presets/guards/serialization 拆分文件的用例分工，避免重复维护——与 round-13「camera.adr100 45 用例」报告的分工脉络一致。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | camera.ts | :438-442（测试 523-530） | AR 竞态 cleanup 分支未被严格验证：测试「切 ar → 立即切 orbit → flush」只断言 `setARMode` 被 `toHaveBeenCalledWith(false)` 调用过——离开 ar 分支（:388）与竞态 cleanup 分支（:439）都调 false，无法区分路径；若 cleanup 分支未来被删，测试仍会绿 | 断言调用序列与次数（如 `toHaveBeenCalledTimes(3)`：true 1 次 + false 2 次），或让 setARMode mock 记录调用时序显式断言「后到的 resolve(true) 触发第二次 false」 |
| 🟡 P3 | camera.ts | :423-453 | 进入 ar 时若 `setARMode` action 未注册（ar-scene 未加载/配置缺失），`getSceneAction('setARMode')?.(true)` 短路返回 undefined → 无 promise 回调可还原，`_cameraMode` 乐观提交 'ar' 后永久停留（相机从未重建、无视觉反馈）。正常运行中 ar-scene 必注册，属配置缺失场景；测试未覆盖 | 未注册时同步回退 `prevMode` 并 logWarn（与 :429-431 还原路径一致）；补「setARMode 未注册切 ar」用例 |
| 🟡 P3 | camera.ts | :762 | `positionY ?? 8` / `positionZ ?? 16` 魔法默认值，与 getCameraState 无相机时 position 全 0（:645-647）语义不对称：存档 positionX 存在但 Y/Z 缺失时恢复 8/16（8=默认 focusCenterY，16=默认 radius，语义隐含）。测试 589-596 固化了 8/16 但未注释 | 提取命名常量（如 `DEFAULT_FOCUS_Y`/`DEFAULT_RADIUS`）单源，测试断言引用常量 |
| 🟢 P4 | camera.ts | :590-592 | autoFrame 魔法数值 `extent * 0.75 + 2`、`-Math.PI / 2`、`Math.PI / 2.2` 硬编码（测试 542-550 固化公式，数值语义「0.75 缩放 + 2 缓冲」「前视 + 俯角」无命名） | 提取命名常量或注释数值意图，便于调参时对齐测试 |
| 🟢 P4 | camera.ts | :782-807 | disposeCameraSystem 未显式调用 `disposeViewMatrixHandle`（camera-factory.ts:216，switchCameraMode:474 切相机时调用），仅靠 `cam.dispose()` + resetCameraState 将 `_viewMatrixHandle` 置 null。Babylon dispose 会清理相机 observers，泄漏风险低，但两处释放路径不对称 | disposeCameraSystem 中与 switchCameraMode 对齐显式调用 `disposeViewMatrixHandle()`（safeDispose 幂等） |
| 🟢 P4 | camera.ts | :305-311, 331, 339 | setCameraControl/setCameraBehavior 的 headless 补派生路径（switchCameraMode 无 scene 早退后补提交双轴）无专门测试——beforeEach 总是提供 scene/canvas，该路径在测试中不可达 | 补「setCameraScene(null) 后 setCameraControl('freefly') 仍写双轴」用例，固化 ADR-100 P4 的 scene 无关出口 |
| 🟢 P4 | camera.test.ts | :122-124, 545, 842 等 | 测试侧 6 处 `as any`/`as never`（相机类导出宽类型、autoFrame 中心参数、position 覆盖），均有注释说明理由（mock 与 Babylon 真实类型无结构兼容性）——生产代码 0 处，不影响健康度 | 维持现状；如后续引入 Babylon 类型 stub，可逐步收敛 |

## 测试质量评价

- **断言有效性：强。** 双轴（getCameraControl/Behavior/ScriptedSubMode 直断）、模式切换（mode + stop/start 副作用调用 + 相机实例）、序列化（getCameraState 字段级断言 / setCameraState 恢复后 state + live camera 双验证）、迁移（mode/behavior/preset 三处）、FOV（state + arc.fov 双写）均验证真实行为而非 mock 自证。
- **mock 合理性：高。** Babylon 最小假对象 class 声明支持 `instanceof` 判别（ArcRotate/Universal 类型分流路径真实可达）；camera-state 真实实现（纯状态，无 mock 风险）；camera-* 子模块 mock 与生产导出逐一对齐；`vi.hoisted` 单例符合 ADR-219 卫生铁律；`beforeEach` 全量复位杜绝用例间串扰。
- **边界覆盖：充分。** AR 三路径（resolve false/reject/resolve true 竞态）、旧 concert 迁移、非法 mode 回退 + 告警、无相机（autoFrame/getCameraState/setCameraState/dispose 四类 null 安全）、无 scene 早退、FOV NaN/Infinity/无相机、模式-相机类型不匹配不同步、显式非 beatcut 清自动运镜标志。
- **跳过测试：0 处**（it.skip/todo/only 全无）。
- **轻微瑕疵：** ① AR 竞态 cleanup 分支严格性不足（P3，见风险表）；② setARMode 未注册分支与 headless 补派生路径无测试（P3/P4）；③ 测试侧少量 `as any`（有注释，P4）。均不阻塞通过结论。

---

审核日期：2026-08-15
审核员：子代理 round37-camera
