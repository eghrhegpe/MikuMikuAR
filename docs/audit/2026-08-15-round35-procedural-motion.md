# Round-35 审核报告 — procedural-motion 主测试 + 程序化动作生成链路

> **审核日期**: 2026-08-15
> **审核员**: 子代理 round35-procedural-motion
> **本轮**: round-35 / 测试 1（共 3）

## 审核范围

- **测试文件**: `frontend/src/__tests__/procedural-motion.test.ts`（710 行，78 用例）
- **被测源码**（经 `procedural-motion.ts` barrel 间接到达）:
  - `frontend/src/motion-algos/procedural-motion.ts`（25 行）：`shouldAutoDance` :7-15、`shouldIdle` :17-25，barrel re-export :1-3
  - `frontend/src/motion-algos/proc-motion-shared.ts`（338 行）：`DEFAULT_PROC_STATE` :87-96、`migrateProcState` :114-157、`matchBone` :295-308、骨骼候选常量 :159-293、`FPS`/`MAX_FRAMES` :323-324
  - `frontend/src/motion-algos/proc-motion-idle.ts`（268 行）：`generateIdleVmd` :25-268
  - `frontend/src/motion-algos/proc-motion-autodance.ts`（149 行）：`generateAutoDanceVmd` :46-147
  - `frontend/src/motion-algos/proc-motion-autodance-emotion.ts`（252 行）：`scoreMorph` :56-71、`findBestEmotionMorphs` :77-108、`EMOTION_CANDIDATES` :32-41（测试第 16 行直接 import）
  - 旁证：`vmd-writer.ts`（二进制布局核实）、`proc-motion-autodance-bones.ts:130-147`（resolveBones）、`scene/motion/proc-motion-controller.ts:318-344`（判定消费端）

## 总体结论：⚠️ 有条件通过

范围内 **无 P1**（round-15 matchBone P1 已修复，见关系表），**P2×1**（MAX_FRAMES 守卫语义不一致）、P3×9、P4×5。生产代码健康度整体高：全链路纯函数无状态无副作用、类型安全（0 处 `as any`/`@ts-ignore`/空 `catch{}`）、无资源泄漏。扣分项集中在**测试断言强度**（intensity 相关 byteLength 比较恒真、matchBone P1 修复无回归测试）与**跨轮遗留项**（round-15/21 的 P3 未闭环）。测试运行验证：`npm run test -- src/__tests__/procedural-motion.test.ts` → **78/78 passed**（2.03s），基线全绿。

### 与既往轮次的关系（核实结果）

| 轮次 | 覆盖情况 |
|------|----------|
| round-6 (playback-procedural-perception) | autodance 曾为 **540 行 + 0 测试**（❌ 不通过）。本文件已彻底覆盖：autodance describe 21 用例 + 重构回归块（节拍栅格/肘部/无缝循环/重复帧守卫），遗留问题闭环 ✅ |
| round-15 (motion-algos) | `matchBone` P1（首个不可编码候选 `return null`）**本轮已修**：`proc-motion-shared.ts:301-304` 现为 `logWarn + continue`，修复引入于 commit ee6f2bc5。**但修复无回归测试**（见 P3#8）。`logWarn` 输出正常信息 P3 仍存（emotion:146-149，测试 stderr 可见噪音）。`genShyMorph` 越界 P2#4 经核实**当前不可达**（`loopFrames = beatFrames*8` 且 `beatFrames ≥ 1`，推得 `end ≤ loopFrames` 恒成立） |
| round-21 (proc-motion-migrate) | `migrateProcState` 三处遗留仍存：嵌套分支 NaN 不对称（P3#4）、`_defaultParams`/`_fallbackParams` 字面量重复（P3）、与 `proc-motion-migrate.test.ts` 测试重复（P3#9）；`interpOverride` 无枚举校验 P4 仍存 |
| 本轮新发现 | P2（MAX_FRAMES 语义）、dead toggle（head/blink 零消费）、dead 候选常量（thigh/knee）、surprise 关键词疑似笔误、intensity 恒真断言 |

## 亮点

- **二进制级断言 + 偏移已逐项核对正确** — `procedural-motion.test.ts:59-66/701-709` 的 VMD 布局计算（54 头部 + 111 帧、position 12B → rotation 16B，`rotation.w` 位于帧内 +43）与 `vmd-writer.ts:123-158` 实测布局一致；「loop closes」末帧 `w≈1`、「intensity=0 identity quaternion」均真实验证了循环闭合语义。
- **P1 回归守卫有真实二进制检测力** — `_parseBoneFrameKeys`（test:358-375）对「骨骼名@帧号」复合键计数，`procedural-motion.test.ts:377-393/442-454` 以 108 标准骨骼集 × 5 档 speed 断言零重复关键帧，直接钉死旧实现「循环末帧 + 复位帧」双关键帧缺陷，这类断言无法靠糊弄通过。
- **boneToggles 开关做功能级反向验证** — `procedural-motion.test.ts:396-422`：关闭 arm/footIk 后用 `_parseVmdBones` 断言骨骼帧**缺席**（而非只断言存在），且验证默认全开时 4 类骨骼均生成，覆盖了开关的真实生效路径。
- **迁移引用隔离用 `toBe` 恒等断言** — `procedural-motion.test.ts:546-553` 修改 idle 的 boneToggles 后验证 autodance 不受影响，`toBe`（引用恒等）而非 `toEqual` 糊弄；配合 `:530-544` 逐类别补默认，直击 round-21 修复的两个风险点。
- **生产侧异常处理前置集中** — 速度/BPM 的 NaN 归一 + clamp 全部收敛在入口（`proc-motion-idle.ts:26-28`、`proc-motion-autodance.ts:55-57`），生成器内零 NaN 传播；`guardNum`（`core/guards.ts:5-7`，`typeof number && isFinite`）与扁平迁移分支对称使用。
- **纯函数设计，并发安全** — `generateIdleVmd`/`generateAutoDanceVmd`/`migrateProcState`/`matchBone` 全部无状态无副作用，快速连调 3 次产生 3 个独立 ArrayBuffer，无竞态（心理模拟核实）。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | proc-motion-autodance.ts | 57-59 | **MAX_FRAMES 守卫语义不一致**：`beatFrames = Math.min(MAX_FRAMES, …)` 但 `loopFrames = beatFrames * 8`，封顶被放大 8 倍。speed=0.1、bpm=60 时 `beatFrames=300` → `loopFrames=2400`（80s 循环，30fps），而同配置 idle 分支直接 `Math.min(600, …)` 封顶 600（proc-motion-idle.ts:28）。常量 `MAX_FRAMES=600` 的容量意图在 autodance 被静默绕开，极端参数下 VMD 体积约 4 倍于 idle | autodance 对 `loopFrames` 再套一次 `Math.min(MAX_FRAMES, …)`（8 拍栅格仍可保留，仅封顶整循环）；现有 speed 比较测试（slow>fast）不受影响，改后可加一条 speed=0.1 时 `loopFrames ≤ 600` 的回归 |
| 🟡 P3 | procedural-motion.ts | 17-24 | `shouldIdle` 的 mode 条件 `(mode==='idle' \|\| mode==='off' \|\| mode==='autodance')` 对三值枚举是**恒真式**，mode 参数实际无任何效果；未来新增第 4 个 mode 时该模式会静默拿不到 idle，而现有 8 个用例（test:273-290）全部固化这一恒真行为，无法兜住 | 简化为 `!audioPlaying && !hasUserVmd` 并删除 mode 参数（同步改 controller 与 mock），或保留参数但改为显式白名单并在测试中注释「当前三值全放行」 |
| 🟡 P3 | proc-motion-shared.ts | 14-29 | `boneToggles` 的 `'head'`/`'blink'` 类别**全仓零消费**：两个生成器不读（idle 只读 center/upper2/waist/allParent/arm/shoulder/wrist/footIk；autodance 的 resolveBones 无 head），scene 层 grep `boneToggles.head/blink` 零命中。`blink` 有注释解释（感知层 ADR-079 拥有），`head` 无任何说明——UI 开关「头部微动」是静默无效控件 | 为 `head` 补注释说明归属（感知层 `headTrackingEnabled` 承担），或从枚举移除；在 migration 中保留键以免旧存档静默关闭行为变化 |
| 🟡 P3 | proc-motion-shared.ts | 128-132 | **嵌套分支 NaN 不对称**（round-21 P3 遗留）：`mergeParams` 内 `...p` 透传，`params.idle.intensity = NaN` 可进入渲染数学；扁平分支过 `guardNum`（:142-143），两分支防御深度不一致。现有 NaN 用例（test:565-583）只覆盖扁平路径 | `mergeParams` 对 `p.intensity`/`p.speed` 补 `guardNum`，与扁平分支对称；补一条嵌套 NaN 用例 |
| 🟡 P3 | proc-motion-shared.ts | 237-272 | `BONE_THIGH_*`/`BONE_KNEE_*` 候选常量**死代码**：全仓仅定义处引用（`feet-adjustment.ts:87-88` 另维护一份私有大腿候选，值与 shared 不同——重复且可能漂移） | 删 shared 死常量，或让 feet-adjustment 复用 shared 候选；`npm run check:consumers` 确认后清理 |
| 🟡 P3 | proc-motion-autodance-emotion.ts | 146-149 | `logWarn` 输出**正常信息**（「表情 morph 匹配」「未找到任何表情 morph」），round-15 P3 遗留；每次 autodance 生成（含测试）都向 stderr 打警告，测试运行输出可见噪音，且与 ADR-248 热路径日志纪律相悖 | 降级为 `logDebug`/`logInfo` |
| 🟡 P3 | procedural-motion.test.ts | 92-97、176-181 | **intensity 的 byteLength 大小比较断言恒真**：帧数不随 intensity 变化（loopFrames 只依赖 speed/bpm），intensity=0 与 =1 的 VMD **等长**，`>=`/`<=` 无条件成立，未验证任何旋转幅度。「intensity=1 produces larger rotations」名不副实 | 删掉这两条，或改为直接断言 rotation 值（参照 test:69-76 与 701-709 已存在的有效直接断言，可合并强度梯度：intensity=0.1 vs 1 时首帧 rotation.x 单调） |
| 🟡 P3 | procedural-motion.test.ts | 588-612 | **matchBone P1 修复无回归测试**：`proc-motion-shared.ts:301-304` 的 continue 语义（首个匹配候选不可编码 → 跳过继续找后续候选）是全轮次唯一已修的 P1，但 6 个 matchBone 用例全部是「首个候选即命中/不命中」，P1 修复路径零覆盖，回归会静默复发 | 补用例：`matchBone(['😀','センター'], ['😀','センター'])` 应返回 `'センター'`（😀 U+1F600 无法编码为 Shift-JIS，验证跳过逻辑） |
| 🟡 P3 | procedural-motion.test.ts | 490-584 vs proc-motion-migrate.test.ts | **迁移测试重复**（round-21 P3 遗留）：本文件 11 条迁移用例与 round-21 专测文件 6 条近乎逐字重叠（深合并补默认、引用独立），同一行为需双文件同步，存在漂移风险 | 按 round-21 建议二选一：保留专测文件、裁剪本文件重复块，或反向合并；避免两份同义断言并存 |
| 🟢 P4 | proc-motion-autodance-emotion.ts | 36 | `EMOTION_CANDIDATES.surprise` 关键词 `'びく/'` 疑似 `'びっくり'` **笔误（含斜杠）**：标准「びっくり」morph 匹配不到 surprise（test:210-227 里 びっくり 实际未命中，仅靠 笑い→smile 撑起 morph>0 断言） | 改为 `'びっくり'` 并补一条 surprise 命中用例 |
| 🟢 P4 | procedural-motion.test.ts | 55-67 | 「loop closes (first and last bone frame match)」标题声称首末帧匹配，但仅断言**末帧** `w≈1`（identity 闭合），首帧未断言 | 补断言首帧 rotation 接近 identity（f=0 处 rx≈0.0024），使标题与断言一致 |
| 🟢 P4 | procedural-motion.test.ts | 225 | 注释「至少 blink + 情绪 morph」与实现不符：blink 在黑名单中被排除（emotion:12-27），该场景实际只有情绪 morph | 修正注释 |
| 🟢 P4 | proc-motion-idle.ts | 62-262 | 帧步长 `+= 4` 与相位常数（0.5/0.37/0.7/1.1/2.3/1.5/0.8…）为裸魔法数值；`swayAmp` 有注释但相位常数无命名，各骨类别间不可共享调整 | 抽 `IDLE_FRAME_STEP` 常量 + 相位偏移集中为具名配置（可选，程序化动画领域常见折衷） |
| 🟢 P4 | proc-motion-shared.ts | 79-85 vs 99-105 | `_defaultParams` 与 `_fallbackParams` 双份相同字面量（round-21 P3 降级观察）：改默认值时单点漂移，现有测试以 DEFAULT_PROC_STATE 为基准能兜住但属隐式护栏 | `_fallbackParams` 基于 `_defaultParams` 派生（两者均不依赖 DEFAULT_PROC_STATE，保留 mock 抗性） |
| 🟢 P4 | proc-motion-shared.ts | 148、128-132 | `interpOverride` 无枚举校验（round-21 P4 遗留）：脏值透传，消费端 if/else 链静默落默认分支 | 与 mode 同法校验四合法值，失败回落 `'auto'`，或补注释说明消费端兜底 |

## 测试质量评价

**优点**：
- **断言有效性整体高**：二进制结构断言（签名/帧计数/偏移）与生产 `vmd-writer` 布局逐字节核对一致；`_parseBoneFrameKeys` 重复帧检测、`_parseVmdBones` 骨骼帧缺席验证、migrate 引用恒等 `toBe`，均为「糊弄不过」的硬断言。
- **边界覆盖广**：空骨骼（idle/autodance 双路径 :78-83/:199-202）、BPM 上下限 clamp（:134-144）、速度 NaN/Infinity/负数 clamp（:670-693）、模式切换真值表（:258-291）、迁移畸形数据（null/{}/未知 mode/NaN 双参 :491-583）——判定与迁移两块的边界矩阵完整。
- **无跳过**：grep 核实 0 处 `it.skip`/`it.todo`/`test.only`；78/78 全绿（2.03s），无 flaky 迹象（多次运行稳定）。
- **710 行不冗余**：VMD 解析辅助函数（`_parseVmdBones`/`_parseBoneFrameKeys`）为真实断言服务，非凑数；测试对生产无 mock 侵入（纯函数直测，`@vitest-environment node` 合理）。

**缺口**：
1. matchBone P1（continue）修复路径零回归测试（P3#8）——本轮唯一已修 P1 反而无护城河。
2. intensity 两条 byteLength 大小比较恒真（P3#7）；真正有效的直接值断言在 :69-76/:701-709，但缺少强度梯度单调性验证。
3. migrate 嵌套分支 NaN、幂等性（`migrate(migrate(x)) === migrate(x)`）无用例（round-21 已提，仍缺）。
4. `genEmotionCycles`/`genAccentMorph`/`genShyMorph` 帧边界安全无直接用例（P2#4 已核实不可达，属「安全但未固化」）。
5. 少量标题/注释与断言不符（P4#11/#12/#10）。

**运行验证**：`cd frontend && npm run test -- src/__tests__/procedural-motion.test.ts` → 78/78 passed（2.03s），基线全绿。`npm run check`（tsc 全量）未运行——本轮只读不修改任何代码，纯审阅无类型回归风险，耗时权衡下跳过，特此注明。

## 审核范围外备注

- 生产代码与测试文件均未修改（锁文件制合规），仅写入本报告。
- `shouldAutoDance`/`shouldIdle` 消费端 `proc-motion-controller.ts:318-344` 存在 mode='autodance' 且无音频时 `wantAutoDance && wantIdle` 双真、靠分支顺序决定（autodance 优先）的行为，属 controller 层编排语义，不在本测试覆盖范围（controller 有独立测试），仅记录。

---
**审核日期**: 2026-08-15
**审核员**: 子代理 round35-procedural-motion
