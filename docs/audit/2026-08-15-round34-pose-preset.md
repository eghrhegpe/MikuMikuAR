# 第 34 轮审核报告（测试 #2）— pose-preset 测试 + 发生器源码

> **日期**: 2026-08-15
> **审核员**: 子代理 round34-pose-preset
> **范围**:
> - 测试文件: `frontend/src/__tests__/pose-preset.test.ts`（199 行，13 用例）
> - 被测源码: `frontend/src/motion-algos/pose-preset.ts`（57 行，`generatePoseVmd` L23-56）
> - 直接依赖: `frontend/src/motion-algos/vmd-writer.ts`（`buildVmd`/`BoneKeyFrame`，编码链路下层）
> - 消费者: `frontend/src/menus/motion-pose-levels.ts:111-144`（Pose Studio 预设 chip）
> **验证**: `cd frontend && npm run test -- src/__tests__/pose-preset.test.ts` → **13/13 通过**（vitest 4.1.9，151ms，基线全绿）。
> **结论**: ✅ **通过**（P1×0 / P2×0 / P3×1 / P4×4）

## 与既往审核的关系（round-15 / round-28）

- **round-15（2026-08-07）**：审过 pose 相关模块——`2026-08-07-round15-scene-shared-pose-serialize-env.md` 覆盖 scene-shared-pose 一组（composition-guide / camera-angle / watermark / scene-bundle 等），其中 **`2026-08-07-round15-motion-algos.md` 已源级审过 `pose-preset.ts` 并判 ✅**（委托 buildVmd、Quaternion 使用正确）。本轮 34 与此互补：round-15 管源码健康度，本轮管**测试文件**对「UTF-8 编码 → Shift-JIS 读回乱码 → 姿态静默失效」这一历史 bug 的锁死质量。
- **round-28（2026-08-15 当日，round-28-vmd.md）**：审 vmd-writer/vpd-parser 及其测试（编码链路下层：`sanitizeName`/`canEncodeName`/双字节截断）。本测试覆盖链路**上层**的 pose-preset 语义（T/A/rest 姿势数值 + 标准骨骼名编码正确性），与 round-28 分工清晰、无重叠。

## 亮点

- **双重回归锁，覆盖历史盲区**：测试文件 L53-96（编码回归）+ L143-198（数值内容）两段。L98-103 注释明确记录历史盲区——旧测试只验头部与编码、从不验实际写入的旋转值，若 `addBone` 角度/方向写错或 tpose/apose 分支被误合并则抓不出；本轮 7 个数值用例（旋转/位置/帧号/morph/trailer）把该盲区封死。
- **黑盒独立解码模拟 VmdLoader 读回**（`pose-preset.test.ts:18-35`）：`decodeBoneNames` 按 VMD 规范从字节重新推导偏移（54 头 / 111 帧 / 15 字节名 / NUL 截断），未复用生产布局常量，且解码走 `encoding-japanese`——与真实 loader 的 `TextDecoder('shift-jis')`（babylon-mmd `vmdObject.js:129`）是两条独立解码实现，编码错误不会被「生产编码 + 生产解码」同源回环掩盖。
- **字节数判别断言直击历史 bug 类别**（`pose-preset.test.ts:79-95`）：`end - off === decoded.length * 2` —— Shift-JIS 全角字符 2 字节/字（左腕=4B），UTF-8 为 6B；该断言对编码回归的敏感度不依赖解码器 round-trip 是否正确，UTF-8 误编码必然失败。
- **源码委托设计消除手写二进制**（`pose-preset.ts:11, 56`）：`generatePoseVmd` 只组装 `BoneKeyFrame[]`，编码/排序/打包全委托 `vmd-writer.buildVmd`——历史 bug（手写 TextEncoder(UTF-8) 编码骨骼名）的根源路径被结构性移除。
- **纯函数 + 局部闭包**（`pose-preset.ts:23-56`）：无模块级可变状态，`addBone` 为函数内闭包不逃逸；快速连点 Pose Studio chip 每次调用独立，无并发/竞态面。
- **数值语义化而非魔法数字**（`pose-preset.ts:39-52`）：旋转角用 `Math.PI` 分数（`-Math.PI/2` 等）+ 逐行中文注释（「左上臂外展」/「肘微曲」），非裸角度值；骨骼名是 MMD 标准日文常量，符合 VMD 规范语义。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `frontend/src/motion-algos/pose-preset.ts` | 23, 37-54 | 运行时无非法 `PoseType` 守卫：传入未列名值（如未来调用方拼错 `'t-pose'`）会**静默落入 rest 分支产出空 VMD**，UI 侧仍弹成功 toast，属静默失效路径（TS 联合类型仅编译期防护） | 改用 `switch` + `default: throw`（或 exhaustive 检查），非法类型快速失败 |
| 🟢 P4 | `frontend/src/motion-algos/pose-preset.ts` | 37-53 | `'rest'` 分支在生产无调用点：`motion-pose-levels.ts:119-123` 对 rest 直接 `stopVMD` 返回，不调 `generatePoseVmd`，rest 分支当前仅测试覆盖 | 属 API 完整性设计，可在注释标注「rest 供 API 统一性/测试使用」，不阻断 |
| 🟢 P4 | `frontend/src/menus/motion-pose-levels.ts` | 124 vs 126-142 | `generatePoseVmd` 在 `try` 块**之外**调用（try 只包 `loadVMDMotion`）；若构造阶段抛异常会成未处理 rejection。输入为硬编码常量，实际不可达 | 把 L124 移入 try 或前移 try 起点，一行成本 |
| 🟢 P4 | `frontend/src/__tests__/pose-preset.test.ts` | 31, 88-92 | 解码用与编码**同一** encoding-japanese 库，理论上存在「同库对称缺陷」（encode 错但自 round-trip 正确）盲区；真实 loader 用 `TextDecoder('shift-jis')`。核心 UTF-8 回归仍会被字节数/U+FFFD/名称断言抓住，风险仅理论 | 增加黄金字节断言：左腕名字段前 4 字节 `== [0x8D, 0x9A, 0x8C, 0xE5]`，彻底打破同库回环，成本一行 |
| 🟢 P4 | `frontend/src/__tests__/pose-preset.test.ts` | 32, 92 | 两处 `as string` 断言式 cast（encoding-japanese 类型标注宽容），测试代码可接受 | 可选：抽 `decodeSjis(raw)` helper 收敛，非必须 |

## 测试质量评价

**结论：优秀。** 13 用例全部真实有效，无跳过（无 `it.skip`/`describe.skip`/`xit`/`.only`），无 DOM 依赖（`@vitest-environment node` 标注正确，隔离干净）。

**断言有效性（逐类核验）**：
- **编码正确性**：① 名称断言 `toContain('左腕')` 等 6 个标准骨骼名（L54-71）；② 无 `\uFFFD` 替换字符（L73-77）；③ SJIS 字节数判别（L79-95）。三类断言相互独立，UTF-8 回归（历史 bug 形态）至少被其中两类同时捕获，锁死强度高。
- **姿势数值**：T-pose 左腕 `q=[0,0,-√2/2,√2/2]`（L150-157）、A-pose `-45°`（L159-163）经 `toBeCloseTo` 验证，与源码 `Quaternion.FromEulerAngles(0,0,∓π/2|∓π/4)` 的 YXZ 纯 Z 旋转数学一致（纯 Z 旋转与欧拉序无关，无歧义）；tpose≠apose 差分用例（L165-169）防分支误合并。
- **结构**：signature（L40-41）、骨骼计数精确 6/6/0（L144-148）、rest 精确字节长度 74=54+4+16（L49）、position 全 0 / frame 全 0（L171-187）、morph=0 + trailer 四段全 0（L189-198）——所有偏移（15/19/31/50/54）与 VMD 规范逐一核对无误。

**边界覆盖**：三预设全覆盖（tpose/apose/rest）；日文名（全角/平假名）覆盖；rest 空数据 + 精确长度覆盖。**未覆盖**：① 15 字节长名截断 / 不可编码名回退——属 vmd-writer 测试分工（`vmd.test.ts:417` 长名截断、`vpd-parser-security.test.ts:281` 已覆盖），且 pose-preset 的 6 个骨骼名均为硬编码短名，无回退路径可走，非本文件职责；② trailer 仅 tpose 断言，rest 由字节长度隐式覆盖，缺口极小。两处均为 🟢 级，不阻断。

**轻微注意事项（不构成风险）**：旋转值用例依赖 `buildVmd` 稳定排序使第 0 帧 = 插入序首骨「左腕」（L151 注释已明示；ES2019+ 规范保证稳定排序）；若未来 `buildVmd` 改变同帧 tie-break，用例会报错——这是「排序语义变化」的正确信号而非误报，属可接受的耦合。
