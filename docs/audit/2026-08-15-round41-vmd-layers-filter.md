# Round 41 — vmd-layers-filter 审核（ADR-051 VMD 骨骼过滤）

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/vmd-layers-filter.test.ts`（162 行，13 用例） |
| 被测源码 | `frontend/src/scene/motion/vmd-layers.ts`（734 行）— `_filterVmdBones` L67-120、`_decodeSjis` L43-56、`VMD_BONE_FRAME_SIZE` L58、调用点 `_rebuildFallback` L493-495、`_rebuildComposite` L545-547 |
| 关联生产代码 | `frontend/src/motion-algos/vmd-writer.ts`（测试 helper `buildVmd`/`BONE_FRAME_SIZE`/`INTERP_LINEAR`，L35/L30）；ADR-051 §boneFilter 方案 B；round-17 P2 守卫（L71-82） |
| 验证 | `npm run test -- src/__tests__/vmd-layers-filter.test.ts` → **13/13 通过（16ms）**；`npm run check` → exit 0（tsc + i18n 全绿） |

**总体结论：✅ 通过** — 生产函数为纯函数 + 防御式守卫 + 四路零拷贝早退，类型安全零逃生；测试以独立二进制读取器真实断言过滤结果，13 用例全绿、无跳过。无 P1/P2 风险，5 项 P3（4 项为测试覆盖缺口）、6 项 P4。

## 与既往轮次的关系

- **round-5**（`docs/audit/round-5-vmd-layers.md`，2026-07-22）：vmd-layers.ts ⚠️ 有条件通过，🔴 P1「模块零测试」明确点名 `_filterVmdBones`（二进制偏移计算错误可能导致 VMD 数据损坏）。处置记录「✅ 已添加 _filterVmdBones 13 项单元测试」——**本测试文件即该 P1 的处置产物**（git 溯源 commit `391277c1` 同批落地），用例数与 round-5 记录一致（13）。
- **round-28**（`2026-08-15-round28-vmd-layers-dispose.md`）：审 composite dispose 路径（`_rebuildCompositeAnimation`/`_tryWasmBlender`/`switchAnimation` 释放链），与本测试**互补**：round-28 锁「重建生命周期释放」，本测试锁「VMD 二进制过滤正确性」，两轮共同覆盖 vmd-layers 的两块核心逻辑，无重叠。
- **round-17 P2**：`_filterVmdBones` 内嵌长度守卫 + boneCount 钳制（L71-82）为 round-17 修复落点，**在位但零测试覆盖**（见风险表 P3-3）。

## 亮点

- **二进制级真实验证，非 mock 空转**：测试用自研只读 helpers（`readBoneCount` 读 offset 50 / `readMorphCount` 读 54+n×111 / `readBoneName` 解码 15 字节 Shift-JIS）独立重推 VMD 布局，直接断言过滤产物的 ArrayBuffer 字节，不依赖生产内部实现——布局假设若与生产漂移，测试会红。
- **零拷贝契约用引用同一性固化**：`expect(result).toBe(data)`（L53/L60/L69/L76/L149）把「空过滤 / 全匹配 / 超集 / 空 VMD」四路零拷贝早退固化为可回归的性能契约，非仅测功能正确。
- **生产函数防御式设计**：空 filter（L68）、`byteLength < 54`（L73）、`boneCount === 0`（L83）、全保留（L96）四条早退路径；声明帧数经 `Math.min` 钳制到实际可容纳上限（L79-82）防越界读；输出为新 `Uint8Array`，输入 buffer 只读不写（纯函数，并发安全）。
- **编码与内容覆盖**：Shift-JIS 日文名（左ひじ/センター）、中文名、无匹配名、morph 计数保留、幂等二次过滤均有独立用例；`keptIndices` 扫描序 = 输出序，保留帧顺序正确（L89-95 双向断言验证）。
- **验证闭环**：round-5 P1 → 修复 + 13 用例 → 本次实测 13/13 绿，P1 处置闭环成立；全文件无 `it.skip`/`it.todo`/`xit`。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | — | — | 无 | — |
| 🟠 P2 | — | — | 无 | — |
| 🟡 P3 | vmd-layers.ts | L71-82 | ADR-051 §boneFilter 步骤 1 要求「验证 VMD 签名（"Vocaloid Motion Data"）」，代码**只做长度校验、未做签名校验**；L71 注释声称「VMD 签名/长度校验」言过其实（L79 钳制仅保护过滤自身读取，非拦截非 VMD 数据） | 实现 30 字节签名比对（'Vocaloid Motion Data 0002'）后置过滤，或修正注释与 ADR 措辞消除承诺差 |
| 🟡 P3 | vmd-layers.ts:58 / vmd-writer.ts:35 | `VMD_BONE_FRAME_SIZE = 111` 双份常量（两份真相） | 两份 111 分属不同模块，改一处漏另一处会静默破坏二进制布局（本测试 import 的是 vmd-writer 的 `BONE_FRAME_SIZE`，生产用的是自己的） | vmd-layers.ts 改 import vmd-writer 的 `BONE_FRAME_SIZE`（vmd-writer 仅依赖 encoding-japanese，无循环依赖风险），消除重复定义 |
| 🟡 P3 | vmd-layers-filter.test.ts | L106-114 | 测试名「保留插值曲线字节（64B per frame）」**名不副实**：仅断言 `result.byteLength` 等于期望总大小，未读取 64 字节插值区内容——插值区被清零/损坏也会通过 | 直接读保留帧 offset 43..107 的 64 字节，与 `INTERP_LINEAR` 的字节序列（20,20,107,107 ×16）逐字节比对 |
| 🟡 P3 | vmd-layers-filter.test.ts | 全文件 | **无多帧/同名骨骼覆盖**：每用例每骨仅 1 帧；真实 VMD 每骨数十上百关键帧（同名重复出现），`keptIndices` 同名多帧保留 + 扫描序保序路径零用例 | 补「1 骨 × N 帧 + 若干其他骨」用例：过滤后断言该骨 N 帧全部保留、帧号顺序不变、其余骨清零 |
| 🟡 P3 | vmd-layers-filter.test.ts | 全文件 | **畸形输入零覆盖**：round-17 P2 修复点（L73 `byteLength < 54` 守卫、L79-82 帧数钳制）无用例；截断 VMD / 声明帧数超容量 / 声明帧数超大值三条防御路径未验证 | 补 3 用例：① 50B 截断 buffer 原样返回；② 声明 100 帧但实际仅 5 帧数据 → 按钳制后处理不越界；③ 声明帧数 = 0xFFFFFFFF → 安全钳制 |
| 🟢 P4 | vmd-layers.ts | L67-120 | 魔法数值 50（帧数偏移）/ 54（头大小）/ 15（骨骼名长）未命名常量（111 已提为 `VMD_BONE_FRAME_SIZE`） | 提取 `VMD_HEADER_SIZE = 54`、`BONE_COUNT_OFFSET = 50`、`BONE_NAME_LEN = 15` 常量 |
| 🟢 P4 | vmd-layers.ts | L493-495 / L545-547 | 每次 rebuild 对原始 `layer.data` 重新执行完整过滤并新建 buffer，无缓存；大 VMD + 权重滑块/开关连调时重复开销 | 按 `(data 引用, filter)` 组合缓存过滤结果，或权重/toggle 类操作复用上次产物 |
| 🟢 P4 | vmd-layers-filter.test.ts | L97-104 | morph 仅断言计数（`readMorphCount`），未验证 morph 帧字节内容与尾部 camera/light/ik 区（buildVmd 恒写 0，非零尾部保留未验证） | 用非零 morph weight + 非零尾部计数构造输入，断言字节级保留 |
| 🟢 P4 | vmd-layers-filter.test.ts | L30 | 测试解码器用 `TextDecoder('shift-jis')`，生产 `_decodeSjis` 用 `encoding-japanese`——两者对罕见字符可能分歧，边缘字符回归漏检（与 round-5 P4「骨骼名编码统一」同源，仍开放） | 两侧统一解码库；或在测试中引入一个罕见 JIS 字符（如 髙/﨑 类）验证一致 |
| 🟢 P4 | vmd-layers-filter.test.ts | L11-31 | helpers 硬编码 50/54/15 魔法数值，与生产常量重复 | 提取测试侧常量（`VMD_HEADER`/`NAME_LEN`）并注释 VMD 布局依据 |
| 🟢 P4 | vmd-layers.ts | L569-571 | 空 `finally {}` 块（round-28 已记录，仍存在；不属本测试范围，顺带确认未新增变化） | 删除空 finally 或移注释至 try 块首 |

## 测试质量评价

- **断言有效性**：核心断言全部落在真实字节上——帧数读自 offset 50（uint32 LE）、骨骼名经 15 字节 Shift-JIS 解码比对、morph 计数读自 54+n×111——过滤后「帧数减少 / 保留正确骨骼名 / morph 保留」均为可观察产物验证，非自证循环；零拷贝路径用 `toBe` 引用同一性锁定，断言强度高。
- **边界覆盖盘点**：保留全部（全匹配/超集）、过滤全部（无匹配）、部分匹配（数量 + 名称 + morph + 幂等）、日文/中文名、空 VMD 均覆盖；缺口集中在「多帧同名骨骼（真实形态）」「畸形/截断输入」「插值字节内容」三类（见 P3）。
- **测试独立性**：输入经 `buildVmd`（vmd-writer）构造、输出经自研只读器验证，两端均独立于被测函数；`@vitest-environment node` 分流符合 ADR-255 卫生约定。
- **无跳过**：13 用例全部运行（vitest 实测 16ms），无 `it.skip`/`it.todo`/`xit`。
- **结论**：测试质量良好，真实覆盖核心过滤语义，round-5 P1 处置闭环成立；P3 缺口均为补充性（真实形态/畸形输入/字节内容），不构成功能缺陷。

---

审核日期：2026-08-15
审核员：子代理 round41-vmd-layers-filter
