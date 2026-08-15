# perception-gaze — 审核结果（round-51 测试 3：双路径行为契约）

**审核范围：**
- 测试文件：`frontend/src/__tests__/perception-gaze.test.ts`（442 行，25 用例）
- 被测源码：`frontend/src/scene/motion/perception-gaze.ts`（496 行，调度入口 + 共用骨架 + Swing-Twist clamp）
- 被测源码：`frontend/src/scene/motion/perception-gaze-js.ts`（72 行，JS 写入策略）
- 被测源码：`frontend/src/scene/motion/perception-gaze-wasm.ts`（67 行，WASM 写入策略）
- 关联模块：`perception-shared.ts`（_isWasmRuntime/对象池/角度 getter）、`perception-breathing.ts`（_updateBoneChain）、`scene-action-bridge.ts`（isARActive 查询）

**总体结论：✅ 通过**

25/25 用例实测全绿（257ms），无跳过测试。双路径行为契约（调度分支、写入目标、跳过条件、lookDir 方向、cache 维护）均为真实几何断言，非 mock 自证。发现 1 个 P3（无效 mock）+ 1 个 P3（模块循环依赖），均为维护性风险，不构成功能缺陷。

---

## 亮点

- **Strategy 注入双路径收敛**：`perception-gaze.ts:197-232` 定义 `HeadGazeWriteStrategy`/`EyeGazeWriteStrategy`，JS/WASM 差异收敛为写入策略，共用骨架 `_applyHeadGazeCore`（:235-293）/`_applyEyeGazeCore`（:296-380）承载 lookDir→targetWorldQ→clamp→Slerp→cache 全链路（注释明示净减 ~150 行）。测试 describe 2/3 分别锁定两策略的写入目标（linkedBone vs frontBuffer），describe 4 锁定 `_isWasmRuntime` 自动分支——契约与实现严格对齐。
- **Swing-Twist 分解 + 分量级回归锁定**：`_clampImpl`（:65-111）用 `_swingTwistDecompose`（:117-133）分别限位 twist（yaw）与 swing（pitch+roll），规避 toEulerAngles 大角度信息丢失（round-15 已验证）。测试 describe 6（:337-373）以**分量级**断言回归：纯 Y 旋转 x/z≈0（:349-351）、40°yaw+15°pitch 时 pitch 不被 yaw 连累（:371）——比 round-42 拆分出的 `gaze.int.test.ts` 的角度范围断言（70°-80°）更细，两者互补。
- **lookDir 方向不变量三重验证**（"已踩坑 3 次"）：describe 5 用 ±Z 相机位置（角度 0.1 rad vs 0.001 rad 判据，:303-305）与 ±X 对称位置（y 分量符号相反，:323）双向锁定 `bonePos - camPos` 方向，另有 lookLen=0 重合安全（:326-332）。这是几何真实验证，能防方向反转 bug 回潮。
- **mock 与生产判定同构**：`makeBone` 以 `updateWorldMatrix` 有无区分 JS/WASM（test.ts:64-69），与生产 `_isWasmRuntime = !('updateWorldMatrix' in bone)`（perception-shared.ts:216-218）判定方式完全一致——mock 直接映射生产分支条件，非"测怎么写"。
- **异常路径覆盖完整**：tier='low'（:98-112）、全禁用（:114-128）、无匹配骨骼（:130-144）、相机与骨骼重合（lookDir 长度平方 < 0.0001 提前返回，生产 :250-252/:314-316）、WASM 平移部分不变（:219-233）、cache 首次创建/二次复用（:173-189/:211-217）。
- **生产代码防御性良好**：parentBone 缺失回退 Identity（:263-265）、WASM 写入 guardNum 防 NaN 污染缓冲区（wasm:22-26/:38-42）、`skeleton?._markAsDirty?.()` 可选链（:448）、`_propagateChildrenWasm` 递归内弃用全局池避免覆写（shared:185-186 注释）、对象池 per-context 隔离（ADR-164）。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | perception-gaze.test.ts | :16-18 | **无效 mock（幽灵 mock）**：`vi.mock('../ar/ar-camera', ...)` 路径不存在（`src/ar/` 目录不存在，真实文件在 `src/scene/ar/ar-camera.ts`），且生产代码 `perception-gaze.ts:137` 经 `getSceneAction('isARActive')`（scene-action-bridge）查询、**不 import ar-camera**。实测 stderr 输出 `[scene-action-bridge] 'isARActive' 未注册——调用将静默跳过`，证明 mock 从未生效，测试通过依赖 bridge 未注册时 `?.() ?? false` 兜底。后果：`_getGazeTarget` 的 AR 分支（cam.getDirection 投影 1.5m）**从未被任何用例覆盖**，且维护者会误以为 AR 已被 mock | 删除该 mock，改为显式 mock `@/core/scene-action-bridge` 的 `getSceneAction`（或注册 isARActive 桩），使 AR/非 AR 分支都进入测试矩阵 |
| 🟡 P3 | perception-gaze.ts | :37-38 ↔ js:11-16 ↔ wasm:11-16 | **模块循环依赖**：perception-gaze ↔ perception-gaze-js/wasm 互相 import（core 函数 vs strategy 包装），依赖 ESM 函数声明提升规避求值期 TDZ。当前 25 用例通过证明运行无碍（:35-36 注释已意识到循环、靠 re-export getter 缓解），但一旦 core 改为 const 箭头函数或加模块级副作用即会炸 | 将共用骨架抽至独立模块（如 `perception-gaze-core.ts`），js/wasm 只 import core，切断环 |
| 🟢 P4 | perception-gaze.ts | :423-449 | `_applyGaze` 的 isWasm 分支与 else 分支几乎逐行重复（~14 行，仅函数名不同），虽骨架已收敛但调度层仍重复 | 先选 strategy 再统一调用一次 core，或抽 `applyByStrategy` 小函数 |
| 🟢 P4 | perception-gaze.ts | :41-50 | 死常量：`_DEFAULT_EYE_SMOOTH`/`_DEFAULT_HEAD_GAZE_MAX_YAW`/`_DEFAULT_HEAD_GAZE_MAX_PITCH`/`_DEFAULT_EYE_GAZE_MAX_YAW`/`_DEFAULT_EYE_GAZE_MAX_PITCH` 定义后从未使用（实际值从 perception-shared getter 动态读取，grep 全仓仅定义处出现） | 删除，或改用它们初始化 shared 默认值，消除"看着像生效"的误导 |
| 🟢 P4 | perception-gaze.ts | :467-496 | `applyGazeWasm` 与 `_applyGaze`（:402-413）的骨骼查找/needHead/needEye 逻辑重复；且经 perception.ts:36/65 re-export，round-15 已确认无外部调用者（仅预留），疑为死代码 | 统一走 `_applyGaze`（传 bones 子集），或标注 deprecated 待清理 |
| 🟢 P4 | perception-gaze.ts | :310 (:296-380) | `_applyEyeGazeCore` 无空数组守卫：`eyeCenter.scaleInPlace(1 / eyeRuntimes.length)` 传空数组得 Infinity→NaN。当前调用方（`_applyGaze` needEye 检查、测试）均保证 length>0 | 入口加 `if (eyeRuntimes.length === 0) return;` 防御（与 head 的 lookDir 守卫对称） |
| 🟢 P4 | perception-gaze.ts | :268 | 魔法数值：head 平滑 0.7 硬编码（`_gazeAlpha(0.7, dt)`），而 eye 用 `getEyeGazeSmooth()` 动态可调——head 平滑不可调，不对称 | 在 perception-shared 增加 `headGazeSmooth` 可调项，或注释说明 0.7 为刻意固定值 |
| 🟢 P4 | perception-gaze.test.ts | — | 覆盖缺口：`headClaimed`/`eyeClaimed` 认领过滤参数（:424/:428-430）、`tier='medium'`、`applyGazeWasm` 入口、AR 分支（与无效 mock 同源）均无用例 | 优先补 AR 分支（修 P3 mock 后顺带）；claim 过滤为独立小用例 |

---

## 测试质量评价

**断言有效性：强。** 双路径行为用"写入目标对象是否改变"双向验证（JS 改 linkedBone 不改 worldMatrix，WASM 反之，describe 2/3/4），跳过条件验证"不修改任何骨骼"（:111/:127），lookDir 方向用 ±Z 角度判据（0.1/0.001 rad 量级差异）+ ±X 符号判据做几何验证，Swing-Twist 用 x/z 分量级判据（1e-6 精度）——均非脆弱断言。

**mock 合理性：高。** 骨骼 stub 以 `updateWorldMatrix` 有无映射生产 `_isWasmRuntime` 判定（与生产同构），相机 stub 仅暴露 `.position` 最小面，`worldMatrix` 用 Float32Array(16) 保持平移可观测。唯一缺陷即无效的 ar-camera mock（P3）。

**边界覆盖：优秀。** tier low/全禁用/无匹配骨骼/相机重合/平移保持/cache 生命周期（首次+复用）/眼睛 lookDir=0 均有独立用例，且无任何 skip/todo/only（grep 零命中）。

**与历史轮次分工：** round-8 审 perception 拆分（本测试所测骨架即其产物）；round-15 审 perception-gaze 知识卡（Swing-Twist ✅，本测试 describe 6 即其回归锁定）；round-42 审 gaze.int（ADR-204 拆分出 `perception/gaze.int.test.ts` 193 行，覆盖 clamp 角度范围 + _gazeAlpha + gaze reset）。**本测试与其互补分工**：gaze.int 测 clamp 结果的角度行为（背后不翻 180°、眼比头紧），本测试测调度/写入/方向/cache 的架构契约 + clamp 的分量级精度——重叠面仅 describe 6 与 gaze.int describe 1（同测 `_clampHeadGazeTarget`，但判据维度不同，非重复）。

---

- 审核日期：2026-08-15
- 审核员：子代理 round51-perception-gaze
