# ADR-098: babylon-mmd 未利用 API 接入 · 批次一（描边渲染 + Composite 动画类型收敛）

**日期**：2026-07-13
> **状态**: 已完成
> **关联**: `docs/research/babylon-mmd-api-analysis.md`（未利用 API 调研，本批次来源）、ADR-064（IMmdModel 类型缺口即时止血，本批次延续其类型收敛思路）、ADR-061（VMD 多图层 / Composite 混合基础）
> **影响面**: `frontend/src/scene/scene.ts`、`frontend/src/scene/motion/vmd-layers.ts`

---

## 问题

`docs/research/babylon-mmd-api-analysis.md` 调研出 5 个 babylon-mmd 已提供、但项目未利用的高价值 API。经现状核查（5 个 API 均存在于当前包），确定按"零风险 → 需 POC"分批推进。**批次一取其中风险最低的两项**：

| # | API | 现状问题 |
|---|-----|---------|
| 1 | `MmdOutlineRenderer` | 项目从未导入 → `Scene.prototype.getMmdOutlineRenderer()` 补丁缺失 → 带描边（edge/toon）标记的 PMX 材质即便 `renderOutline=true` 也**静默无轮廓线**，MMD 原生描边效果丢失 |
| 2 | `MmdCompositeRuntimeModelAnimation` | `vmd-layers.ts` JS runtime 路径绑定 Composite 动画时，用 `composite as unknown as IMmdBindableModelAnimation` **双重 cast** 规避类型缺口，属 ADR-064 未清理的类型债务 |

### 根因

1. **描边**：`MmdOutlineRenderer` 采用 side-effect 挂载模式——导入模块时才把 `getMmdOutlineRenderer()` 补丁挂到 `Scene.prototype`，`mmdStandardMaterial.js` 在 `renderOutline=true` 时惰性调用该补丁注册描边组件。未导入即整条描边链路断裂。
2. **cast**：babylon-mmd 早期类型声明未暴露 `MmdCompositeAnimation` 实现 `IMmdBindableModelAnimation` 的继承关系，开发时以双重 cast 绕过；当前版本已在 `mmdCompositeRuntimeModelAnimation.d.ts` 补齐 module augmentation，cast 已属冗余。

---

## 决策

**采纳两项 babylon-mmd 原生 API，均以最小侵入方式接入，零渲染管线 / 运行时行为改动。**

| 项 | 落点 | 手法 |
|----|------|------|
| 1. 描边渲染 | `scene.ts` 顶部 import 区 | 增加 side-effect import `babylon-mmd/esm/Loader/mmdOutlineRenderer`，激活 `Scene.prototype` 补丁 |
| 2. Composite 类型收敛 | `vmd-layers.ts` JS runtime 绑定路径 | 增加 `import type { MmdCompositeRuntimeModelAnimation }` 激活 module augmentation；删除双重 cast，直接 `createRuntimeAnimation(composite)` |

### 选项

| 选项 | 描述 | 结论 |
|------|------|------|
| A. 维持现状 | 描边持续缺失；cast 持续存在，babylon-mmd 升级时是静默断裂风险点 | ❌ 否决 |
| B. 手写描边 pass（ShaderMaterial + 后处理） | 重复造轮子，与 MMD 原生 toon edge 语义不一致，维护成本高 | ❌ 否决 |
| C. 采纳原生 API（描边 side-effect import + cast 收敛） | 一行 import 立竿见影；cast 消除依赖官方类型增强，无运行时改动 | ✅ 采用 |

---

## 约束

- **描边为惰性、按需生效**：仅在材质 `renderOutline=true` 时才注册组件并渲染，未标记描边的材质零开销。默认 `zOffset=4` / `zOffsetUnits=0`。
- **WebGPU 兼容性**：若后续切 WebGPU + `MmdStandardMaterialProxy` 出现描边 z-fighting，调 `scene.getMmdOutlineRenderer().zOffset` 即可，无需改本 ADR 结构。
- **Composite cast 消除仅影响 JS runtime 路径**：即 `getMmdRuntimeType() === 'js'`（程序化动作菜单调试模式）；默认 WASM 路径（含 `wasm-layers-blender`）不经过此分支，无回退风险。
- **cast 消除依赖官方 module augmentation**：`import type { MmdCompositeRuntimeModelAnimation }` 不可删除——它是激活 `MmdCompositeAnimation extends IMmdBindableModelAnimation` 声明合并的必要导入，删除后 `createRuntimeAnimation(composite)` 将重新报类型错误。

---

## 执行情况（2026-07-13）

### 1. MmdOutlineRenderer（`scene.ts`）
- 顶部 import 区新增 side-effect import：`import 'babylon-mmd/esm/Loader/mmdOutlineRenderer';`
- 附注释说明补丁挂载机制与惰性注册时机。

### 2. Composite 类型收敛（`vmd-layers.ts`）
- import 区新增 `import type { MmdCompositeRuntimeModelAnimation } from 'babylon-mmd/esm/Runtime/Animation/mmdCompositeRuntimeModelAnimation';`（激活 module augmentation）。
- JS runtime 绑定路径删除 `const runtimeAnimation = composite as unknown as ...IMmdBindableModelAnimation;`，改为直接 `inst.mmdModel.createRuntimeAnimation(composite)`，消除 1 处 `as unknown as` cast。

---

## 验证

- `npm run check`（`tsc --noEmit`）：退出码 0，无类型错误。`createRuntimeAnimation(composite)` 无 cast 编译通过，反证 module augmentation 已激活。
- `npm run build`（`tsc` + `vite build`）：退出码 0，325 模块转换无错，side-effect import 在打包层正确解析。

---

## 后续（未落地项 · 待排期）

同源调研剩余三项，风险递增，本批次不含：

| 项 | API | 阻断 / 依赖 |
|----|-----|------------|
| 批次二候选 | `StreamAudioPlayer` | 替换 `outfit/audio.ts` 自建管线，需保留自建 `BeatDetector` 桥接 |
| 需 POC | `MmdWasmInstanceTypeMPR`（多线程物理） | 依赖 `SharedArrayBuffer`，需 Go 端 `basenameFallbackFS` 注入 COOP/COEP 响应头 POC，再开 feature flag |
| 需骨骼映射复用 | `AnimationRetargeter` + `HumanoidMmd` | 解锁 Mixamo/VRM/Blender 动作源，须复用 ADR-061 统一骨骼映射，不重复造 |
